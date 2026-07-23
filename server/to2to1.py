#!/usr/bin/env python3
"""Force an image to a strict 2:1 equirectangular ratio (width = 2 × height),
keeping native height. Same idea as the PIL snippet, done with OpenCV (cv2).
Usage: python to2to1.py <in.jpg> <out.jpg>   (in == out is fine, resizes in place)
"""
import sys
import cv2


def process(src, dst):
    im = cv2.imread(src)
    if im is None:
        raise SystemExit(f"cannot read {src}")
    H, W = im.shape[:2]
    tw = H * 2  # target width for a perfect 2:1
    if W != tw:
        interp = cv2.INTER_AREA if tw < W else cv2.INTER_LANCZOS4
        im = cv2.resize(im, (tw, H), interpolation=interp)
    cv2.imwrite(dst, im, [cv2.IMWRITE_JPEG_QUALITY, 95])
    print(f"OK {W}x{H} -> {tw}x{H}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: to2to1.py <in> <out>")
    process(sys.argv[1], sys.argv[2])
