#!/usr/bin/env python3
"""
fixstitch.py — AI post-process for a real OpenCV stitch. Two modes:

  repair  (faithful) — detect the defect mask (edge-stretched poles + blank
          corner wedges, which are vertically CONSTANT from the top/bottom edge)
          and composite an AI fill ONLY inside that mask. Real textured pixels
          are never touched, so the model can't repaint the furniture — it only
          fills the holes. Keeps the untouched stitch as *_stitchonly.jpg.

  render  (full) — hand the whole stitch to a strong image model and let it
          re-render a clean, seamless, distortion-corrected 2:1 equirect of the
          SAME room. Uses the AI output directly. Fixes warps/seams the masked
          repair can't, at the cost of the model re-drawing real content.

Usage: python fixstitch.py <in.jpg> <out.jpg> [repair|render]   (default repair)
Env:   OPENROUTER_API_KEY (required)
       OR_FIX_MODEL    (repair fill model, default google/gemini-2.5-flash-image)
       OR_RENDER_MODEL (render model,     default google/gemini-3-pro-image)
"""

import base64
import json
import os
import shutil
import sys
import urllib.request
from pathlib import Path

import cv2
import numpy as np

FIX_MODEL = os.environ.get("OR_FIX_MODEL", "google/gemini-3-pro-image")
RENDER_MODEL = os.environ.get("OR_RENDER_MODEL", "google/gemini-3-pro-image")
REQ_MAX_DIM = 2048      # downscale sent to the model; result is resized back
FLAT_THR = 3            # |Δ| ≤ this (gray) counts as a "constant" vertical step
FEATHER = 24            # px blend ramp at the mask edge

REPAIR_PROMPT = (
    "This is a real 360-degree equirectangular panorama (2:1) of a room, "
    "stitched from photos. The very top (ceiling), the very bottom (floor) and "
    "the flat/blank corner wedges are missing or edge-stretched. Produce a "
    "COMPLETE 2:1 equirectangular image of the SAME room from the same "
    "viewpoint and the same framing. Keep every existing wall, floor, piece of "
    "furniture, object, colour and texture EXACTLY as shown and in the same "
    "position — do not redraw, restyle or move anything already there. ONLY "
    "fill the missing top, bottom and blank areas with a plain, plausible "
    "continuation of the adjacent ceiling, floor or wall surface. Do not add "
    "any furniture or objects. Output only the image."
)

RENDER_PROMPT = (
    "This is a real 360-degree equirectangular panorama (2:1) of a room, "
    "stitched from overlapping photos, so it has stitching defects: warped and "
    "bent walls, uneven horizon, seams, edge-stretched poles and blank corner "
    "wedges. Re-render a single CLEAN, seamless 2:1 equirectangular panorama of "
    "THIS EXACT room from the centre. Keep the same furniture, layout, wall "
    "colours, materials, windows, doors and objects as in the image and in "
    "their real positions — do not invent, add or remove furniture. FIX the "
    "stitching distortions: straighten vertical lines, level the horizon, give "
    "walls a natural equirectangular curvature, remove seams, and fill the top "
    "(ceiling) and bottom (floor) and any blank areas naturally. The left and "
    "right edges must wrap seamlessly. Output only the finished 2:1 image."
)


def defect_mask(im):
    """255 where a pixel is part of a constant vertical run reaching the top or
    bottom edge (edge-stretch + blank corners); 0 on real textured content."""
    gray = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY).astype(np.int16)
    H, W = gray.shape
    flat = np.abs(np.diff(gray, axis=0)) <= FLAT_THR   # (H-1, W)
    mask = np.zeros((H, W), np.uint8)

    top_run = np.zeros(W, np.int32)
    running = np.ones(W, bool)
    for y in range(H - 1):
        running &= flat[y]
        top_run += running.astype(np.int32)
    bot_run = np.zeros(W, np.int32)
    running = np.ones(W, bool)
    for y in range(H - 2, -1, -1):
        running &= flat[y]
        bot_run += running.astype(np.int32)

    for x in range(W):
        if top_run[x] > 0:
            mask[0:top_run[x] + 1, x] = 255
        if bot_run[x] > 0:
            mask[H - bot_run[x] - 1:H, x] = 255
    return mask


def _data_url(img, q=92):
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, q])
    if not ok:
        raise SystemExit("could not JPEG-encode image")
    return "data:image/jpeg;base64," + base64.standard_b64encode(buf.tobytes()).decode()


def call_model(im, model, prompt, max_dim, extra=None):
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise SystemExit("OPENROUTER_API_KEY not set")
    H, W = im.shape[:2]
    scale = min(1.0, max_dim / max(H, W))
    small = im if scale == 1.0 else cv2.resize(
        im, (round(W * scale), round(H * scale)), interpolation=cv2.INTER_AREA)
    payload = {"model": model, "prompt": prompt,
               "input_references": [{"type": "image_url", "image_url": {"url": _data_url(small)}}]}
    if extra:
        payload.update(extra)
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/images",
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST")
    with urllib.request.urlopen(req, timeout=600) as r:
        resp = json.loads(r.read().decode())
    b64 = (resp.get("data") or [{}])[0].get("b64_json")
    if not b64:
        raise SystemExit(f"model returned no image: {json.dumps(resp.get('error') or resp)[:300]}")
    arr = np.frombuffer(base64.b64decode(b64), np.uint8)
    out = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if out is None:
        raise SystemExit("could not decode model image")
    return out


def to_2to1(im):
    H = im.shape[0]
    return cv2.resize(im, (H * 2, H), interpolation=cv2.INTER_AREA if im.shape[1] > H * 2 else cv2.INTER_CUBIC)


def repair(src, dst):
    im = cv2.imread(src)
    if im is None:
        raise SystemExit(f"cannot read {src}")
    mask = defect_mask(im)
    frac = float(mask.mean()) / 255
    if frac < 0.002:
        print(f"OK no defects to fill (mask {frac*100:.1f}%) — left as-is")
        if src != dst:
            shutil.copy2(src, dst)
        return
    H, W = im.shape[:2]
    fill = cv2.resize(call_model(im, FIX_MODEL, REPAIR_PROMPT, REQ_MAX_DIM), (W, H),
                      interpolation=cv2.INTER_CUBIC)
    dist = cv2.distanceTransform(255 - mask, cv2.DIST_L2, 3)
    alpha = np.clip(1 - dist / FEATHER, 0, 1)[..., None]
    out = (alpha * fill.astype(np.float32) + (1 - alpha) * im.astype(np.float32)).astype(np.uint8)
    _backup(src, dst)
    cv2.imwrite(dst, out, [cv2.IMWRITE_JPEG_QUALITY, 92])
    print(f"OK repair: filled defect mask {frac*100:.1f}% via {FIX_MODEL}")


def render(src, dst):
    im = cv2.imread(src)
    if im is None:
        raise SystemExit(f"cannot read {src}")
    out = to_2to1(call_model(im, RENDER_MODEL, RENDER_PROMPT, REQ_MAX_DIM,
                             extra={"resolution": "4K"}))
    _backup(src, dst)
    cv2.imwrite(dst, out, [cv2.IMWRITE_JPEG_QUALITY, 92])
    print(f"OK render: re-rendered {out.shape[1]}x{out.shape[0]} via {RENDER_MODEL}")


def _backup(src, dst):
    p = Path(dst)
    if Path(src).resolve() == p.resolve():
        shutil.copy2(src, p.with_name(p.stem + "_stitchonly.jpg"))


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit("usage: fixstitch.py <in> <out> [repair|render]")
    mode = sys.argv[3] if len(sys.argv) > 3 else "repair"
    (render if mode == "render" else repair)(sys.argv[1], sys.argv[2])
