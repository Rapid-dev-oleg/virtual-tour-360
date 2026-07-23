#!/usr/bin/env python3
"""
stitch.py — panorama stitching validation tool (proof of concept).

Stitches a folder of overlapping photos (shot rotating in place) into an
equirectangular 360 panorama and writes a Pannellum viewer next to it.

Usage:
    python stitch.py ./photos/room1/ --out ./output/room1.jpg
"""

import argparse
import math
import os
import resource
import sys
import time
from contextlib import contextmanager
from pathlib import Path

import cv2
import numpy as np

JPEG_QUALITY = 90
MIN_OUT_W, MIN_OUT_H = 4096, 2048
IMAGE_EXTS = {".jpg", ".jpeg", ".png"}
HEIC_EXTS = {".heic", ".heif"}

STATUS_MEANINGS = {
    cv2.Stitcher_OK: "OK",
    cv2.Stitcher_ERR_NEED_MORE_IMGS:
        "ERR_NEED_MORE_IMGS — stitcher could not find enough matchable overlapping "
        "images (too little overlap, or too few features in the overlap zones)",
    cv2.Stitcher_ERR_HOMOGRAPHY_EST_FAIL:
        "ERR_HOMOGRAPHY_EST_FAIL — could not estimate a homography between some "
        "images (overlap too small, motion parallax from not rotating in place, "
        "or featureless overlap like a blank wall)",
    cv2.Stitcher_ERR_CAMERA_PARAMS_ADJUST_FAIL:
        "ERR_CAMERA_PARAMS_ADJUST_FAIL — bundle adjustment failed (matches were "
        "found but are geometrically inconsistent, often caused by parallax or "
        "repeated patterns)",
}


def fail(msg):
    print(f"\nFAILED: {msg}", file=sys.stderr)
    sys.exit(1)


@contextmanager
def quiet_native_output():
    """LAPACK inside OpenCV's bundle adjuster spams '** On entry to DLASCL...'
    warnings straight to the C-level stdout/stderr; silence them for the
    duration of the call (harmless, but thousands of lines)."""
    sys.stdout.flush()
    sys.stderr.flush()
    saved = os.dup(1), os.dup(2)
    devnull = os.open(os.devnull, os.O_WRONLY)
    os.dup2(devnull, 1)
    os.dup2(devnull, 2)
    try:
        yield
    finally:
        sys.stdout.flush()
        sys.stderr.flush()
        # also flush the C-level streams: LAPACK's warnings sit in the libc
        # stdio buffer and would otherwise surface after the fds are restored
        try:
            import ctypes
            ctypes.CDLL(None).fflush(None)
        except Exception:
            pass
        os.dup2(saved[0], 1)
        os.dup2(saved[1], 2)
        for fd in (*saved, devnull):
            os.close(fd)


# ---------------------------------------------------------------- loading

def load_images(folder, max_dim):
    folder = Path(folder)
    if not folder.is_dir():
        fail(f"input folder not found: {folder}")

    heic = sorted(p.name for p in folder.iterdir() if p.suffix.lower() in HEIC_EXTS)
    if heic:
        print(f"NOTE: {len(heic)} HEIC file(s) found but HEIC is not supported "
              f"(OpenCV cannot decode it). Convert to JPEG first, e.g. on macOS:")
        print(f'  cd "{folder}" && for f in *.HEIC; do sips -s format jpeg "$f" '
              f'--out "${{f%.*}}.jpg"; done')

    paths = sorted(p for p in folder.iterdir() if p.suffix.lower() in IMAGE_EXTS)
    if len(paths) < 2:
        fail(f"need at least 2 JPEG images in {folder}, found {len(paths)}")

    images, names = [], []
    for p in paths:
        img = cv2.imread(str(p))
        if img is None:
            print(f"  WARNING: could not decode {p.name}, skipping")
            continue
        h, w = img.shape[:2]
        if max(h, w) > max_dim:
            scale = max_dim / max(h, w)
            img = cv2.resize(img, (round(w * scale), round(h * scale)),
                             interpolation=cv2.INTER_AREA)
        images.append(img)
        names.append(p.name)

    print(f"Loaded {len(images)} images from {folder} "
          f"(largest dimension capped at {max_dim}px):")
    for name, img in zip(names, images):
        print(f"  {name}  {img.shape[1]}x{img.shape[0]}")
    return images, names


# ---------------------------------------------------- high-level stitcher

def run_stitcher(images, conf_thresh=None):
    stitcher = cv2.Stitcher_create(cv2.Stitcher_PANORAMA)
    if conf_thresh is not None:
        stitcher.setPanoConfidenceThresh(conf_thresh)
    with quiet_native_output():
        status, pano = stitcher.stitch(images)
    return status, pano, stitcher


def report_used(stitcher, n_input):
    """Which input images made it into the panorama (if this build exposes it)."""
    comp_fn = getattr(stitcher, "component", None)
    if not callable(comp_fn):
        print(f"Images used: unknown / {n_input} "
              f"(this OpenCV build does not expose Stitcher.component)")
        return None
    try:
        used = sorted(int(i) for i in np.asarray(comp_fn()).ravel())
    except cv2.error:
        print(f"Images used: unknown / {n_input}")
        return None
    dropped = sorted(set(range(n_input)) - set(used))
    print(f"Images used: {len(used)} / {n_input}"
          + (f" — DROPPED indices {dropped}" if dropped else " (none dropped)"))
    return used


def attempt_stitcher(images, n, conf_thresh=None):
    """One high-level Stitcher attempt. Returns (status, pano, used_indices)."""
    status, pano, stitcher = run_stitcher(images, conf_thresh)
    if status != cv2.Stitcher_OK:
        print(f"Status {status}: {STATUS_MEANINGS.get(status, 'unknown status')}")
        return status, None, None
    print(f"Stitcher OK — raw band {pano.shape[1]}x{pano.shape[0]}")
    return status, pano, report_used(stitcher, n)


def diagnose_weak_seams(images, names):
    """When the stitcher drops images, match consecutive pairs and report
    which seams are weak — so the user knows exactly where to reshoot.
    Diagnostic only; runs on downscaled copies for speed."""
    print("\n--- SEAM DIAGNOSTICS (why images were dropped) ---")
    if hasattr(cv2, "SIFT_create"):
        finder = cv2.SIFT_create()
    else:
        finder = cv2.ORB_create(3000)

    small = []
    for img in images:
        h, w = img.shape[:2]
        s = min(1.0, 1300 / max(h, w))
        small.append(img if s == 1.0 else cv2.resize(
            img, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA))

    features = [cv2.detail.computeImageFeatures2(finder, img) for img in small]
    matcher = cv2.detail_BestOf2NearestMatcher(False, 0.3)
    pairwise = matcher.apply2(features)
    matcher.collectGarbage()

    n = len(images)
    print("Consecutive-pair match confidence — below ~0.5 the pair cannot be "
          "aligned. Reshoot weak seams with more overlap (turn less between "
          "shots) and keep floor/ceiling edges in frame:")
    for i in range(n - 1):
        conf = pairwise[i * n + (i + 1)].confidence
        flag = "  <-- WEAK" if conf < 0.5 else ""
        print(f"  {names[i]} <-> {names[i + 1]}: {conf:.2f}{flag}")
    wrap = pairwise[(n - 1) * n].confidence
    print(f"  {names[-1]} <-> {names[0]} (360 wrap-around): {wrap:.2f}"
          + ("  <-- WEAK" if wrap < 0.5 else ""))


# ------------------------------------------------------ fallback pipeline

def fallback_stitch(images, names, ordered=False):
    """
    Minimal detail-API pipeline (features -> match -> homography -> bundle
    adjust -> spherical warp -> multiband blend).

    With ordered=True, matching is restricted to neighbours in filename
    (= shooting) order via BestOf2NearestRangeMatcher. This prevents the
    classic repeated-structure failure — two identical windows or doors on
    different walls matching each other and folding the panorama.
    """
    print("\n--- FALLBACK PIPELINE (cv2.detail"
          + (", matching constrained to shooting order" if ordered else "")
          + ") ---")
    n = len(images)

    def make_matcher():
        if ordered:
            return cv2.detail_BestOf2NearestRangeMatcher(2, False, 0.3)
        return cv2.detail_BestOf2NearestMatcher(False, 0.3)

    if hasattr(cv2, "SIFT_create"):
        finder, finder_name = cv2.SIFT_create(), "SIFT"
    else:
        finder, finder_name = cv2.ORB_create(3000), "ORB"
    print(f"Feature detector: {finder_name}")

    features = [cv2.detail.computeImageFeatures2(finder, img) for img in images]
    for name, feat in zip(names, features):
        print(f"  {name}: {len(feat.keypoints)} keypoints")

    matcher = make_matcher()
    pairwise = matcher.apply2(features)
    matcher.collectGarbage()

    print("Consecutive-pair match confidence (rule of thumb: <0.5 means the pair "
          "cannot be aligned — check overlap/texture between these two shots):")
    for i in range(n - 1):
        conf = pairwise[i * n + (i + 1)].confidence
        flag = "  <-- WEAK" if conf < 0.5 else ""
        print(f"  {names[i]} <-> {names[i + 1]}: {conf:.2f}{flag}")
    if not ordered:
        wrap_conf = pairwise[(n - 1) * n].confidence
        print(f"  {names[-1]} <-> {names[0]} (360 wrap-around): {wrap_conf:.2f}")

    keep = sorted(int(i) for i in
                  np.asarray(cv2.detail.leaveBiggestComponent(features, pairwise, 0.5)).ravel())
    if len(keep) < n:
        dropped = [names[i] for i in range(n) if i not in keep]
        print(f"Largest connected component: {len(keep)}/{n} images "
              f"— dropping {dropped}")
        if len(keep) < 2:
            print("Fewer than 2 connectable images — cannot stitch.")
            return None, keep
        images = [images[i] for i in keep]
        names = [names[i] for i in keep]
        n = len(images)
        # recompute on the subset so features/matches are consistent
        features = [cv2.detail.computeImageFeatures2(finder, img) for img in images]
        matcher = make_matcher()
        pairwise = matcher.apply2(features)
        matcher.collectGarbage()

    estimator = cv2.detail_HomographyBasedEstimator()
    ok, cameras = estimator.apply(features, pairwise, None)
    if not ok:
        print("Homography estimation failed.")
        return None, keep
    for cam in cameras:
        cam.R = cam.R.astype(np.float32)

    adjuster = cv2.detail_BundleAdjusterRay()
    adjuster.setConfThresh(0.5)
    with quiet_native_output():
        ok, cameras = adjuster.apply(features, pairwise, cameras)
    if not ok:
        print("Bundle adjustment failed — matches are geometrically inconsistent "
              "(likely parallax: camera translated instead of rotating in place).")
        return None, keep

    focals = sorted(cam.focal for cam in cameras)
    warp_scale = focals[len(focals) // 2]
    print(f"Estimated focal lengths (px): min {focals[0]:.0f}, "
          f"median {warp_scale:.0f}, max {focals[-1]:.0f}")

    rmats = [np.copy(cam.R) for cam in cameras]
    try:
        rmats = cv2.detail.waveCorrect(rmats, cv2.detail.WAVE_CORRECT_HORIZ)
        for cam, r in zip(cameras, rmats):
            cam.R = r
    except cv2.error:
        print("(wave correction failed, continuing without it)")

    warper = cv2.PyRotationWarper("spherical", warp_scale)
    corners, sizes, warped_imgs, warped_masks = [], [], [], []
    for img, cam in zip(images, cameras):
        K = cam.K().astype(np.float32)
        corner, wimg = warper.warp(img, K, cam.R, cv2.INTER_LINEAR,
                                   cv2.BORDER_REFLECT)
        mask = np.full(img.shape[:2], 255, np.uint8)
        _, wmask = warper.warp(mask, K, cam.R, cv2.INTER_NEAREST,
                               cv2.BORDER_CONSTANT)
        corners.append(corner)
        sizes.append((wimg.shape[1], wimg.shape[0]))
        warped_imgs.append(wimg)
        warped_masks.append(wmask)

    # exposure compensation + seam finding — big quality lift on real photos
    # (auto-exposure differences between shots, moving highlights); best-effort
    try:
        compensator = cv2.detail.ExposureCompensator_createDefault(
            cv2.detail.ExposureCompensator_GAIN)
        compensator.feed(corners=corners, images=warped_imgs,
                         masks=warped_masks)
        for i in range(len(warped_imgs)):
            compensator.apply(i, corners[i], warped_imgs[i], warped_masks[i])
    except cv2.error as e:
        print(f"(exposure compensation failed, continuing: {e})")
    try:
        seam_finder = cv2.detail_DpSeamFinder("COLOR")
        seam_masks = seam_finder.find(
            [img.astype(np.float32) for img in warped_imgs],
            corners, warped_masks)
        warped_masks = [m.get() if isinstance(m, cv2.UMat) else m
                        for m in seam_masks]
    except cv2.error as e:
        print(f"(seam finding failed, continuing with full masks: {e})")

    blender = cv2.detail_MultiBandBlender()
    blender.prepare(cv2.detail.resultRoi(corners=corners, sizes=sizes))
    for wimg, wmask, corner in zip(warped_imgs, warped_masks, corners):
        blender.feed(wimg.astype(np.int16), wmask, corner)
    result, _ = blender.blend(None, None)
    pano = np.clip(result, 0, 255).astype(np.uint8)
    print(f"Fallback produced a {pano.shape[1]}x{pano.shape[0]} panorama.")
    return pano, keep


# ------------------------------------------------- equirectangular output

def crop_black_borders(pano):
    """Bounding-box crop of the non-black region (stitcher output has ragged
    black edges), then fill leftover black wedges with neutral gray so they
    don't smear into the pole padding. Rough — this is a POC."""
    gray = cv2.cvtColor(pano, cv2.COLOR_BGR2GRAY)
    coords = cv2.findNonZero((gray > 4).astype(np.uint8))
    if coords is None:
        return pano
    x, y, w, h = cv2.boundingRect(coords)
    pano = pano[y:y + h, x:x + w].copy()
    wedge = cv2.cvtColor(pano, cv2.COLOR_BGR2GRAY) <= 4
    pano[wedge] = (128, 128, 128)
    return pano


def make_equirect(pano):
    """Pad the spherical band onto a 2:1 canvas: band centered vertically,
    edge rows stretched to fill toward the poles, then upscale to >= 4096x2048."""
    pano = crop_black_borders(pano)
    h, w = pano.shape[:2]
    canvas_h = w // 2

    if h > canvas_h:
        # band covers more than 180 deg of the canvas height — crop center
        y0 = (h - canvas_h) // 2
        pano = pano[y0:y0 + canvas_h]
        h = canvas_h
        print("NOTE: band was taller than 2:1, cropped vertically to fit.")

    canvas = np.empty((canvas_h, w, 3), np.uint8)
    top = (canvas_h - h) // 2
    canvas[top:top + h] = pano
    canvas[:top] = pano[0:1]        # edge-stretch toward zenith
    canvas[top + h:] = pano[h - 1:h]  # edge-stretch toward nadir
    print(f"Band {w}x{h} centered on 2:1 canvas {w}x{canvas_h} "
          f"(vertical coverage {180 * h / canvas_h:.0f} of 180 deg, "
          f"rest edge-stretched)")

    out_w = max(MIN_OUT_W, w)
    out_w += out_w % 2
    if (out_w, out_w // 2) != (w, canvas_h):
        canvas = cv2.resize(canvas, (out_w, out_w // 2),
                            interpolation=cv2.INTER_CUBIC)
    return canvas


# ----------------------------------------------------------------- viewer

VIEWER_TEMPLATE = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Panorama QA viewer</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.css">
<script src="https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.js"></script>
<style>html, body {{ margin: 0; height: 100%; }} #panorama {{ width: 100%; height: 100%; }}</style>
</head>
<body>
<div id="panorama"></div>
<script>
pannellum.viewer('panorama', {{
  type: 'equirectangular',
  panorama: '{image}',
  autoLoad: true,
  autoRotate: -2,
  showZoomCtrl: true,
}});
</script>
</body>
</html>
"""


def write_viewer(out_path):
    viewer_path = out_path.parent / "viewer.html"
    viewer_path.write_text(VIEWER_TEMPLATE.format(image=out_path.name))
    return viewer_path


# ------------------------------------------------------------------- main

def peak_memory_mb():
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return rss / 1e6 if sys.platform == "darwin" else rss / 1e3  # bytes vs KB


def main():
    ap = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    ap.add_argument("input", help="folder of 8-12 overlapping JPEGs, "
                                  "stitched in filename order")
    ap.add_argument("--out", required=True, help="output JPEG path, "
                                                 "e.g. ./output/room1.jpg")
    ap.add_argument("--max-dim", type=int, default=2600,
                    help="downscale inputs so max(w,h) <= this (default 2600)")
    args = ap.parse_args()

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    images, names = load_images(args.input, args.max_dim)
    n = len(images)
    fallback_used = False

    t0 = time.perf_counter()

    print("\n--- ATTEMPT 1: cv2.Stitcher (PANORAMA mode, default settings) ---")
    status, pano, used = attempt_stitcher(images, n)

    # Retry with a lowered confidence threshold if the stitcher failed outright
    # OR silently dropped images (a partial pano is not a usable 360).
    dropped_some = used is not None and len(used) < n
    if status != cv2.Stitcher_OK or dropped_some:
        if dropped_some:
            print("Stitcher succeeded but dropped images — retrying to try to "
                  "keep the full set.")
        print("\n--- ATTEMPT 2: retry with confidence threshold lowered "
              "(1.0 -> 0.6) ---")
        status2, pano2, used2 = attempt_stitcher(images, n, conf_thresh=0.6)
        # keep whichever attempt stitched more images
        score1 = len(used) if pano is not None and used is not None else \
            (n if pano is not None else -1)
        score2 = len(used2) if pano2 is not None and used2 is not None else \
            (n if pano2 is not None else -1)
        if score2 > score1:
            status, pano, used = status2, pano2, used2
        elif pano is not None:
            print(f"Keeping attempt 1 result ({max(score1, 0)} images).")
            status = cv2.Stitcher_OK

    if pano is not None:
        if used is None:
            used = list(range(n))
        if len(used) < n:
            diagnose_weak_seams(images, names)
            print("\nRetrying with matching constrained to shooting order — "
                  "this prevents look-alike walls/windows/doors on different "
                  "sides of the room from being matched to each other "
                  "(takes a minute or two)...")
            fpano, fkeep = fallback_stitch(images, names, ordered=True)
            if fpano is not None and len(fkeep) > len(used):
                print(f"Order-constrained pipeline connected {len(fkeep)} "
                      f"images vs {len(used)} — using its result.")
                pano, used = fpano, fkeep
                fallback_used = True
            else:
                print("Order-constrained pipeline did not connect more images "
                      "— keeping the earlier result.")
    else:
        fallback_used = True
        pano, keep = fallback_stitch(images, names, ordered=True)
        used = keep if keep else []
        if pano is None:
            elapsed = time.perf_counter() - t0
            print(f"\nStitch time: {elapsed:.1f}s | "
                  f"peak memory: {peak_memory_mb():.0f} MB")
            fail("all three attempts failed — see diagnostics above for "
                 "which image pairs could not be matched. Verdict: NO-GO "
                 "for this photo set.")

    equirect = make_equirect(pano)
    elapsed = time.perf_counter() - t0

    ok = cv2.imwrite(str(out_path), equirect,
                     [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
    if not ok:
        fail(f"could not write {out_path}")
    viewer_path = write_viewer(out_path)

    size_mb = out_path.stat().st_size / 1e6
    print("\n=== DIAGNOSTICS ===")
    print(f"Input images:       {n}")
    print(f"Images in pano:     {len(used)} / {n}"
          + ("" if len(used) == n else
             f" (dropped: {[names[i] for i in range(n) if i not in used]})"))
    print(f"Fallback pipeline:  {'YES — high-level Stitcher failed' if fallback_used else 'not needed'}")
    print(f"Stitch time:        {elapsed:.1f} s")
    print(f"Peak memory:        {peak_memory_mb():.0f} MB")
    print(f"Output:             {out_path} — "
          f"{equirect.shape[1]}x{equirect.shape[0]}, {size_mb:.1f} MB "
          f"(JPEG q{JPEG_QUALITY})")
    print(f"Viewer:             {viewer_path}  "
          f"(open in a browser; if the image won't load from file://, run "
          f"'python -m http.server' in that folder)")


if __name__ == "__main__":
    main()
