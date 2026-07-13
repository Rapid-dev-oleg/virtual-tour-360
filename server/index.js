// Local backend: KIRI Engine proxy (video -> 3D Gaussian Splatting) + serves the SPA.
// Keeps the secret KIRI key server-side. Runs locally; exposed via ngrok.
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import AdmZip from 'adm-zip';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

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
app.use(express.json());
app.use('/uploads', express.static(UPLOADS));

const uploadMw = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 1024 } });

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
