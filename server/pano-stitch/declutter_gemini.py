#!/usr/bin/env python3
"""
declutter_gemini.py — Gemini-based declutter with generative fill.

Gemini finds clutter bounding boxes, then each boxed region (plus context) is
cropped out, sent to Gemini's image model for generative object removal, and
feather-blended back into the full-resolution panorama. This keeps native
resolution everywhere except the repaired patches — Gemini's image output is
~1MP, far below a stitched pano, so whole-image editing would trash quality.

Requires GEMINI_API_KEY (from https://aistudio.google.com/apikey).
"""

import json
import shutil
from pathlib import Path

import cv2
import numpy as np

from declutter import MAX_BOX_FRACTION

# preferred model IDs, newest first; whatever the account actually has wins
DETECT_CANDIDATES = ["gemini-flash-latest", "gemini-3-flash-preview",
                     "gemini-2.5-flash", "gemini-2.0-flash"]
EDIT_CANDIDATES = ["gemini-3-pro-image-preview", "gemini-2.5-flash-image",
                   "gemini-2.0-flash-preview-image-generation"]
DETECT_MAX_DIM = 1536     # downscaled copy for detection; boxes scale back
PATCH_MAX_DIM = 1536      # patch size sent to the edit model
PATCH_PAD = 0.25          # context margin around a box (fraction of box size)
MAX_MERGED_DIM = 1500     # never merge patches into regions bigger than this
FEATHER = 20              # px blend ramp around each pasted box

# enforced response schema — the model can't produce malformed JSON
DETECT_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "objects": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "label": {"type": "STRING"},
                    "box_2d": {"type": "ARRAY",
                               "items": {"type": "INTEGER"}},
                },
                "required": ["label", "box_2d"],
            },
        }
    },
    "required": ["objects"],
}

DETECT_PROMPT = (
    "This is an equirectangular 360-degree panorama of a room; objects may "
    "look curved or stretched by the projection. Identify every piece of "
    "loose clutter that should be removed to make the room presentation-"
    "ready for a real-estate listing: loose papers, cables, boxes, clothing, "
    "dishes, bottles, bags, shoes, toys, trash, and countertop or tabletop "
    "odds and ends. Do NOT include furniture, appliances, ceiling fans, "
    "light fixtures, curtains, rugs, wall art, plants, or anything built-in "
    "or structural — those stay in place. "
    'Return JSON only: {"objects": [{"label": "...", '
    '"box_2d": [ymin, xmin, ymax, xmax]}]} with box_2d normalized to '
    "0-1000. Return an empty list if the room is already presentation-ready."
)


def _pick_models(client):
    """Ask the API which models this account can use and pick a text+vision
    model for detection and an image-output model for the generative fill.
    Google retires model IDs for new accounts, so hardcoding rots."""
    available = []
    for m in client.models.list():
        actions = getattr(m, "supported_actions", None)
        if actions and "generateContent" not in actions:
            continue
        available.append(m.name.split("/")[-1])

    def pick(candidates, fallback_pred):
        for c in candidates:
            if c in available:
                return c
        matches = sorted((n for n in available if fallback_pred(n)),
                         reverse=True)
        return matches[0] if matches else None

    detect = pick(DETECT_CANDIDATES,
                  lambda n: n.startswith("gemini") and "flash" in n
                  and not any(x in n for x in
                              ("image", "lite", "tts", "audio", "live",
                               "thinking", "8b")))
    edit = pick(EDIT_CANDIDATES,
                lambda n: n.startswith("gemini") and "image" in n
                and "imagen" not in n)
    return detect, edit


def _jpeg_part(img, types):
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    if not ok:
        raise RuntimeError("could not JPEG-encode image")
    return types.Part.from_bytes(data=buf.tobytes(), mime_type="image/jpeg")


def find_clutter_gemini(client, types, img, model):
    """Returns [(label, x0, y0, x1, y1)] in full-resolution pixels."""
    h, w = img.shape[:2]
    scale = min(1.0, DETECT_MAX_DIM / max(h, w))
    small = img if scale == 1.0 else cv2.resize(
        img, (round(w * scale), round(h * scale)),
        interpolation=cv2.INTER_AREA)

    data = None
    last_err = None
    for _ in range(2):  # schema makes malformed JSON rare; retry covers rest
        resp = client.models.generate_content(
            model=model,
            contents=[_jpeg_part(small, types), DETECT_PROMPT],
            config={"response_mime_type": "application/json",
                    "response_schema": DETECT_SCHEMA},
        )
        try:
            data = json.loads(resp.text)
            break
        except (json.JSONDecodeError, TypeError) as e:
            last_err = e
    if data is None:
        raise RuntimeError(f"model returned unparseable JSON twice "
                           f"({last_err})")

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


def _patch_rects(boxes, w, h):
    """Pad each box into a context patch and merge intersecting patches —
    but never into regions larger than MAX_MERGED_DIM, so a heavily
    cluttered area becomes several small edits, not one giant regeneration.
    Returns [(rect, contained boxes)]."""
    items = []
    for box in boxes:
        _, x0, y0, x1, y1 = box
        px = max(48, round((x1 - x0) * PATCH_PAD))
        py = max(48, round((y1 - y0) * PATCH_PAD))
        rect = [max(0, x0 - px), max(0, y0 - py),
                min(w, x1 + px), min(h, y1 + py)]
        items.append([rect, [box]])

    merged = True
    while merged:
        merged = False
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                a, b = items[i][0], items[j][0]
                if a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]:
                    u = [min(a[0], b[0]), min(a[1], b[1]),
                         max(a[2], b[2]), max(a[3], b[3])]
                    if (u[2] - u[0] > MAX_MERGED_DIM
                            or u[3] - u[1] > MAX_MERGED_DIM):
                        continue  # would create a huge patch — keep separate
                    items[i] = [u, items[i][1] + items[j][1]]
                    items.pop(j)
                    merged = True
                    break
            if merged:
                break
    return [(tuple(r), bs) for r, bs in items]


def _fill_patch(client, types, patch, labels, model):
    """Ask Gemini to remove the named objects from the patch. Returns the
    edited patch resized to the original patch dimensions, or None."""
    ph, pw = patch.shape[:2]
    scale = min(1.0, PATCH_MAX_DIM / max(ph, pw))
    small = patch if scale == 1.0 else cv2.resize(
        patch, (round(pw * scale), round(ph * scale)),
        interpolation=cv2.INTER_AREA)

    prompt = (
        f"Remove the following loose objects from this photo: "
        f"{', '.join(labels)}. Fill the vacated area naturally so it matches "
        "the surrounding floor, wall, or surface. Keep everything else in "
        "the image exactly identical — same framing, same lighting, same "
        "perspective. Return only the edited image.")
    resp = client.models.generate_content(
        model=model,
        contents=[_jpeg_part(small, types), prompt],
    )

    for cand in resp.candidates or []:
        for part in cand.content.parts or []:
            data = getattr(part, "inline_data", None)
            if data and data.data:
                arr = np.frombuffer(data.data, np.uint8)
                out = cv2.imdecode(arr, cv2.IMREAD_COLOR)
                if out is not None:
                    return cv2.resize(out, (pw, ph),
                                      interpolation=cv2.INTER_CUBIC)
    return None


def _paste_boxes_feathered(dst, patch, rect, patch_boxes):
    """Composite only the areas around the detected clutter boxes. Anything
    the model changed (or invented) elsewhere in its returned patch is
    discarded — a hallucinated appliance outside a box never lands."""
    x0, y0, x1, y1 = rect
    h, w = patch.shape[:2]
    mask = np.zeros((h, w), np.uint8)
    for _, bx0, by0, bx1, by1 in patch_boxes:
        cv2.rectangle(mask,
                      (max(0, bx0 - x0 - 12), max(0, by0 - y0 - 12)),
                      (min(w - 1, bx1 - x0 + 12), min(h - 1, by1 - y0 + 12)),
                      255, -1)
    dist = cv2.distanceTransform(mask, cv2.DIST_L2, 3)
    alpha = np.clip(dist / FEATHER, 0, 1)[..., None]
    region = dst[y0:y1, x0:x1].astype(np.float32)
    dst[y0:y1, x0:x1] = (
        alpha * patch.astype(np.float32) + (1 - alpha) * region
    ).astype(np.uint8)


def declutter_pano_gemini(pano_path):
    """Generatively declutter a stitched panorama in place. The untouched
    version is kept as *_original.jpg. Returns (ok, log lines)."""
    pano_path = Path(pano_path)
    lines = ["--- DECLUTTER (Gemini detection + generative fill) ---"]

    try:
        from google import genai
        from google.genai import types
        client = genai.Client()
        detect_model, edit_model = _pick_models(client)
        if not detect_model or not edit_model:
            raise RuntimeError(
                "no usable Gemini models on this account (need a vision "
                "model and an image-output model)")
        lines.append(f"Models: {detect_model} (detection), "
                     f"{edit_model} (generative fill)")
        img = cv2.imread(str(pano_path))
        if img is None:
            raise RuntimeError(f"could not read {pano_path}")
        boxes = find_clutter_gemini(client, types, img, detect_model)
    except Exception as e:
        msg = str(e)
        if "GEMINI_API_KEY" in msg or "api key" in msg.lower() \
                or "credential" in msg.lower():
            lines.append("SKIPPED: no Gemini API key found. Get one at "
                         "https://aistudio.google.com/apikey and set "
                         "GEMINI_API_KEY on the server.")
        else:
            lines.append(f"FAILED during detection: {msg}. "
                         "Panorama left as-is.")
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
            result = _fill_patch(client, types, img[y0:y1, x0:x1], labels,
                                 edit_model)
        except Exception as e:
            lines.append(f"  region with {', '.join(labels)}: FAILED ({e}), "
                         "left as-is")
            continue
        if result is None:
            lines.append(f"  region with {', '.join(labels)}: model returned "
                         "no image, left as-is")
            continue
        _paste_boxes_feathered(edited, result, rect, patch_boxes)
        filled += 1
        lines.append(f"  removed: {', '.join(labels)} "
                     f"({x1 - x0}x{y1 - y0}px region)")

    if filled == 0:
        lines.append("No regions could be edited — panorama left as-is.")
        return False, lines

    backup = pano_path.with_name(pano_path.stem + "_original.jpg")
    shutil.copy2(pano_path, backup)
    cv2.imwrite(str(pano_path), edited, [cv2.IMWRITE_JPEG_QUALITY, 90])
    lines.append(f"Untouched version kept as {backup.name}")
    return True, lines
