#!/usr/bin/env python3
"""Post-process a raw AI panorama into a seamless 4K HDR equirectangular.
Usage: python postprocess.py <in.jpg> <out.jpg>
Order is critical: 1) strict 2:1 4K, 2) HDR tone, 3) wrap-seam leveling LAST
(tile-based CLAHE breaks the seam, so it must run before the leveling).
"""
import sys
import cv2
import numpy as np


def process(src, dst):
    im = cv2.imread(src)
    if im is None:
        raise SystemExit(f"cannot read {src}")

    # 1) strict 2:1, 4K
    im = cv2.resize(im, (4096, 2048), interpolation=cv2.INTER_CUBIC)
    H, W = im.shape[:2]

    # 2) HDR-look: CLAHE on L (LAB) + gentle S-curve + saturation
    lab = cv2.cvtColor(im, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    l = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(l)
    im = cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)
    x = np.arange(256) / 255.0
    lut = (np.clip((x - 0.5) * 1.10 + 0.5, 0, 1) * 255).astype(np.uint8)
    im = cv2.LUT(im, lut)
    hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV).astype(np.float32)
    hsv[:, :, 1] *= 1.10
    im = cv2.cvtColor(np.clip(hsv, 0, 255).astype(np.uint8), cv2.COLOR_HSV2BGR).astype(np.float32)

    # 3) wrap-seam leveling LAST: linear per-row/per-channel ramp so col[0] == col[W-1]
    d = im[:, 0:1, :] - im[:, W - 1:W, :]
    xr = (np.arange(W) / (W - 1)).reshape(1, W, 1)
    im = np.clip(im + d * xr, 0, 255).astype(np.uint8)

    cv2.imwrite(dst, im, [cv2.IMWRITE_JPEG_QUALITY, 95])
    g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY).astype(np.float32)
    wrap = float(np.mean(np.abs(g[:, :8].mean(1) - g[:, -8:].mean(1))))
    print(f"OK {W}x{H} wrap={wrap:.2f}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: postprocess.py <in> <out>")
    process(sys.argv[1], sys.argv[2])
