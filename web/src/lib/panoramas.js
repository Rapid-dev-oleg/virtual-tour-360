// Panorama library — saved panoramas live on the server, reusable across tours.
export async function listPanoramas() {
  try {
    const r = await fetch('/api/panoramas');
    return r.ok ? await r.json() : [];
  } catch {
    return [];
  }
}

export async function deletePanorama(id) {
  try { await fetch(`/api/panoramas/${id}`, { method: 'DELETE' }); } catch { /* ignore */ }
}
