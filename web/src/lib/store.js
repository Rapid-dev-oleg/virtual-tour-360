// Tiny client-side store. Tours live in localStorage; seeded demo tours live in
// code (so their share links work for ANY visitor, since their panoramas are
// static assets shipped with the build).

const KEY = 'vt.tours.v1';
const asset = (p) => `${import.meta.env.BASE_URL}${p}`;

// ---- Seeded demo tours ---------------------------------------------------
export const SEED_TOURS = [
  {
    id: 'demo-apartment',
    seed: true,
    name: 'Демо: 3-комнатная квартира',
    subtitle: 'Пример готового тура',
    type: 'panorama',
    createdAt: 0,
    cover: asset('demo/tour-1.jpg'),
    startSceneId: 's1',
    scenes: [
      {
        id: 's1',
        name: 'Гостиная',
        panorama: asset('demo/tour-1.jpg'),
        links: [{ nodeId: 's2', position: { yaw: '25deg', pitch: '-12deg' } }],
      },
      {
        id: 's2',
        name: 'Кухня',
        panorama: asset('demo/tour-2.jpg'),
        links: [
          { nodeId: 's1', position: { yaw: '200deg', pitch: '-12deg' } },
          { nodeId: 's3', position: { yaw: '10deg', pitch: '-10deg' } },
        ],
      },
      {
        id: 's3',
        name: 'Спальня',
        panorama: asset('demo/tour-3.jpg'),
        links: [
          { nodeId: 's2', position: { yaw: '190deg', pitch: '-12deg' } },
          { nodeId: 's4', position: { yaw: '80deg', pitch: '-10deg' } },
        ],
      },
      {
        id: 's4',
        name: 'Балкон',
        panorama: asset('demo/tour-4.jpg'),
        links: [{ nodeId: 's3', position: { yaw: '250deg', pitch: '-12deg' } }],
      },
    ],
  },
  {
    id: 'demo-studio',
    seed: true,
    name: 'Демо: студия',
    subtitle: 'Мини-тур из 2 точек',
    type: 'panorama',
    createdAt: 0,
    cover: asset('demo/tour-5.jpg'),
    startSceneId: 's1',
    scenes: [
      {
        id: 's1',
        name: 'Комната',
        panorama: asset('demo/tour-5.jpg'),
        links: [{ nodeId: 's2', position: { yaw: '60deg', pitch: '-10deg' } }],
      },
      {
        id: 's2',
        name: 'Вид',
        panorama: asset('demo/sphere.jpg'),
        links: [{ nodeId: 's1', position: { yaw: '240deg', pitch: '-10deg' } }],
      },
    ],
  },
];

// ---- localStorage helpers ------------------------------------------------
function readUser() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

function writeUser(tours) {
  try {
    localStorage.setItem(KEY, JSON.stringify(tours));
    return true;
  } catch (e) {
    // localStorage quota — most likely a large base64 panorama.
    console.error('Не удалось сохранить тур (переполнено хранилище браузера)', e);
    return false;
  }
}

// ---- Public API ----------------------------------------------------------
export function listTours() {
  // user tours first (newest on top), then seeds
  const user = readUser().sort((a, b) => b.createdAt - a.createdAt);
  return [...user, ...SEED_TOURS];
}

export function getTour(id) {
  return readUser().find((t) => t.id === id) || SEED_TOURS.find((t) => t.id === id) || null;
}

export function isSeed(id) {
  return SEED_TOURS.some((t) => t.id === id);
}

function uid(prefix = 't') {
  // no Math.random dependency on server; fine in browser
  return prefix + '-' + Math.random().toString(36).slice(2, 9);
}

export function createTour({ name, type }) {
  const tour = {
    id: uid('t'),
    seed: false,
    name: name || 'Без названия',
    type,
    createdAt: Date.now(),
    cover: null,
    startSceneId: null,
    scenes: [],
    videoUrl: null,
  };
  const tours = readUser();
  tours.push(tour);
  writeUser(tours);
  return tour;
}

export function saveTour(tour) {
  const tours = readUser();
  const i = tours.findIndex((t) => t.id === tour.id);
  if (i === -1) tours.push(tour);
  else tours[i] = tour;
  return writeUser(tours);
}

export function deleteTour(id) {
  writeUser(readUser().filter((t) => t.id !== id));
}

export { uid };
