// Local backend: KIRI Engine proxy (video -> 3D Gaussian Splatting) + serves the SPA.
// Keeps the secret KIRI key server-side. Runs locally; exposed via ngrok.
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import AdmZip from 'adm-zip';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const KEY = process.env.KIRI_API_KEY;
const KIRI = 'https://api.kiriengine.app/api/v1/open';

const DATA_DIR = join(__dirname, 'data');
const UPLOADS = join(__dirname, 'uploads');
const DB = join(DATA_DIR, 'tours.json');
for (const d of [DATA_DIR, UPLOADS]) if (!existsSync(d)) mkdirSync(d, { recursive: true });
if (!existsSync(DB)) writeFileSync(DB, '[]');

const readDB = () => JSON.parse(readFileSync(DB, 'utf8'));
const writeDB = (arr) => writeFileSync(DB, JSON.stringify(arr, null, 2));
const upsert = (tour) => {
  const all = readDB();
  const i = all.findIndex((t) => t.id === tour.id);
  if (i === -1) all.unshift(tour);
  else all[i] = tour;
  writeDB(all);
  return tour;
};
const uid = () => 'v-' + Math.random().toString(36).slice(2, 9);

// ---- Stitch debug logging ------------------------------------------------
// Every AI-stitch call is dumped to uploads/stitch-debug/<kind>-<id>/ :
//   in-NN-<key>.<ext>  все входные фото, что ушли модели
//   prompt.txt         точная инструкция
//   request.json       модель/разрешение/список входов + размеры
//   response.json      http-статус, usage/cost, media_type, ошибка
//   result.<ext>       ровно то, что вернула модель (до пост-обработки)
const STITCH_DEBUG = join(UPLOADS, 'stitch-debug');
function decodeDataUrl(u) {
  const m = /^data:image\/([a-z]+);base64,(.+)$/s.exec(u || '');
  return m ? { ext: m[1] === 'jpeg' ? 'jpg' : m[1], buf: Buffer.from(m[2], 'base64') } : null;
}
// save inputs + prompt + request meta; returns { id, dir }
// params = the exact non-image fields sent to OpenRouter (model, resolution, seed, aspect_ratio, quality, …)
function stitchDebugStart(kind, { urls, keys, prompt, model, params }) {
  const id = uid();
  const dir = join(STITCH_DEBUG, `${kind}-${id}`);
  mkdirSync(dir, { recursive: true });
  const inputs = [];
  urls.forEach((u, i) => {
    const d = decodeDataUrl(u);
    const key = keys?.[i] || `img${i + 1}`;
    const name = `in-${String(i + 1).padStart(2, '0')}-${key}.${d?.ext || 'bin'}`;
    if (d) { writeFileSync(join(dir, name), d.buf); inputs.push({ name, key, bytes: d.buf.length }); }
  });
  writeFileSync(join(dir, 'prompt.txt'), prompt || '');
  // full outgoing OpenRouter body, base64 stripped (input_references → just the count)
  const apiBody = { model, prompt, ...(params || {}), input_references: `[${inputs.length} images]` };
  writeFileSync(join(dir, 'request.json'),
    JSON.stringify({ kind, id, at: new Date().toISOString(), apiBody, inputs }, null, 2));
  console.log(`\n🟣 [${kind} ${id}] ${inputs.length} input photos → uploads/stitch-debug/${kind}-${id}`);
  console.log(`🟣 [${kind} ${id}] API body: ${JSON.stringify({ model, ...(params || {}), input_references: `${inputs.length} imgs` })}`);
  console.log(`🟣 [${kind} ${id}] keys=[${(keys || inputs.map((x) => x.key)).join(', ')}]`);
  console.log(`🟣 [${kind} ${id}] PROMPT ↓\n${prompt}\n🟣 [${kind} ${id}] PROMPT ↑`);
  return { id, dir };
}
// read WxH from a PNG/JPEG buffer without any deps (to verify aspect_ratio actually took)
function imageSize(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }; // PNG
  if (buf[0] === 0xff && buf[1] === 0xd8) { // JPEG: find SOF marker
    let o = 2;
    while (o + 9 < buf.length) {
      if (buf[o] !== 0xff) { o++; continue; }
      const m = buf[o + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) };
      if (m === 0xd8 || m === 0xd9 || (m >= 0xd0 && m <= 0xd7)) { o += 2; continue; }
      o += 2 + buf.readUInt16BE(o + 2);
    }
  }
  return null;
}

// save response meta + the raw result image
function stitchDebugFinish(dbg, kind, { status, json, b64, media }) {
  const cost = json?.usage?.cost ?? null;
  const buf = b64 ? Buffer.from(b64, 'base64') : null;
  const dim = buf ? imageSize(buf) : null;
  const ratio = dim ? +(dim.w / dim.h).toFixed(3) : null; // 2.0 = perfect equirect, 1.0 = square fallback
  // full raw OpenRouter body, base64 payloads replaced by their length (so empty/refusal 200s are debuggable)
  try {
    const raw = JSON.parse(JSON.stringify(json ?? null, (k, v) =>
      (k === 'b64_json' && typeof v === 'string') ? `<b64 ${v.length} chars>` : v));
    writeFileSync(join(dbg.dir, 'raw_response.json'), JSON.stringify(raw, null, 2));
  } catch { /* ignore */ }
  writeFileSync(join(dbg.dir, 'response.json'), JSON.stringify(
    { id: dbg.id, kind, at: new Date().toISOString(), http: status, cost, out_wxh: dim ? `${dim.w}x${dim.h}` : null, out_ratio: ratio, usage: json?.usage ?? null, media_type: media || null, hasImage: !!b64, error: json?.error ?? null },
    null, 2));
  if (buf) writeFileSync(join(dbg.dir, `result.${(media || 'image/png').includes('png') ? 'png' : 'jpg'}`), buf);
  console.log(`🟣 [${kind} ${dbg.id}] response http=${status} cost=${cost} out=${dim ? `${dim.w}x${dim.h} (ratio ${ratio})` : 'no-image'} usage=${JSON.stringify(json?.usage ?? {})}`);
  if (json?.error) console.log(`🔴 [${kind} ${dbg.id}] OpenRouter error: ${JSON.stringify(json.error).slice(0, 500)}`);
}

// ---- KIRI helpers --------------------------------------------------------
const authH = { Authorization: `Bearer ${KEY}` };

async function kiriSubmitVideo(buffer, filename) {
  const form = new FormData();
  form.append('videoFile', new Blob([buffer]), filename || 'walkthrough.mp4');
  form.append('isMesh', '0'); // want the splat, not a mesh
  const r = await fetch(`${KIRI}/3dgs/video`, { method: 'POST', headers: authH, body: form });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.data?.serialize) throw new Error(`KIRI submit failed: ${r.status} ${JSON.stringify(j)}`);
  return j.data.serialize;
}

async function kiriStatus(serialize) {
  const r = await fetch(`${KIRI}/model/getStatus?serialize=${serialize}`, { headers: authH });
  const j = await r.json().catch(() => ({}));
  if (!j?.data) throw new Error(`KIRI status failed: ${r.status} ${JSON.stringify(j)}`);
  return j.data.status; // -1 upload,0 processing,1 failed,2 success,3 queue,4 expired
}

async function kiriModelUrl(serialize) {
  const r = await fetch(`${KIRI}/model/getModelZip?serialize=${serialize}`, { headers: authH });
  const j = await r.json().catch(() => ({}));
  if (!j?.data?.modelUrl) throw new Error(`KIRI getModelZip failed: ${r.status} ${JSON.stringify(j)}`);
  return j.data.modelUrl;
}

const STATUS_MAP = { '-1': 'uploading', 0: 'processing', 1: 'failed', 2: 'success', 3: 'queued', 4: 'expired' };

// download the result zip, extract the splat/ply, return a served URL
async function fetchSplat(tour) {
  const url = await kiriModelUrl(tour.serialize);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download zip failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const zip = new AdmZip(buf);
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  // prefer .splat, then 3DGS .ply
  const pick =
    entries.find((e) => extname(e.entryName).toLowerCase() === '.splat') ||
    entries.find((e) => extname(e.entryName).toLowerCase() === '.ply');
  if (!pick) throw new Error(`no .splat/.ply in zip (has: ${entries.map((e) => e.entryName).join(', ')})`);
  const outDir = join(UPLOADS, tour.id, 'model');
  mkdirSync(outDir, { recursive: true });
  const fileName = 'scene' + extname(pick.entryName).toLowerCase();
  writeFileSync(join(outDir, fileName), pick.getData());
  return `/uploads/${tour.id}/model/${fileName}`;
}

// refresh a tour's status against KIRI (and fetch the splat once ready)
async function refresh(tour) {
  if (['ready', 'failed', 'expired'].includes(tour.status)) return tour;
  const s = await kiriStatus(tour.serialize);
  const name = STATUS_MAP[String(s)] || 'processing';
  if (name === 'success') {
    if (!tour.splatUrl) {
      tour.splatUrl = await fetchSplat(tour);
      tour.readyAt = Date.now();
    }
    tour.status = 'ready';
  } else if (name === 'failed') tour.status = 'failed';
  else if (name === 'expired') tour.status = 'expired';
  else tour.status = name; // uploading | processing | queued
  return upsert(tour);
}

// ---- App -----------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json({ limit: '30mb' })); // equirect data URLs are heavy
app.use('/uploads', express.static(UPLOADS));

const uploadMw = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 1024 } });

// ---- OpenRouter: assemble a seamless 360° panorama from the room's wall photos ----
// Все фото стен идут ОДНИМ заданием — модель понимает комнату целиком и собирает 360 сама.
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const STITCH_MODEL = 'google/gemini-3-pro-image'; // чистый бесшовный 360 (flash даёт швы). see docs/ai-stitching.md
const WALL_LABEL = {
  front: 'the FRONT wall',
  right: 'the RIGHT wall',
  back: 'the BACK wall',
  left: 'the LEFT wall',
  floor: 'the FLOOR (looking straight down)',
  ceiling: 'the CEILING (looking straight up)',
};

function buildStitchPrompt(keys) {
  const list = keys.map((k, i) => `Photo ${i + 1} is ${WALL_LABEL[k] || k}.`).join(' ');
  const hasFC = keys.includes('floor') || keys.includes('ceiling');
  return (
    'I give you photos of the surfaces of ONE single room, all taken from the room centre. ' +
    list +
    '\nCombine them into ONE single seamless 360° equirectangular panorama (2:1 aspect ratio) of this ' +
    'room interior, as if shot with a 360 camera standing in the centre.\n' +
    'Rules:\n' +
    '- Arrange the walls left-to-right in clockwise order (front, right, back, left) so panning horizontally ' +
    'turns you around the room; the left and right edges MUST wrap seamlessly (both are the front wall).\n' +
    '- Bend the vertical wall edges into the natural equirectangular curvature; walls meet at smooth inside ' +
    'corners with no hard vertical seams.\n' +
    '- A continuous ceiling fills the top and a continuous floor fills the bottom' +
    (hasFC ? ', using the provided floor/ceiling photos' : ', matching the room style and lighting') +
    '.\n' +
    '- Keep the real furniture, windows, doors and objects from the photos on their correct walls; ' +
    'do not invent extra large objects.\n' +
    '- Consistent, even lighting and white balance across the whole panorama.\n' +
    'Output only the finished equirectangular panorama image, 2:1.'
  );
}

// body: { images: [{ key, url:dataURL }], model?, prompt? } -> { image: dataURL(clean 360), cost, model }
app.post('/api/stitch', async (req, res) => {
  try {
    if (!OPENROUTER_KEY) return res.status(500).json({ ok: false, error: 'OPENROUTER_API_KEY не задан в server/.env' });
    let { images, model, prompt } = req.body || {};
    // back-compat: allow a single { image } too
    if (!images && req.body?.image) images = [{ key: 'front', url: req.body.image }];
    if (!Array.isArray(images) || !images.length)
      return res.status(400).json({ ok: false, error: 'images must be a non-empty array of { key, url }' });
    for (const it of images)
      if (!it?.url || !/^data:image\/[a-z]+;base64,/.test(it.url))
        return res.status(400).json({ ok: false, error: 'each image.url must be a data:image/*;base64 URL' });

    const keys = images.map((it) => it.key);
    const finalModel = model || STITCH_MODEL;
    const finalPrompt = prompt || buildStitchPrompt(keys);
    const dbg = stitchDebugStart('stitch', { urls: images.map((it) => it.url), keys, prompt: finalPrompt, model: finalModel });

    const r = await fetch('https://openrouter.ai/api/v1/images', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: finalModel,
        prompt: finalPrompt,
        input_references: images.map((it) => ({ type: 'image_url', image_url: { url: it.url } })),
      }),
    });
    const j = await r.json().catch(() => ({}));
    const media = j?.data?.[0]?.media_type || 'image/png';
    stitchDebugFinish(dbg, 'stitch', { status: r.status, json: j, b64: j?.data?.[0]?.b64_json, media });
    if (!r.ok) return res.status(502).json({ ok: false, error: `OpenRouter ${r.status}: ${JSON.stringify(j?.error || j).slice(0, 400)}` });

    const b64 = j?.data?.[0]?.b64_json;
    if (!b64) return res.status(502).json({ ok: false, error: 'OpenRouter вернул ответ без изображения' });
    res.json({
      ok: true,
      image: `data:${media};base64,${b64}`,
      cost: j?.usage?.cost ?? null,
      model: model || STITCH_MODEL,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// ---- Panorama from photos: gemini stitch → OpenCV post (2:1 4K HDR, seam-fixed) -----
const PANO_MODEL = 'google/gemini-3-pro-image';
const PYENV = join(__dirname, 'pyenv', 'bin', 'python');
const POST_SCRIPT = join(__dirname, 'postprocess.py');
const TO2TO1_SCRIPT = join(__dirname, 'to2to1.py'); // force strict 2:1 (width = 2 × height)
const FIXSTITCH_SCRIPT = join(__dirname, 'fixstitch.py'); // AI post-process: repair (masked) | render (full)

function buildPanoPrompt(n) {
  return 'Merge and EXPAND them into a single seamless 2:1 equirectangular 360° panorama of THIS exact room, as if shot with a 360 camera standing in the middle.';
}

function buildPanoPromptOld(n) {
  return (
    `You are compositing a 360° equirectangular panorama by STITCHING the real content of ${n} wide-angle ` +
    'photos of ONE room (taken from different corners, in clockwise order). This is a FAITHFUL ' +
    'reconstruction task, NOT creative image generation.\n' +
    '\nWork in steps:\n' +
    '1) Examine EACH photo as a separate viewpoint. Catalogue every object, furniture piece, opening ' +
    '(window/door), fixture and surface you see, and note which wall/area it belongs to.\n' +
    '2) Consolidate all viewpoints into ONE room inventory. An object seen in several photos is the SAME ' +
    'object — count it once. Determine the TRUE count of every object; do not assume — if there are two ' +
    'beds keep two, if one keep one.\n' +
    '3) Preserve REAL PROPORTIONS. Estimate scale from reference objects of known size (interior door ' +
    '≈ 2.0 m tall, bed ≈ 2.0 m long, wall AC unit ≈ 0.8 m wide, radiator ≈ 0.5 m tall, ceiling height ' +
    '≈ 2.6 m) and keep every object size and the room proportions consistent with these — do not stretch ' +
    'or shrink objects.\n' +
    '4) Compose the panorama placing each real object EXACTLY ONCE at its correct wall, position and scale.\n' +
    '\nFAITHFULNESS (critical):\n' +
    '- Use ONLY content present in the photos. Do NOT invent, add, remove or duplicate any object.\n' +
    '- NEVER duplicate an object across the panorama or at the wrap seam (e.g. do not show the same bed twice).\n' +
    '- Preserve ALL openings exactly — every window, balcony door and room door stays where it is; never ' +
    'wall one over or drop it.\n' +
    '- Fill only genuinely unseen gaps (small corner/ceiling/floor areas) with plain continuation of the ' +
    'adjacent surface — never with invented furniture.\n' +
    '\nLight: unify white balance and exposure across photos (no brightness seams), detail kept in bright ' +
    'windows and dark corners.\n' +
    'OUTPUT: one equirectangular panorama, strict 2:1, seamless left/right wrap, walls in natural ' +
    'equirectangular curvature, verticals straight, horizon level, top = ceiling, bottom = floor. ' +
    'Output the image only.'
  );
}

function runPy(args) {
  return new Promise((res, rej) => {
    const p = spawn(PYENV, args);
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (c) => (c === 0 ? res(out.trim()) : rej(new Error(err || `python exit ${c}`))));
    p.on('error', rej);
  });
}

// ---- Panorama library (saved panoramas, reusable in tours) ----
const PANOS_DB = join(DATA_DIR, 'panoramas.json');
if (!existsSync(PANOS_DB)) writeFileSync(PANOS_DB, '[]');
const readPanos = () => { try { return JSON.parse(readFileSync(PANOS_DB, 'utf8')); } catch { return []; } };
const writePanos = (a) => writeFileSync(PANOS_DB, JSON.stringify(a, null, 2));

// OpenRouter key balance: remaining = total_credits − total_usage (cached ~30s, key stays server-side)
let _balCache = { at: 0, data: null };
app.get('/api/balance', async (_req, res) => {
  try {
    if (!OPENROUTER_KEY) return res.json({ ok: false });
    if (_balCache.data && Date.now() - _balCache.at < 30000) return res.json(_balCache.data);
    const r = await fetch('https://openrouter.ai/api/v1/credits', { headers: { Authorization: `Bearer ${OPENROUTER_KEY}` } });
    const j = await r.json().catch(() => ({}));
    const tc = j?.data?.total_credits, tu = j?.data?.total_usage;
    const data = (typeof tc === 'number' && typeof tu === 'number')
      ? { ok: true, remaining: +(tc - tu).toFixed(2), total: tc, usage: +(+tu).toFixed(4) }
      : { ok: false };
    _balCache = { at: Date.now(), data };
    res.json(data);
  } catch { res.json({ ok: false }); }
});

// OpenRouter image-generation models that also accept image input (usable for stitching),
// so the UI can offer a model dropdown. Cached ~10 min. Falls back to a static list on error.
let _modelsCache = { at: 0, data: null };
app.get('/api/image-models', async (_req, res) => {
  try {
    if (_modelsCache.data && Date.now() - _modelsCache.at < 600000) return res.json(_modelsCache.data);
    const r = await fetch('https://openrouter.ai/api/v1/models', { headers: { Authorization: `Bearer ${OPENROUTER_KEY}` } });
    const j = await r.json().catch(() => ({}));
    const list = (j?.data || [])
      .filter((m) => {
        const a = m.architecture || {};
        return (a.output_modalities || []).includes('image')
          && (a.input_modalities || []).includes('image')
          && !m.id.startsWith('openrouter/');
      })
      .map((m) => ({ id: m.id, name: m.name || m.id }))
      .sort((x, y) => x.id.localeCompare(y.id));
    const data = list.length ? list : null;
    if (data) _modelsCache = { at: Date.now(), data };
    res.json(data || [{ id: PANO_MODEL, name: 'Gemini 3 Pro Image (default)' }]);
  } catch {
    res.json([{ id: PANO_MODEL, name: 'Gemini 3 Pro Image (default)' }]);
  }
});

// default panorama prompt for a given photo count (so the UI can prefill an editable field)
app.get('/api/panorama/prompt', (req, res) => {
  const n = Math.min(16, Math.max(2, parseInt(req.query.n, 10) || 6));
  res.json({ prompt: buildPanoPrompt(n) });
});

app.get('/api/panoramas', (_req, res) => res.json(readPanos().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))));
app.delete('/api/panoramas/:id', (req, res) => {
  const all = readPanos();
  const p = all.find((x) => x.id === req.params.id);
  if (p?.url?.startsWith('/uploads/')) {
    try { const f = join(__dirname, p.url); if (existsSync(f)) rmSync(f); } catch { /* ignore */ }
  }
  writePanos(all.filter((x) => x.id !== req.params.id));
  res.json({ ok: true });
});

// generate a panorama and SAVE it to the library
// body: { images: [dataURL, ...] up to 16, resolution?, name? } -> panorama entry
app.post('/api/panorama', async (req, res) => {
  try {
    if (!OPENROUTER_KEY) return res.status(500).json({ ok: false, error: 'OPENROUTER_API_KEY не задан в server/.env' });
    let { images, resolution, prompt: bodyPrompt } = req.body || {};
    images = (images || []).map((it) => (typeof it === 'string' ? it : it?.url)).filter(Boolean);
    if (!images.length) return res.status(400).json({ ok: false, error: 'нет фото' });
    if (images.length > 16) return res.status(400).json({ ok: false, error: 'максимум 16 фото' });
    resolution = ['1K', '2K', '4K'].includes(resolution) ? resolution : '4K';
    for (const u of images)
      if (!/^data:image\/[a-z]+;base64,/.test(u)) return res.status(400).json({ ok: false, error: 'каждое фото — data:image/*;base64' });

    // 1) AI stitch — OpenRouter /images. Tunable params (all overridable from req.body):
    //   seed        — fixed default → reproducible runs (change to vary); pass null to omit
    //   aspect_ratio— equirect wants 2:1 (⚠ Gemini natively supports only up to 21:9 → may fall
    //                 back; we send it anyway and log the real output dims to see what happens)
    //   quality     — auto/low/medium/high (optional)
    // editable prompt: use the client's custom prompt if provided, else the built-in default
    const panoPrompt = (typeof bodyPrompt === 'string' && bodyPrompt.trim()) ? bodyPrompt.trim() : buildPanoPrompt(images.length);
    // model override from the client's dropdown; must be a "vendor/model" slug, else the default
    const model = (typeof req.body?.model === 'string' && req.body.model.includes('/')) ? req.body.model.trim() : PANO_MODEL;
    // ⚠ Confirmed by a live 400 from the provider: google/gemini-3-pro-image REJECTS `seed` and
    //   `aspect_ratio: "2:1"`. Accepted aspect_ratio: 1:1,2:3,3:2,3:4,4:3,4:5,5:4,9:16,16:9,21:9 (no 2:1).
    //   Omitting aspect_ratio already yields a ~2:1 image, so we DON'T send it by default.
    //   `temperature` was NOT in the rejection list → accepted; we keep it.
    //   seed/aspect_ratio stay opt-in from req.body for experiments (will 400 if the provider refuses).
    const seed = Number.isFinite(+req.body?.seed) ? Math.trunc(+req.body.seed) : null;
    const aspectRatio = req.body?.aspectRatio || req.body?.aspect_ratio || null; // e.g. '21:9' to force widest legal
    const quality = ['auto', 'low', 'medium', 'high'].includes(req.body?.quality) ? req.body.quality : undefined;
    const temperature = req.body?.temperature === null ? null
      : Number.isFinite(+req.body?.temperature) ? +req.body.temperature : 0.2;

    const params = {
      resolution,
      ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
      ...(seed !== null ? { seed } : {}),
      ...(temperature !== null ? { temperature } : {}),
      ...(quality ? { quality } : {}),
    };
    const dbg = stitchDebugStart('panorama', { urls: images, keys: images.map((_, i) => `photo${i + 1}`), prompt: panoPrompt, model, params });

    const orBody = JSON.stringify({
      model,
      prompt: panoPrompt,
      input_references: images.map((u) => ({ type: 'image_url', image_url: { url: u } })),
      ...params,
    });

    // Retry: OpenRouter/Gemini intermittently returns an empty 200 (no image, no usage) or a 5xx/
    // network hiccup. Those are transient → retry up to 3x with backoff. A real 4xx param error
    // (has j.error) is NOT retried. Each attempt gets its own 160s abort so a hang can't stall forever.
    const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
    const MAX = 3;
    let r = null, j = {}, b64 = null;
    for (let attempt = 1; attempt <= MAX; attempt++) {
      try {
        r = await fetch('https://openrouter.ai/api/v1/images', {
          method: 'POST',
          headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
          body: orBody,
          signal: AbortSignal.timeout(160000),
        });
        j = await r.json().catch(() => ({}));
      } catch (e) {
        r = { ok: false, status: 0 };
        j = { error: { message: String(e?.name === 'TimeoutError' ? 'timeout after 160s' : (e?.message || e)) } };
      }
      b64 = j?.data?.[0]?.b64_json || null;
      const hardParamError = r.status >= 400 && r.status < 500 && j?.error; // param rejection etc — no point retrying
      if (b64 || hardParamError) break;
      console.log(`🟠 [panorama ${dbg.id}] attempt ${attempt}/${MAX} empty/failed (http=${r.status}, image=${!!b64}) — ${attempt < MAX ? 'retrying' : 'giving up'}`);
      if (attempt < MAX) await sleep(1500 * attempt);
    }

    stitchDebugFinish(dbg, 'panorama', { status: r.status, json: j, b64, media: j?.data?.[0]?.media_type });
    if (!r.ok) return res.status(502).json({ ok: false, error: `OpenRouter ${r.status}: ${JSON.stringify(j?.error || j).slice(0, 300)}` });
    if (!b64) return res.status(502).json({ ok: false, error: `модель вернула пустой ответ (нет изображения) после ${MAX} попыток — провайдер флейкует, попробуй ещё раз` });

    // 2) save the AI result, then force it to a strict 2:1 (width = 2 × height) for a correct equirect
    const dir = join(UPLOADS, 'pano');
    mkdirSync(dir, { recursive: true });
    const id = uid('pano');
    const outPath = join(dir, `${id}.jpg`);
    writeFileSync(outPath, Buffer.from(b64, 'base64'));
    try {
      const out = await runPy([TO2TO1_SCRIPT, outPath, outPath]);
      console.log(`🟢 [panorama] 2:1 fix ${out}`);
    } catch (e) {
      console.log(`🟠 [panorama] 2:1 resize skipped: ${String(e.message || e)}`);
    }

    const finalUrl = `/uploads/pano/${id}.jpg`;
    const entry = {
      id,
      url: finalUrl,
      name: (req.body?.name || '').trim() || `Panorama ${readPanos().length + 1}`,
      createdAt: Date.now(),
      cost: j?.usage?.cost ?? null,
      resolution,
      model,
    };
    const all = readPanos(); all.unshift(entry); writePanos(all);
    console.log(`🟢 [panorama] ${images.length} photos @${resolution} via ${model} → ${finalUrl} (saved to library)`);
    res.json({ ok: true, ...entry });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// ---- Real stitch via the dockerized pano-stitch lib (cv2.Stitcher, real pixels) ----
// The lib runs unchanged in its own container; we just proxy to it (keeps it off the
// public net and dodges browser CORS). body: { images:[dataURL...], name? }.
const STITCH_CV_URL = process.env.STITCH_CV_URL || 'http://localhost:8151';
app.post('/api/stitch-cv', async (req, res) => {
  try {
    let { images, name, declutter, post } = req.body || {}; // post: 'repair' | 'render' | undefined
    images = (images || []).map((it) => (typeof it === 'string' ? it : it?.url)).filter(Boolean);
    if (images.length < 2) return res.status(400).json({ ok: false, error: 'нужно минимум 2 фото' });
    for (const u of images)
      if (!/^data:image\/[a-z]+;base64,/.test(u)) return res.status(400).json({ ok: false, error: 'каждое фото — data:image/*;base64' });

    // build multipart: photos in shooting order as img_00.jpg, img_01.jpg, …
    const room = uid('cv');
    const form = new FormData();
    form.append('room', room);
    if (declutter) form.append('declutter', '1'); // AI declutter (OpenRouter) on the finished pano
    images.forEach((u, i) => {
      const m = /^data:image\/[a-z]+;base64,(.+)$/s.exec(u);
      const buf = Buffer.from(m[1], 'base64');
      form.append('photos', new Blob([buf], { type: 'image/jpeg' }), `img_${String(i).padStart(2, '0')}.jpg`);
    });

    console.log(`🧩 [stitch-cv ${room}] ${images.length} photos → ${STITCH_CV_URL}/stitch`);
    let r;
    try {
      r = await fetch(`${STITCH_CV_URL}/stitch`, { method: 'POST', body: form, signal: AbortSignal.timeout(1800000) });
    } catch (e) {
      return res.status(502).json({ ok: false, error: `контейнер склейки недоступен (${STITCH_CV_URL}): ${String(e.message || e)}` });
    }
    const j = await r.json().catch(() => ({}));
    if (!j.ok) {
      console.log(`🔴 [stitch-cv ${room}] FAILED\n${(j.log || '').slice(-1500)}`);
      return res.status(422).json({ ok: false, error: 'склейка не удалась', log: j.log || '' });
    }

    // pull the finished equirect from the container and store it in our panorama library
    const imgRes = await fetch(`${STITCH_CV_URL}${j.image}`);
    if (!imgRes.ok) return res.status(502).json({ ok: false, error: 'не удалось забрать результат из контейнера' });
    const bytes = Buffer.from(await imgRes.arrayBuffer());
    const dir = join(UPLOADS, 'pano');
    mkdirSync(dir, { recursive: true });
    const id = uid('pano');
    const outFile = join(dir, `${id}.jpg`);
    writeFileSync(outFile, bytes);
    try { await runPy([TO2TO1_SCRIPT, outFile, outFile]); } catch { /* lib is already 2:1 */ }

    // optional AI post-process: 'repair' (masked gap-fill, keeps real pixels) or 'render' (full re-render)
    let method = 'opencv';
    let postLog = '';
    if (post === 'repair' || post === 'render') {
      try {
        const out = await runPy([FIXSTITCH_SCRIPT, outFile, outFile, post]);
        postLog = out;
        method = `opencv+${post}`;
        console.log(`🧩 [stitch-cv ${room}] post(${post}) ${out}`);
      } catch (e) {
        postLog = `post-process (${post}) failed: ${String(e.message || e)}`;
        console.log(`🟠 [stitch-cv ${room}] ${postLog}`);
      }
    }

    const entry = {
      id,
      url: `/uploads/pano/${id}.jpg`,
      name: (name || '').trim() || `Stitch ${readPanos().length + 1}`,
      createdAt: Date.now(),
      cost: 0,
      resolution: 'CV',
      method,
    };
    const all = readPanos(); all.unshift(entry); writePanos(all);
    console.log(`🟢 [stitch-cv ${room}] OK → ${entry.url}`);
    res.json({ ok: true, ...entry, log: [j.log || '', postLog].filter(Boolean).join('\n\n') });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// save raw capture frames + IMU poses (so we can re-stitch them with OpenCV etc.)
app.post('/api/frames', (req, res) => {
  const { frames } = req.body || {};
  if (!Array.isArray(frames) || !frames.length) return res.status(400).json({ ok: false, error: 'no frames' });
  const sid = uid('cap');
  const dir = join(UPLOADS, 'frames', sid);
  mkdirSync(dir, { recursive: true });
  const poses = [];
  frames.forEach((fr, i) => {
    const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/s.exec(fr.image || '');
    if (!m) return;
    const name = `f${String(i).padStart(2, '0')}.jpg`;
    writeFileSync(join(dir, name), Buffer.from(m[2], 'base64'));
    poses.push({ file: name, q: fr.q, vFovDeg: fr.vFovDeg });
  });
  writeFileSync(join(dir, 'poses.json'), JSON.stringify(poses, null, 2));
  console.log(`🟢 [frames] saved ${poses.length} → uploads/frames/${sid}`);
  res.json({ ok: true, id: sid, dir: `/uploads/frames/${sid}` });
});

// store a captured/stitched panorama as a file → return its URL (localStorage is too small)
app.post('/api/pano', (req, res) => {
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/s.exec(req.body?.image || '');
  if (!m) return res.status(400).json({ ok: false, error: 'image must be a data:image/*;base64 URL' });
  const ext = m[1].startsWith('jp') ? 'jpg' : m[1];
  const dir = join(UPLOADS, 'pano');
  mkdirSync(dir, { recursive: true });
  const name = uid('p') + '.' + ext;
  writeFileSync(join(dir, name), Buffer.from(m[2], 'base64'));
  res.json({ ok: true, url: `/uploads/pano/${name}` });
});

// ---- User tours: server-side storage (replaces browser localStorage) --------
const TOURS_DB = join(DATA_DIR, 'user-tours.json');
if (!existsSync(TOURS_DB)) writeFileSync(TOURS_DB, '[]');
const readTours = () => { try { return JSON.parse(readFileSync(TOURS_DB, 'utf8')); } catch { return []; } };
const writeTours = (a) => writeFileSync(TOURS_DB, JSON.stringify(a, null, 2));

// data:image URL → file under uploads/tour/<id>/, returns a served URL (keeps JSON small)
function externalizeMedia(tourId, val, counter) {
  if (typeof val !== 'string') return val;
  const m = /^data:image\/([a-z]+);base64,(.+)$/s.exec(val);
  if (!m) return val;
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const dir = join(UPLOADS, 'tour', tourId);
  mkdirSync(dir, { recursive: true });
  const name = `m${counter.n++}.${ext}`;
  writeFileSync(join(dir, name), Buffer.from(m[2], 'base64'));
  return `/uploads/tour/${tourId}/${name}`;
}
function externalizeTour(tour) {
  const c = { n: Date.now() % 100000 }; // avoid overwriting previous saves
  const id = tour.id;
  if (tour.cover) tour.cover = externalizeMedia(id, tour.cover, c);
  if (tour.panorama) tour.panorama = externalizeMedia(id, tour.panorama, c);
  if (tour.planes && typeof tour.planes === 'object')
    for (const k of Object.keys(tour.planes))
      if (Array.isArray(tour.planes[k])) tour.planes[k] = tour.planes[k].map((v) => externalizeMedia(id, v, c));
  if (Array.isArray(tour.scenes))
    for (const s of tour.scenes) if (s?.panorama) s.panorama = externalizeMedia(id, s.panorama, c);
  return tour;
}

app.get('/api/tours', (_req, res) => res.json(readTours().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))));
app.get('/api/tours/:id', (req, res) => {
  const t = readTours().find((x) => x.id === req.params.id);
  return t ? res.json(t) : res.status(404).json({ error: 'not found' });
});
app.post('/api/tours', (req, res) => {
  const { name, type } = req.body || {};
  const tour = { id: uid('t'), seed: false, name: name || 'Без названия', type, createdAt: Date.now(), cover: null, startSceneId: null, scenes: [], videoUrl: null };
  const all = readTours(); all.push(tour); writeTours(all);
  res.json(tour);
});
app.put('/api/tours/:id', (req, res) => {
  const tour = req.body || {};
  tour.id = req.params.id;
  externalizeTour(tour);
  const all = readTours();
  const i = all.findIndex((t) => t.id === tour.id);
  if (i === -1) all.push(tour); else all[i] = tour;
  writeTours(all);
  res.json(tour);
});
app.delete('/api/tours/:id', (req, res) => {
  writeTours(readTours().filter((t) => t.id !== req.params.id));
  res.json({ ok: true });
});

// client-side remote logging (phone flows) → server console (demo.log)
app.post('/api/log', (req, res) => {
  const { level = 'log', msg = '', data, seq } = req.body || {};
  const tag = level === 'err' ? '🔴 [client]' : '🟢 [client]';
  let line = `${tag} #${seq ?? '?'} ${msg}`;
  if (data !== undefined) { try { line += ' ' + JSON.stringify(data); } catch { /* */ } }
  console.log(line.slice(0, 800));
  res.json({ ok: true });
});

app.get('/api/health', async (_req, res) => {
  try {
    const r = await fetch(`${KIRI}/balance`, { headers: authH });
    const j = await r.json();
    res.json({ ok: true, balance: j?.data?.balance ?? null });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.get('/api/video-tours', (_req, res) => {
  res.json(readDB().map(publicTour));
});

app.post('/api/video-tours', uploadMw.single('video'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'no video file' });
    const id = uid();
    const dir = join(UPLOADS, id);
    mkdirSync(dir, { recursive: true });
    const ext = extname(req.file.originalname || '.mp4') || '.mp4';
    writeFileSync(join(dir, 'input' + ext), req.file.buffer);

    const serialize = await kiriSubmitVideo(req.file.buffer, req.file.originalname);
    const tour = upsert({
      id,
      name: (req.body.name || '').trim() || 'Видео-тур',
      type: 'splat',
      serialize,
      status: 'processing',
      splatUrl: null,
      createdAt: Date.now(),
    });
    res.json(publicTour(tour));
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

app.get('/api/video-tours/:id', async (req, res) => {
  const tour = readDB().find((t) => t.id === req.params.id);
  if (!tour) return res.status(404).json({ error: 'not found' });
  try {
    res.json(publicTour(await refresh(tour)));
  } catch (e) {
    res.json({ ...publicTour(tour), refreshError: String(e.message || e) });
  }
});

function publicTour(t) {
  // never leak the serialize/key to the client
  const { serialize, ...rest } = t;
  return rest;
}

// serve the built SPA
const DIST = join(__dirname, '..', 'web', 'dist');
if (existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
    res.sendFile(join(DIST, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ Backend + SPA на http://localhost:${PORT}`);
  console.log(`   KIRI key: ${KEY ? 'загружен' : '❌ НЕ задан'}`);
});
