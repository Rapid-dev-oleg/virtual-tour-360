// Client for the local backend (KIRI proxy). Same-origin when served by Express;
// via Vite proxy in dev.

export async function createVideoTour(file, name, onProgress) {
  // use XHR to get upload progress for the (large) video
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('video', file);
    fd.append('name', name || '');
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/video-tours');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(body.error || `Server error (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Network unavailable'));
    xhr.send(fd);
  });
}

export async function getVideoTour(id) {
  const r = await fetch(`/api/video-tours/${id}`).catch(() => null);
  if (!r || !r.ok) return null;
  return r.json();
}

export async function listVideoTours() {
  const r = await fetch('/api/video-tours').catch(() => null);
  if (!r || !r.ok) return [];
  return r.json().catch(() => []);
}

export async function health() {
  const r = await fetch('/api/health').catch(() => null);
  if (!r || !r.ok) return null;
  return r.json().catch(() => null);
}
