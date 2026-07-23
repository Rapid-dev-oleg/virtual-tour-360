// Stitch the per-plane room photos into ONE seamless 360° equirectangular panorama.
//
// Approach: send ALL wall/floor/ceiling photos together, in room order, as a single
// multi-image task to an image model (backend /api/stitch → OpenRouter). The model
// understands the whole room at once and assembles a seamless 360 itself. See docs/ai-stitching.md.

// clockwise horizontal order around the room, then floor/ceiling
const ORDER = ['front', 'right', 'back', 'left', 'floor', 'ceiling'];

// how many planes actually have photos (button gating / cost hint)
export function countPhotoPlanes(tour) {
  const p = tour?.planes || {};
  return Object.keys(p).filter((k) => (p[k]?.length || 0) > 0).length;
}

// Collect the room's photos in order and ask the backend to assemble a 360.
// Returns { image (clean equirect data URL), cost, model }.
export async function stitchRoom(tour, { model } = {}) {
  const planes = tour?.planes || {};
  const images = [];
  for (const key of ORDER) {
    const arr = planes[key];
    if (arr && arr.length) images.push({ key, url: arr[0] }); // first photo per plane
  }
  if (!images.length) throw new Error('no wall photos to stitch');

  const r = await fetch('/api/stitch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images, ...(model ? { model } : {}) }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || `stitch failed (${r.status})`);
  return j;
}
