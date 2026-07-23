#!/usr/bin/env python3
"""
serve.py — tiny local web UI for the stitcher.

Drop 8-12 overlapping room photos in the browser, get diagnostics and a
spinning 360 viewer back. Runs stitch.py under the hood; HEIC uploads are
converted with macOS `sips` automatically.

    ./venv/bin/python serve.py     # then open http://localhost:8151
"""

import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

BASE = Path(__file__).resolve().parent
UPLOADS = BASE / "uploads"
OUTPUT = BASE / "output"
ALLOWED = {".jpg", ".jpeg", ".png", ".heic", ".heif"}
PORT = int(os.environ.get("PORT", "8151"))

app = Flask(__name__)

PAGE = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Panorama stitcher</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: #14161a; color: #e6e8eb;
         font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  main { max-width: 860px; margin: 0 auto; padding: 40px 24px 80px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: #9aa1a9; margin: 0 0 28px; }
  #drop { border: 2px dashed #3a4048; border-radius: 12px; padding: 44px 20px;
          text-align: center; color: #9aa1a9; cursor: pointer;
          transition: border-color .15s, background .15s; }
  #drop.hover { border-color: #5b9dd9; background: #1a2129; color: #cfd6dd; }
  #drop strong { color: #e6e8eb; }
  #filelist { margin: 14px 0 0; padding: 0; list-style: none; font-size: 13px;
              color: #9aa1a9; columns: 2; }
  #filelist li { padding: 1px 0; }
  .row { display: flex; gap: 12px; margin-top: 20px; align-items: center; }
  .toggle { display: flex; gap: 10px; margin-top: 16px; align-items: flex-start;
            font-size: 13px; color: #9aa1a9; cursor: pointer; }
  .toggle input { margin-top: 3px; accent-color: #2f6feb; }
  .toggle strong { color: #e6e8eb; }
  .toggle select { display: block; margin-top: 8px; background: #1c1f24;
          border: 1px solid #3a4048; border-radius: 6px; color: #e6e8eb;
          padding: 6px 8px; font-size: 13px; }
  input[type=text] { flex: 1; background: #1c1f24; border: 1px solid #3a4048;
          border-radius: 8px; color: #e6e8eb; padding: 10px 12px; font-size: 15px; }
  button { background: #2f6feb; border: 0; border-radius: 8px; color: #fff;
           padding: 10px 22px; font-size: 15px; font-weight: 600; cursor: pointer; }
  button:disabled { background: #2a2f36; color: #6b7280; cursor: default; }
  #status { margin-top: 22px; }
  .spin { display: inline-block; width: 14px; height: 14px; margin-right: 8px;
          border: 2px solid #5b9dd9; border-top-color: transparent;
          border-radius: 50%; animation: r 0.8s linear infinite;
          vertical-align: -2px; }
  @keyframes r { to { transform: rotate(360deg); } }
  .ok { color: #4cc38a; font-weight: 600; }
  .bad { color: #e5534b; font-weight: 600; }
  pre { background: #0e1013; border: 1px solid #2a2f36; border-radius: 8px;
        padding: 14px; font-size: 12px; line-height: 1.45; overflow-x: auto;
        white-space: pre-wrap; }
  details { margin-top: 14px; }
  summary { cursor: pointer; color: #9aa1a9; }
  iframe { width: 100%; height: 480px; border: 1px solid #2a2f36;
           border-radius: 12px; margin-top: 18px; background: #000; }
  a { color: #5b9dd9; }
</style>
</head>
<body>
<main>
  <h1>Panorama stitcher</h1>
  <p class="sub">Drop 8&ndash;20 overlapping photos of a room (shot rotating in place).
     JPEG or HEIC &mdash; stitched in filename order. More photos = more overlap
     = more reliable seams.</p>

  <div id="drop">
    <strong>Drop photos here</strong> or click to choose<br>
    <span id="count"></span>
  </div>
  <input type="file" id="picker" multiple accept=".jpg,.jpeg,.png,.heic,.heif,image/*" hidden>
  <ul id="filelist"></ul>

  <div class="row">
    <input type="text" id="room" placeholder="room name (e.g. living-room)">
    <button id="go" disabled>Stitch</button>
  </div>

  <label class="toggle">
    <input type="checkbox" id="declutter">
    <span><strong>Declutter</strong> — Gemini removes loose objects (papers,
    boxes, clothes, cables…) from the finished panorama with generative fill.
    Appliances, ceiling fans and furniture stay in place. Needs GEMINI_API_KEY
    on the server.</span>
  </label>

  <div id="status"></div>
  <div id="result"></div>
</main>

<script>
const drop = document.getElementById('drop');
const picker = document.getElementById('picker');
const go = document.getElementById('go');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
let files = [];

function refresh() {
  files.sort((a, b) => a.name.localeCompare(b.name));
  document.getElementById('filelist').innerHTML =
    files.map(f => `<li>${f.name}</li>`).join('');
  document.getElementById('count').textContent =
    files.length ? `${files.length} photo(s) selected` : '';
  go.disabled = files.length < 2;
}
function addFiles(list) {
  for (const f of list) {
    if (!files.some(x => x.name === f.name)) files.push(f);
  }
  refresh();
}
drop.onclick = () => picker.click();
picker.onchange = () => { addFiles(picker.files); picker.value = ''; };
drop.ondragover = e => { e.preventDefault(); drop.classList.add('hover'); };
drop.ondragleave = () => drop.classList.remove('hover');
drop.ondrop = e => { e.preventDefault(); drop.classList.remove('hover');
                     addFiles(e.dataTransfer.files); };

go.onclick = async () => {
  go.disabled = true;
  resultEl.innerHTML = '';
  const decluttering = document.getElementById('declutter').checked;
  statusEl.innerHTML = '<span class="spin"></span>' + (decluttering
    ? 'Stitching, then decluttering — typically 1–5 minutes…'
    : 'Stitching — up to a few minutes if seams need recovery…');
  const fd = new FormData();
  fd.append('room', document.getElementById('room').value);
  fd.append('declutter', document.getElementById('declutter').checked ? '1' : '0');
  for (const f of files) fd.append('photos', f, f.name);
  try {
    const res = await fetch('/stitch', { method: 'POST', body: fd });
    const data = await res.json();
    statusEl.innerHTML = data.ok
      ? '<span class="ok">Stitched ✓</span> — drag inside the viewer to spin.'
      : '<span class="bad">Stitch failed</span> — diagnostics below say which seams broke.';
    let html = '';
    if (data.viewer) {
      html += `<iframe src="${data.viewer}"></iframe>
               <p><a href="${data.viewer}" target="_blank">Open viewer full-screen</a> ·
                  <a href="${data.image}" target="_blank">Raw equirectangular JPEG</a></p>`;
    }
    html += `<details ${data.ok ? '' : 'open'}><summary>Diagnostics</summary>
             <pre>${data.log.replace(/</g, '&lt;')}</pre></details>`;
    resultEl.innerHTML = html;
  } catch (err) {
    statusEl.innerHTML = `<span class="bad">Request failed:</span> ${err}`;
  }
  go.disabled = false;
};
</script>
</body>
</html>
"""


@app.get("/")
def index():
    return PAGE


@app.post("/stitch")
def stitch():
    room = re.sub(r"[^a-zA-Z0-9_-]", "", request.form.get("room", ""))
    room = room or time.strftime("room-%Y%m%d-%H%M%S")

    folder = UPLOADS / room
    if folder.exists():
        shutil.rmtree(folder)
    folder.mkdir(parents=True)

    saved = 0
    for f in request.files.getlist("photos"):
        name = Path(f.filename).name
        if Path(name).suffix.lower() in ALLOWED:
            f.save(folder / name)
            saved += 1
    if saved < 2:
        return jsonify(ok=False, viewer=None, image=None,
                       log="Need at least 2 JPEG/HEIC photos.")

    # convert HEIC in place with macOS sips
    heics = [p for p in folder.iterdir() if p.suffix.lower() in {".heic", ".heif"}]
    if heics and not shutil.which("sips"):
        return jsonify(ok=False, viewer=None, image=None,
                       log="HEIC files uploaded but `sips` is unavailable — "
                           "convert to JPEG first.")
    for p in heics:
        subprocess.run(["sips", "-s", "format", "jpeg", str(p),
                        "--out", str(p.with_suffix(".jpg"))],
                       capture_output=True)
        p.unlink()

    out_dir = OUTPUT / room
    out_dir.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        [sys.executable, str(BASE / "stitch.py"), str(folder),
         "--out", str(out_dir / "pano.jpg")],
        capture_output=True, text=True, timeout=1800)

    ok = proc.returncode == 0
    log = (proc.stdout + proc.stderr).strip()

    # declutter the finished panorama (one API call, consistent edits) rather
    # than the input photos, where per-photo edits blend into smudges
    if ok and request.form.get("declutter") == "1":
        from declutter import declutter_pano
        _, lines = declutter_pano(out_dir / "pano.jpg", engine="openrouter")
        log += "\n\n" + "\n".join(lines)
    return jsonify(ok=ok,
                   viewer=f"/output/{room}/viewer.html" if ok else None,
                   image=f"/output/{room}/pano.jpg" if ok else None,
                   log=log)


@app.get("/output/<path:name>")
def output_files(name):
    return send_from_directory(OUTPUT, name)


if __name__ == "__main__":
    print(f"Panorama stitcher UI: http://localhost:{PORT}")
    app.run(host="127.0.0.1", port=PORT)
