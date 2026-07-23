// Tour store — server-backed (no localStorage). All tours and their media live on
// the server (/api/tours + /uploads). Every function is async.

const API = '/api/tours';

export const SEED_TOURS = []; // demo tours removed
export function isSeed() { return false; }

function uid(prefix = 't') {
  return prefix + '-' + Math.random().toString(36).slice(2, 9);
}

export async function listTours() {
  try {
    const r = await fetch(API);
    return r.ok ? await r.json() : [];
  } catch {
    return [];
  }
}

export async function getTour(id) {
  try {
    const r = await fetch(`${API}/${id}`);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export async function createTour({ name, type }) {
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, type }),
  });
  return r.ok ? await r.json() : null;
}

// saves the full tour (server externalizes data-URL media to files) → returns the
// saved tour (with media as URLs), or null on failure.
export async function saveTour(tour) {
  try {
    const r = await fetch(`${API}/${tour.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tour),
    });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export async function deleteTour(id) {
  try { await fetch(`${API}/${id}`, { method: 'DELETE' }); } catch { /* ignore */ }
}

export { uid };
