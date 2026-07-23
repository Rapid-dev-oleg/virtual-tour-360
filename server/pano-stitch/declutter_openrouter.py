#!/usr/bin/env python3
"""
declutter_openrouter.py — OpenRouter port of declutter_gemini.py.

Identical pipeline, prompts, schema fields and behaviour as the Gemini version,
but every model call goes through OpenRouter (google/gemini-* slugs) so it runs
with an OPENROUTER_API_KEY instead of a direct Gemini key.

  detection    = a vision chat model with JSON-schema structured output
                 (google/gemini-2.5-flash), same DETECT_PROMPT as the original
  generative   = the images endpoint (google/gemini-2.5-flash-image), same
  fill           per-patch "remove these objects" prompt as the original

Everything else — box normalisation (0-1000), MAX_BOX_FRACTION guard, patch
padding/merging, and feathered box-only paste — is imported verbatim from the
original modules so the OpenRouter path stays faithful to the lib.
"""

import base64
import json
import os
import shutil
import urllib.request
from pathlib import Path

import cv2
import numpy as np

# reuse the lib's own prompt, patch geometry and feather-paste — do not fork them
from declutter_gemini import (
    DETECT_PROMPT, DETECT_MAX_DIM, PATCH_MAX_DIM,
    _patch_rects, _paste_boxes_feathered,
)
from declutter import MAX_BOX_FRACTION

OPENROUTER_URL = "https://openrouter.ai/api/v1"
# same models the lib's README documents; overridable via env
DETECT_MODEL = os.environ.get("OR_DETECT_MODEL", "google/gemini-2.5-flash")
EDIT_MODEL = os.environ.get("OR_EDIT_MODEL", "google/gemini-2.5-flash-image")

# the lib's DETECT_SCHEMA, expressed in standard (lowercase) JSON Schema for
# OpenRouter structured output — identical fields: objects[].label, box_2d[4]
DETECT_SCHEMA = {
    "type": "object",
    "properties": {
        "objects": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "label": {"type": "string"},
                    "box_2d": {"type": "array", "items": {"type": "integer"}},
                },
                "required": ["label", "box_2d"],
            },
        }
    },
    "required": ["objects"],
}


def _key():
    k = os.environ.get("OPENROUTER_API_KEY")
    if not k:
        raise RuntimeError("OPENROUTER_API_KEY not set")
    return k


def _post(path, payload, timeout=180):
    req = urllib.request.Request(
        f"{OPENROUTER_URL}{path}",
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {_key()}",
                 "Content-Type": "application/json"},
        method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def _data_url(img, q=92):
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, q])
    if not ok:
        raise RuntimeError("could not JPEG-encode image")
    return "data:image/jpeg;base64," + base64.standard_b64encode(buf.tobytes()).decode()


def find_clutter_openrouter(img):
    """Returns [(label, x0, y0, x1, y1)] in full-resolution pixels."""
    h, w = img.shape[:2]
    scale = min(1.0, DETECT_MAX_DIM / max(h, w))
    small = img if scale == 1.0 else cv2.resize(
        img, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)

    payload = {
        "model": DETECT_MODEL,
        "messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": _data_url(small)}},
            {"type": "text", "text": DETECT_PROMPT},
        ]}],
        "response_format": {"type": "json_schema", "json_schema": {
            "name": "clutter", "strict": True, "schema": DETECT_SCHEMA}},
    }

    data = None
    last_err = None
    for _ in range(2):  # schema makes malformed JSON rare; retry covers the rest
        resp = _post("/chat/completions", payload)
        try:
            data = json.loads(resp["choices"][0]["message"]["content"])
            break
        except (json.JSONDecodeError, TypeError, KeyError, IndexError) as e:
            last_err = e
    if data is None:
        raise RuntimeError(f"model returned unparseable JSON twice ({last_err})")

    boxes = []
    for obj in data.get("objects", []):
        if len(obj.get("box_2d", [])) != 4:
            continue
        ymin, xmin, ymax, xmax = obj["box_2d"]
        x0 = round(min(xmin, xmax) / 1000 * w)
        y0 = round(min(ymin, ymax) / 1000 * h)
        x1 = round(max(xmin, xmax) / 1000 * w)
        y1 = round(max(ymin, ymax) / 1000 * h)
        x0, y0 = max(0, x0), max(0, y0)
        x1, y1 = min(w, x1), min(h, y1)
        if x1 <= x0 or y1 <= y0:
            continue
        if (x1 - x0) * (y1 - y0) > MAX_BOX_FRACTION * w * h:
            continue  # implausibly large for "clutter"
        boxes.append((obj.get("label", "object"), x0, y0, x1, y1))
    return boxes


def _fill_patch_openrouter(patch, labels):
    """Ask the image model to remove the named objects from the patch. Returns
    the edited patch resized to the original patch dimensions, or None."""
    ph, pw = patch.shape[:2]
    scale = min(1.0, PATCH_MAX_DIM / max(ph, pw))
    small = patch if scale == 1.0 else cv2.resize(
        patch, (round(pw * scale), round(ph * scale)), interpolation=cv2.INTER_AREA)

    prompt = (
        f"Remove the following loose objects from this photo: "
        f"{', '.join(labels)}. Fill the vacated area naturally so it matches "
        "the surrounding floor, wall, or surface. Keep everything else in "
        "the image exactly identical — same framing, same lighting, same "
        "perspective. Return only the edited image.")

    resp = _post("/images", {
        "model": EDIT_MODEL,
        "prompt": prompt,
        "input_references": [{"type": "image_url", "image_url": {"url": _data_url(small)}}],
    })
    b64 = (resp.get("data") or [{}])[0].get("b64_json")
    if not b64:
        return None
    arr = np.frombuffer(base64.b64decode(b64), np.uint8)
    out = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if out is None:
        return None
    return cv2.resize(out, (pw, ph), interpolation=cv2.INTER_CUBIC)


def declutter_pano_openrouter(pano_path):
    """Generatively declutter a stitched panorama in place via OpenRouter.
    The untouched version is kept as *_original.jpg. Returns (ok, log lines)."""
    pano_path = Path(pano_path)
    lines = ["--- DECLUTTER (OpenRouter: detection + generative fill) ---"]

    try:
        img = cv2.imread(str(pano_path))
        if img is None:
            raise RuntimeError(f"could not read {pano_path}")
        _key()  # fail fast with a clear message if the key is missing
        lines.append(f"Models: {DETECT_MODEL} (detection), {EDIT_MODEL} (generative fill)")
        boxes = find_clutter_openrouter(img)
    except Exception as e:
        msg = str(e)
        if "OPENROUTER_API_KEY" in msg:
            lines.append("SKIPPED: OPENROUTER_API_KEY not set on the container.")
        else:
            lines.append(f"FAILED during detection: {msg}. Panorama left as-is.")
        return False, lines

    if not boxes:
        lines.append("No removable clutter found.")
        return True, lines

    h, w = img.shape[:2]
    patches = _patch_rects(boxes, w, h)
    lines.append(f"Found {len(boxes)} object(s) in {len(patches)} region(s): "
                 + ", ".join(label for label, *_ in boxes))

    edited = img.copy()
    filled = 0
    for rect, patch_boxes in patches:
        x0, y0, x1, y1 = rect
        labels = [b[0] for b in patch_boxes]
        try:
            result = _fill_patch_openrouter(img[y0:y1, x0:x1], labels)
        except Exception as e:
            lines.append(f"  region with {', '.join(labels)}: FAILED ({e}), left as-is")
            continue
        if result is None:
            lines.append(f"  region with {', '.join(labels)}: model returned no image, left as-is")
            continue
        _paste_boxes_feathered(edited, result, rect, patch_boxes)
        filled += 1
        lines.append(f"  removed: {', '.join(labels)} ({x1 - x0}x{y1 - y0}px region)")

    if filled == 0:
        lines.append("No regions could be edited — panorama left as-is.")
        return False, lines

    backup = pano_path.with_name(pano_path.stem + "_original.jpg")
    shutil.copy2(pano_path, backup)
    cv2.imwrite(str(pano_path), edited, [cv2.IMWRITE_JPEG_QUALITY, 90])
    lines.append(f"Untouched version kept as {backup.name}")
    return True, lines
