#!/usr/bin/env python3
"""
declutter.py — AI declutter pass for room photos.

Claude (vision) returns bounding boxes for loose clutter — explicitly keeping
appliances, ceiling fans, furniture, and anything built-in — and OpenCV
inpaints those regions. Pixels outside the boxes are untouched, so feature
matching between overlapping shots (and therefore stitching) is unaffected.

Standalone usage:
    python declutter.py ./photos/room1/          # edits JPEGs in place,
                                                 # originals -> _originals/

Requires ANTHROPIC_API_KEY in the environment (or an `ant auth login`
profile). Cost: one vision request per photo (~$0.01-0.02 each on Opus).
"""

import base64
import json
import shutil
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import cv2
import numpy as np

MODEL = "claude-opus-4-8"
MAX_API_DIM = 2048        # downscale the copy sent to the API; boxes scale back
MAX_BOX_FRACTION = 0.40   # ignore boxes covering more than this much of the
                          # image — clutter is small; a huge box is a model
                          # mistake that would erase furniture or a wall
INPAINT_PAD = 6
IMAGE_EXTS = {".jpg", ".jpeg", ".png"}

BOX_SCHEMA = {
    "type": "object",
    "properties": {
        "objects": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "label": {"type": "string"},
                    "x0": {"type": "integer"},
                    "y0": {"type": "integer"},
                    "x1": {"type": "integer"},
                    "y1": {"type": "integer"},
                },
                "required": ["label", "x0", "y0", "x1", "y1"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["objects"],
    "additionalProperties": False,
}

SYSTEM_PROMPT = (
    "You review real-estate listing photos and identify loose clutter that "
    "should be digitally removed before the listing is published."
)


def find_clutter(client, img, panorama=False):
    """Ask Claude for clutter bounding boxes. Returns a list of
    (label, x0, y0, x1, y1) in full-resolution pixel coordinates."""
    h, w = img.shape[:2]
    scale = min(1.0, MAX_API_DIM / max(h, w))
    api_img = img if scale == 1.0 else cv2.resize(
        img, (round(w * scale), round(h * scale)),
        interpolation=cv2.INTER_AREA)
    ah, aw = api_img.shape[:2]

    ok, buf = cv2.imencode(".jpg", api_img, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not ok:
        raise RuntimeError("could not JPEG-encode image for the API")
    b64 = base64.standard_b64encode(buf.tobytes()).decode()

    response = client.messages.create(
        model=MODEL,
        max_tokens=4000,
        thinking={"type": "adaptive"},
        system=SYSTEM_PROMPT,
        output_config={"format": {"type": "json_schema", "schema": BOX_SCHEMA}},
        messages=[{
            "role": "user",
            "content": [
                {"type": "image",
                 "source": {"type": "base64", "media_type": "image/jpeg",
                            "data": b64}},
                {"type": "text", "text":
                    (f"This is an equirectangular 360-degree panorama of a "
                     f"room, {aw}x{ah} pixels; objects may look curved or "
                     f"stretched by the projection. "
                     if panorama else
                     f"This photo is {aw}x{ah} pixels. ")
                    + "Identify every piece of "
                    "loose clutter that should be removed to make the room "
                    "presentation-ready: loose papers, cables, boxes, "
                    "clothing, dishes, bottles, bags, shoes, toys, trash, and "
                    "countertop or tabletop odds and ends. Do NOT include "
                    "furniture, appliances, ceiling fans, light fixtures, "
                    "curtains, rugs, wall art, plants, or anything built-in "
                    "or structural — those stay in place. Return a tight "
                    "pixel bounding box for each item. If the room is already "
                    "presentation-ready, return an empty list."},
            ],
        }],
    )
    if response.stop_reason == "refusal":
        raise RuntimeError("model declined to process this image")

    text = next(b.text for b in response.content if b.type == "text")
    boxes = []
    for obj in json.loads(text)["objects"]:
        x0 = round(min(obj["x0"], obj["x1"]) / scale)
        y0 = round(min(obj["y0"], obj["y1"]) / scale)
        x1 = round(max(obj["x0"], obj["x1"]) / scale)
        y1 = round(max(obj["y0"], obj["y1"]) / scale)
        x0, y0 = max(0, x0), max(0, y0)
        x1, y1 = min(w, x1), min(h, y1)
        if x1 <= x0 or y1 <= y0:
            continue
        if (x1 - x0) * (y1 - y0) > MAX_BOX_FRACTION * w * h:
            continue  # implausibly large for "clutter" — refuse to erase it
        boxes.append((obj["label"], x0, y0, x1, y1))
    return boxes


def remove_boxes(img, boxes):
    """Inpaint the boxed regions. Rough fill (Telea) — POC quality."""
    mask = np.zeros(img.shape[:2], np.uint8)
    for _, x0, y0, x1, y1 in boxes:
        cv2.rectangle(mask,
                      (max(0, x0 - INPAINT_PAD), max(0, y0 - INPAINT_PAD)),
                      (min(img.shape[1], x1 + INPAINT_PAD),
                       min(img.shape[0], y1 + INPAINT_PAD)),
                      255, -1)
    return cv2.inpaint(img, mask, 5, cv2.INPAINT_TELEA)


def declutter_pano(pano_path, engine="claude"):
    """Declutter a stitched panorama in place. engine="claude" uses Claude
    boxes + OpenCV inpaint (rough fill); engine="gemini" uses Gemini
    detection + generative patch fill (better quality, needs GEMINI_API_KEY).
    The untouched version is kept next to it as *_original.jpg.
    Returns (ok, list of log lines); never raises."""
    if engine == "openrouter":
        from declutter_openrouter import declutter_pano_openrouter
        return declutter_pano_openrouter(pano_path)

    if engine == "gemini":
        from declutter_gemini import declutter_pano_gemini
        return declutter_pano_gemini(pano_path)

    pano_path = Path(pano_path)
    lines = ["--- DECLUTTER (Claude vision + OpenCV inpaint, "
             "on the stitched panorama) ---"]
    try:
        import anthropic
        client = anthropic.Anthropic()
        img = cv2.imread(str(pano_path))
        if img is None:
            raise RuntimeError(f"could not read {pano_path}")
        boxes = find_clutter(client, img, panorama=True)
    except Exception as e:
        msg = str(e)
        if "authentication" in msg.lower() or "Could not resolve" in msg:
            lines.append("SKIPPED: no Anthropic API credentials found. Set "
                         "ANTHROPIC_API_KEY on the server to enable "
                         "decluttering.")
        else:
            lines.append(f"FAILED: {msg}. Panorama left as-is.")
        return False, lines

    if not boxes:
        lines.append("No removable clutter found.")
        return True, lines

    backup = pano_path.with_name(pano_path.stem + "_original.jpg")
    shutil.copy2(pano_path, backup)
    cv2.imwrite(str(pano_path), remove_boxes(img, boxes),
                [cv2.IMWRITE_JPEG_QUALITY, 90])
    labels = ", ".join(label for label, *_ in boxes)
    lines.append(f"Removed {len(boxes)} object(s): {labels}")
    lines.append(f"Untouched version kept as {backup.name}")
    return True, lines


def declutter_folder(folder):
    """Declutter every JPEG in `folder` in place (originals are kept in
    `folder/_originals/`). Returns (ok, list of log lines). Never raises —
    on failure the originals are left untouched so stitching can proceed."""
    folder = Path(folder)
    lines = ["--- DECLUTTER (Claude vision + OpenCV inpaint) ---"]

    try:
        import anthropic
        client = anthropic.Anthropic()
    except Exception as e:
        lines.append(f"SKIPPED: could not create API client ({e}). "
                     "Set ANTHROPIC_API_KEY to enable decluttering. "
                     "Stitching the original photos instead.")
        return False, lines

    paths = sorted(p for p in folder.iterdir()
                   if p.suffix.lower() in IMAGE_EXTS)
    originals = folder / "_originals"
    originals.mkdir(exist_ok=True)

    def process(path):
        img = cv2.imread(str(path))
        if img is None:
            return f"  {path.name}: could not read, left as-is"
        try:
            boxes = find_clutter(client, img)
        except Exception as e:
            return f"  {path.name}: FAILED ({e}), left as-is"
        if not boxes:
            return f"  {path.name}: no clutter found"
        shutil.copy2(path, originals / path.name)
        cv2.imwrite(str(path), remove_boxes(img, boxes),
                    [cv2.IMWRITE_JPEG_QUALITY, 92])
        labels = ", ".join(label for label, *_ in boxes)
        return f"  {path.name}: removed {len(boxes)} object(s) — {labels}"

    # probe with the first photo; an auth failure there means every call
    # would fail the same way — skip with one clean message
    first = process(paths[0])
    if "FAILED" in first and ("authentication" in first.lower()
                              or "Could not resolve" in first):
        lines.append("SKIPPED: no Anthropic API credentials found. "
                     "Set ANTHROPIC_API_KEY on the server to enable "
                     "decluttering. Stitching the original photos instead.")
        return False, lines

    with ThreadPoolExecutor(max_workers=3) as pool:
        results = [first] + list(pool.map(process, paths[1:]))
    lines.extend(results)

    failed = sum("FAILED" in r for r in results)
    if failed == len(paths):
        lines.append("All photos failed — stitching the original photos.")
        return False, lines
    lines.append(f"Originals kept in {originals}")
    return True, lines


def main():
    if len(sys.argv) != 2:
        sys.exit(f"usage: {sys.argv[0]} <folder-of-jpegs>")
    ok, lines = declutter_folder(sys.argv[1])
    print("\n".join(lines))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
