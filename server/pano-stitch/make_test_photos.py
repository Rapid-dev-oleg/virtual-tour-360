#!/usr/bin/env python3
"""
make_test_photos.py — generate synthetic overlapping "room" photos for testing
stitch.py without a real photo shoot.

Builds a fake equirectangular room (textured walls, one blank wall and one
bright window as hard cases), then renders 10 perspective views rotating in
place with ~40% overlap, the same geometry as real phone shots.

Usage:
    python make_test_photos.py            # writes ./photos/testroom/img_00..09.jpg
"""

import math
from pathlib import Path

import cv2
import numpy as np

EQ_W, EQ_H = 4096, 2048
NUM_SHOTS = 10
HFOV_DEG = 62          # typical phone main camera
VIEW_W, VIEW_H = 1600, 1200
OUT_DIR = Path("photos/testroom")


def make_room():
    rng = np.random.default_rng(7)
    img = np.zeros((EQ_H, EQ_W, 3), np.uint8)

    # four wall base tones
    wall_colors = [(150, 140, 130), (135, 150, 140), (140, 135, 155),
                   (150, 150, 135)]
    for i, c in enumerate(wall_colors):
        img[:, i * EQ_W // 4:(i + 1) * EQ_W // 4] = c

    # ceiling / floor boundaries at ~ +/-18 deg latitude, like a real room seen
    # from its center — every landscape shot catches both edges
    ceil_y, floor_y = int(EQ_H * 0.40), int(EQ_H * 0.60)

    # ceiling: light gray with a few fixtures
    img[:ceil_y] = (228, 226, 224)
    for _ in range(4):
        c = (int(rng.integers(0, EQ_W)), int(rng.integers(60, ceil_y - 60)))
        cv2.circle(img, c, 46, (250, 250, 250), -1)
        cv2.circle(img, c, 46, (170, 170, 170), 8)

    # floor: wood planks
    plank_h = 34
    for y in range(floor_y, EQ_H, plank_h):
        shade = int(rng.integers(-16, 16))
        img[y:y + plank_h] = (70 + shade, 104 + shade, 138 + shade)
        cv2.line(img, (0, y), (EQ_W, y), (48, 70, 96), 3)
        for x in range(int(rng.integers(0, 300)), EQ_W, 420):
            cv2.line(img, (x, y), (x, min(y + plank_h, EQ_H - 1)),
                     (48, 70, 96), 3)

    cv2.line(img, (0, ceil_y), (EQ_W, ceil_y), (80, 80, 80), 6)
    cv2.line(img, (0, floor_y), (EQ_W, floor_y), (60, 60, 60), 6)

    # wall corner lines
    for i in range(4):
        x = i * EQ_W // 4
        cv2.line(img, (x, ceil_y), (x, floor_y), (90, 90, 90), 8)

    # "furniture" and "posters": random textured rectangles + circles
    for _ in range(160):
        x = int(rng.integers(0, EQ_W - 40))
        y = int(rng.integers(ceil_y, floor_y - 40))
        w = int(rng.integers(50, 260))
        h = int(rng.integers(40, 140))
        color = tuple(int(v) for v in rng.integers(30, 220, 3))
        cv2.rectangle(img, (x, y), (min(x + w, EQ_W - 1), min(y + h, floor_y)),
                      color, -1)
        cv2.rectangle(img, (x, y), (min(x + w, EQ_W - 1), min(y + h, floor_y)),
                      (40, 40, 40), 4)
    for _ in range(50):
        c = (int(rng.integers(0, EQ_W)), int(rng.integers(ceil_y, floor_y)))
        cv2.circle(img, c, int(rng.integers(15, 60)),
                   tuple(int(v) for v in rng.integers(30, 220, 3)), -1)

    # fine texture noise so feature detectors have plenty to grab
    noise = rng.normal(0, 7, img.shape)
    img = np.clip(img.astype(np.float32) + noise, 0, 255).astype(np.uint8)

    # HARD CASE 1: bright blown-out window on the upper wall (low texture,
    # high exposure) — textured wall remains below it
    wx0, wx1 = int(EQ_W * 0.70), int(EQ_W * 0.765)
    wy1 = int(EQ_H * 0.53)
    cv2.rectangle(img, (wx0, ceil_y + 30), (wx1, wy1), (252, 253, 254), -1)
    cv2.rectangle(img, (wx0, ceil_y + 30), (wx1, wy1), (170, 170, 170), 12)
    img[wy1:floor_y, wx0:wx1] = (146, 141, 136)  # bare wall under the window

    # HARD CASE 2: featureless blank wall section (~16 deg of yaw)
    bx0, bx1 = int(EQ_W * 0.33), int(EQ_W * 0.375)
    img[ceil_y + 6:floor_y - 6, bx0:bx1] = (148, 143, 138)

    return img


def render_view(equirect, yaw_deg, pitch_deg):
    """Render one perspective view from the equirect by pure rotation
    (exactly what a phone rotating in place sees, minus parallax)."""
    f = 0.5 * VIEW_W / math.tan(math.radians(HFOV_DEG) / 2)
    xs, ys = np.meshgrid(np.arange(VIEW_W, dtype=np.float32),
                         np.arange(VIEW_H, dtype=np.float32))
    d = np.stack([xs - VIEW_W / 2, ys - VIEW_H / 2,
                  np.full_like(xs, f)], axis=-1)

    yaw, pitch = math.radians(yaw_deg), math.radians(pitch_deg)
    cp, sp = math.cos(pitch), math.sin(pitch)
    cy, sy = math.cos(yaw), math.sin(yaw)
    Rx = np.array([[1, 0, 0], [0, cp, -sp], [0, sp, cp]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    d = d @ (Ry @ Rx).T.astype(np.float32)

    lon = np.arctan2(d[..., 0], d[..., 2])
    lat = np.arctan2(d[..., 1], np.hypot(d[..., 0], d[..., 2]))
    map_x = (((lon / (2 * math.pi)) + 0.5) % 1.0) * (EQ_W - 1)
    map_y = np.clip(((lat / math.pi) + 0.5) * (EQ_H - 1), 0, EQ_H - 1)
    return cv2.remap(equirect, map_x.astype(np.float32),
                     map_y.astype(np.float32), cv2.INTER_LINEAR)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    room = make_room()
    # reference render of the full room, for eyeballing against stitch output
    cv2.imwrite("ground_truth_equirect.png", room)

    rng = np.random.default_rng(42)
    step = 360 / NUM_SHOTS
    for i in range(NUM_SHOTS):
        yaw = i * step + float(rng.uniform(-3, 3))     # imperfect rotation
        pitch = float(rng.uniform(-2, 2))              # hand-held wobble
        view = render_view(room, yaw, pitch)
        out = OUT_DIR / f"img_{i:02d}.jpg"
        cv2.imwrite(str(out), view, [cv2.IMWRITE_JPEG_QUALITY, 92])
        print(f"{out}  yaw={yaw:6.1f}  pitch={pitch:+.1f}")

    overlap = 100 * (HFOV_DEG - step) / HFOV_DEG
    print(f"\n{NUM_SHOTS} shots, hfov {HFOV_DEG} deg, step {step:.0f} deg "
          f"-> ~{overlap:.0f}% overlap between neighbours")


if __name__ == "__main__":
    main()
