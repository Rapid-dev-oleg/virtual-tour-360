import os
import uuid
import json
import asyncio
import zipfile
import shutil
from datetime import datetime
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Optional, List

from fastapi import FastAPI, File, UploadFile, Form, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import cv2
import numpy as np

# ── Config ──
BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = BASE_DIR / "uploads"
OUTPUT_DIR = BASE_DIR / "outputs"
TEMP_DIR = BASE_DIR / "temp"
DB_PATH = "/tmp/360tour.db"

UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)
TEMP_DIR.mkdir(exist_ok=True)

# ── Task storage (in-memory for Render free tier) ──
tasks = {}

# ── Pydantic models ──
class Hotspot(BaseModel):
    yaw: float
    pitch: float
    text: str
    type: str = "info"
    url: Optional[str] = None

class MLSExportRequest(BaseModel):
    panorama_url: str
    hotspots: List[Hotspot] = []
    metadata: dict = {}

class AIEditRequest(BaseModel):
    prompt: str
    preset: Optional[str] = None

# ── Lifespan ──
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🚀 360 Virtual Tour API starting...")
    yield
    print("👋 Shutting down...")

app = FastAPI(
    title="360 Virtual Tour API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Helper: Save uploaded files ──
def save_upload(files: List[UploadFile], task_id: str) -> List[Path]:
    task_dir = UPLOAD_DIR / task_id
    task_dir.mkdir(exist_ok=True)
    saved = []
    for f in files:
        path = task_dir / f.filename
        with open(path, "wb") as buf:
            shutil.copyfileobj(f.file, buf)
        saved.append(path)
    return saved

# ── Helper: Stitching engine ──
def stitch_images(image_paths: List[Path], quality: str = "draft") -> dict:
    """OpenCV-based panorama stitching."""
    try:
        images = []
        max_dim = 1024 if quality == "draft" else 2048

        for p in sorted(image_paths):
            img = cv2.imread(str(p))
            if img is None:
                continue
            # Resize for performance
            h, w = img.shape[:2]
            scale = max_dim / max(w, h)
            if scale < 1:
                new_w, new_h = int(w * scale), int(h * scale)
                img = cv2.resize(img, (new_w, new_h))
            images.append(img)

        if len(images) < 2:
            raise ValueError("Need at least 2 valid images")

        # Try OpenCV Stitcher first
        stitcher = cv2.Stitcher_create(cv2.Stitcher_PANORAMA)
        status, stitched = stitcher.stitch(images)

        if status != cv2.Stitcher_OK:
            # Fallback: cylindrical projection + blending
            stitched = cylindrical_stitch(images)

        if stitched is None or stitched.size == 0:
            raise ValueError("Stitching produced empty result")

        # Convert to equirectangular 2:1
        stitched = to_equirectangular(stitched, quality)

        # Save output
        output_name = f"panorama_{quality}_{uuid.uuid4().hex[:8]}.jpg"
        output_path = OUTPUT_DIR / output_name
        cv2.imwrite(str(output_path), stitched, [cv2.IMWRITE_JPEG_QUALITY, 92])

        return {
            "status": "completed",
            "output_url": f"/outputs/{output_name}",
            "output_path": str(output_path),
            "width": int(stitched.shape[1]),
            "height": int(stitched.shape[0]),
            "projection": "equirectangular",
            "is_full_quality": quality == "full",
        }

    except Exception as e:
        return {
            "status": "failed",
            "error": str(e),
        }

def cylindrical_stitch(images: List[np.ndarray]) -> np.ndarray:
    """Fallback: cylindrical warp + horizontal concatenation with blending."""
    warped = []
    for img in images:
        h, w = img.shape[:2]
        # Cylindrical projection
        f = w  # focal length estimate
        K = np.array([[f, 0, w/2], [0, f, h/2], [0, 0, 1]])
        map_x, map_y = cv2.initUndistortRectifyMap(
            K, None, None, K, (w, h), cv2.CV_32FC1
        )
        cyl = cv2.remap(img, map_x, map_y, cv2.INTER_LINEAR)
        warped.append(cyl)

    # Simple horizontal blend
    if len(warped) == 1:
        return warped[0]

    # Use ORB features to align
    result = warped[0]
    for i in range(1, len(warped)):
        result = blend_pair(result, warped[i])

    return result

def blend_pair(left: np.ndarray, right: np.ndarray) -> np.ndarray:
    """Blend two images using ORB feature matching."""
    # Find features
    orb = cv2.ORB_create(500)
    kp1, des1 = orb.detectAndCompute(left, None)
    kp2, des2 = orb.detectAndCompute(right, None)

    if des1 is None or des2 is None:
        # Simple concat fallback
        return np.hstack([left, right])

    # Match
    bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
    matches = bf.match(des1, des2)
    matches = sorted(matches, key=lambda x: x.distance)[:50]

    if len(matches) < 10:
        return np.hstack([left, right])

    # Find homography
    src_pts = np.float32([kp1[m.queryIdx].pt for m in matches]).reshape(-1, 1, 2)
    dst_pts = np.float32([kp2[m.trainIdx].pt for m in matches]).reshape(-1, 1, 2)

    H, mask = cv2.findHomography(dst_pts, src_pts, cv2.RANSAC, 5.0)

    if H is None:
        return np.hstack([left, right])

    # Warp right onto left coordinate system
    h1, w1 = left.shape[:2]
    h2, w2 = right.shape[:2]

    # Calculate output bounds
    corners = np.float32([[0, 0], [w2, 0], [w2, h2], [0, h2]]).reshape(-1, 1, 2)
    warped_corners = cv2.perspectiveTransform(corners, H)
    all_corners = np.concatenate([
        np.float32([[0, 0], [w1, 0], [w1, h1], [0, h1]]).reshape(-1, 1, 2),
        warped_corners
    ])

    x_min, y_min = np.int32(all_corners.min(axis=0).ravel() - 0.5)
    x_max, y_max = np.int32(all_corners.max(axis=0).ravel() + 0.5)

    translation = np.array([[1, 0, -x_min], [0, 1, -y_min], [0, 0, 1]])
    H_translated = translation @ H

    output_w = x_max - x_min
    output_h = y_max - y_min

    warped_right = cv2.warpPerspective(right, H_translated, (output_w, output_h))
    warped_left = cv2.warpPerspective(left, translation, (output_w, output_h))

    # Simple alpha blend
    mask_left = (warped_left > 0).astype(np.float32)
    mask_right = (warped_right > 0).astype(np.float32)
    overlap = mask_left * mask_right
    alpha = cv2.GaussianBlur(overlap[:, :, 0], (21, 21), 5)
    alpha = np.stack([alpha] * 3, axis=2)

    blended = np.where(
        overlap > 0,
        (warped_left * (1 - alpha) + warped_right * alpha).astype(np.uint8),
        np.maximum(warped_left, warped_right)
    )

    return blended

def to_equirectangular(img: np.ndarray, quality: str) -> np.ndarray:
    """Convert stitched image to 2:1 equirectangular format for 360° viewers."""
    h, w = img.shape[:2]
    target_w = 2048 if quality == "draft" else 4096
    target_h = target_w // 2

    # Resize to 2:1 aspect ratio
    result = cv2.resize(img, (target_w, target_h), interpolation=cv2.INTER_LANCZOS4)
    return result

# ── Background task ──
def run_stitch_task(task_id: str, image_paths: List[Path], quality: str):
    tasks[task_id] = {"status": "processing", "progress": 40}
    try:
        result = stitch_images(image_paths, quality)
        tasks[task_id] = {**result, "progress": 100}
    except Exception as e:
        tasks[task_id] = {"status": "failed", "error": str(e), "progress": 0}

# ── Routes ──
@app.get("/api/health")
async def health():
    return {"status": "ok", "opencv_version": cv2.__version__}

@app.post("/api/stitch/upload")
async def stitch_upload(
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
    quality: str = Form("draft"),
    projection: str = Form("equirectangular"),
):
    if len(files) < 2:
        raise HTTPException(400, "Need at least 2 images")

    task_id = uuid.uuid4().hex
    image_paths = save_upload(files, task_id)

    tasks[task_id] = {"status": "uploaded", "progress": 20}

    background_tasks.add_task(run_stitch_task, task_id, image_paths, quality)

    return {"task_id": task_id, "status": "processing"}

@app.get("/api/stitch/status/{task_id}")
async def stitch_status(task_id: str):
    if task_id not in tasks:
        raise HTTPException(404, "Task not found")
    return tasks[task_id]

@app.get("/api/stitch/result/{task_id}")
async def stitch_result(task_id: str):
    if task_id not in tasks:
        raise HTTPException(404, "Task not found")
    task = tasks[task_id]
    if task["status"] != "completed":
        raise HTTPException(400, f"Task is {task['status']}")
    return FileResponse(task["output_path"])

# ── AI Edit endpoint ──
@app.post("/api/ai/edit")
async def ai_edit(
    image: UploadFile = File(...),
    prompt: str = Form(...),
    preset: Optional[str] = Form(None),
):
    """AI photo editing via Gemini API."""
    try:
        # Save uploaded image
        task_id = uuid.uuid4().hex
        img_path = TEMP_DIR / f"{task_id}_{image.filename}"
        with open(img_path, "wb") as f:
            shutil.copyfileobj(image.file, f)

        # Check if Gemini API key is configured
        gemini_key = os.environ.get("GEMINI_API_KEY", "")
        if not gemini_key:
            # Return a processed version using OpenCV as fallback
            img = cv2.imread(str(img_path))
            if img is None:
                raise HTTPException(400, "Cannot read image")

            # Apply basic OpenCV processing based on prompt keywords
            result_img = apply_cv_fallback(img, prompt)

            output_name = f"edited_{task_id}.jpg"
            output_path = OUTPUT_DIR / output_name
            cv2.imwrite(str(output_path), result_img, [cv2.IMWRITE_JPEG_QUALITY, 92])

            return {
                "status": "completed",
                "image_url": f"/outputs/{output_name}",
                "note": "OpenCV fallback - set GEMINI_API_KEY for AI editing",
            }

        # Try Gemini API
        try:
            result = await call_gemini_edit(str(img_path), prompt)
            return result
        except Exception as gemini_err:
            # Fallback to OpenCV
            img = cv2.imread(str(img_path))
            result_img = apply_cv_fallback(img, prompt)
            output_name = f"edited_{task_id}.jpg"
            output_path = OUTPUT_DIR / output_name
            cv2.imwrite(str(output_path), result_img, [cv2.IMWRITE_JPEG_QUALITY, 92])
            return {
                "status": "completed",
                "image_url": f"/outputs/{output_name}",
                "note": f"Gemini error: {gemini_err}. Used OpenCV fallback.",
            }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Edit failed: {str(e)}")

def apply_cv_fallback(img: np.ndarray, prompt: str) -> np.ndarray:
    """Basic OpenCV processing based on prompt keywords."""
    prompt_lower = prompt.lower()
    result = img.copy()

    if "bright" in prompt_lower or "light" in prompt_lower:
        # Increase brightness
        alpha = 1.2
        beta = 30
        result = cv2.convertScaleAbs(result, alpha=alpha, beta=beta)

    if "twilight" in prompt_lower or "dusk" in prompt_lower or "night" in prompt_lower:
        # Blue/purple tint for twilight effect
        result = cv2.convertScaleAbs(result, alpha=0.7, beta=-20)
        # Add blue tint
        blue_overlay = np.zeros_like(result)
        blue_overlay[:, :] = [80, 40, 20]  # BGR
        result = cv2.addWeighted(result, 0.8, blue_overlay, 0.2, 0)

    if "warm" in prompt_lower:
        # Warm tint
        warm_overlay = np.zeros_like(result)
        warm_overlay[:, :] = [20, 60, 100]  # BGR warm
        result = cv2.addWeighted(result, 0.85, warm_overlay, 0.15, 0)

    if "remove" in prompt_lower and "people" in prompt_lower:
        # Detect people using HOG + remove by inpainting
        hog = cv2.HOGDescriptor()
        hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
        gray = cv2.cvtColor(result, cv2.COLOR_BGR2GRAY)
        boxes, _ = hog.detectMultiScale(gray, winStride=(8, 8))
        if len(boxes) > 0:
            mask = np.zeros(gray.shape, dtype=np.uint8)
            for (x, y, w, h) in boxes:
                cv2.rectangle(mask, (x, y), (x+w, y+h), 255, -1)
            result = cv2.inpaint(result, mask, 3, cv2.INPAINT_TELEA)

    # Auto-enhance
    lab = cv2.cvtColor(result, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l = clahe.apply(l)
    result = cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)

    return result

async def call_gemini_edit(image_path: str, prompt: str) -> dict:
    """Call Gemini 2.5 Flash Image API for editing."""
    import google.generativeai as genai

    genai.configure(api_key=os.environ["GEMINI_API_KEY"])
    model = genai.GenerativeModel("gemini-2.5-flash-preview-05-20")

    with open(image_path, "rb") as f:
        image_data = f.read()

    image_part = {"mime_type": "image/jpeg", "data": image_data}

    response = model.generate_content([
        prompt,
        image_part
    ])

    # Save result
    task_id = uuid.uuid4().hex
    output_name = f"edited_{task_id}.jpg"
    output_path = OUTPUT_DIR / output_name

    # Extract image from response
    for part in response.parts:
        if hasattr(part, 'inline_data') and part.inline_data:
            with open(output_path, 'wb') as f:
                f.write(part.inline_data.data)
            break
    else:
        # If no image in response, use original
        shutil.copy(image_path, output_path)

    return {
        "status": "completed",
        "image_url": f"/outputs/{output_name}",
    }

# ── MLS Export ──
@app.post("/api/export/mls")
async def export_mls(request: MLSExportRequest):
    """Export MLS-compliant ZIP package."""
    try:
        export_id = uuid.uuid4().hex
        export_dir = TEMP_DIR / f"mls_{export_id}"
        export_dir.mkdir(exist_ok=True)

        # Download/copy panorama
        pano_path = export_dir / "panorama.jpg"
        if request.panorama_url.startswith("http"):
            import urllib.request
            urllib.request.urlretrieve(request.panorama_url, pano_path)
        else:
            src = OUTPUT_DIR / Path(request.panorama_url).name
            shutil.copy(src, pano_path)

        # Create manifest
        manifest = {
            "version": "1.0",
            "created_at": datetime.utcnow().isoformat(),
            "format": "equirectangular",
            "projection": "spherical",
            "width": 4096,
            "height": 2048,
            "metadata": request.metadata,
            "hotspots": [h.model_dump() for h in request.hotspots],
            "files": {
                "panorama": "panorama.jpg",
                "manifest": "manifest.json",
                "hotspots": "hotspots.json",
            }
        }

        manifest_path = export_dir / "manifest.json"
        with open(manifest_path, "w") as f:
            json.dump(manifest, f, indent=2)

        hotspots_path = export_dir / "hotspots.json"
        with open(hotspots_path, "w") as f:
            json.dump([h.model_dump() for h in request.hotspots], f, indent=2)

        # Create README
        readme = export_dir / "README.txt"
        readme.write_text(
            f"360 Virtual Tour - MLS Export\n"
            f"Generated: {datetime.utcnow().isoformat()}\n"
            f"\nContents:\n"
            f"- panorama.jpg: Equirectangular 360 image (4096x2048)\n"
            f"- manifest.json: MLS-compliant metadata\n"
            f"- hotspots.json: Interactive hotspot definitions\n"
        )

        # ZIP everything
        zip_path = OUTPUT_DIR / f"360-tour-mls-{export_id}.zip"
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            for f in export_dir.iterdir():
                zf.write(f, f.name)

        # Cleanup
        shutil.rmtree(export_dir)

        return {
            "status": "completed",
            "download_url": f"/outputs/{zip_path.name}",
            "files_included": ["panorama.jpg", "manifest.json", "hotspots.json", "README.txt"],
        }

    except Exception as e:
        raise HTTPException(500, f"Export failed: {str(e)}")

# ── Serve static files (React SPA) ──
static_dir = BASE_DIR / "static"
if static_dir.exists():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")

# Also serve outputs
app.mount("/outputs", StaticFiles(directory=str(OUTPUT_DIR)), name="outputs")

# SPA catch-all (must be last)
@app.get("/{path:path}")
async def spa_catchall(path: str):
    index_file = static_dir / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    return JSONResponse({"detail": "Not found"}, status_code=404)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
