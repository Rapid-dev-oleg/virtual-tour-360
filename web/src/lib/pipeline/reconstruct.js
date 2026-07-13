/**
 * ⚠️ КАРКАС / STUB — НЕ ИСПОЛЬЗУЕТСЯ, НЕ ВЫЗЫВАЕТСЯ, НЕ ТЕСТИРУЕТСЯ.
 *
 * Единый интерфейс к сервису реконструкции «видео → 3D (Gaussian Splatting)».
 * Реализации-адаптеры (KIRI / Polycam / turnkey) — заглушки. Реальные вызовы
 * пойдут через свой бэкенд-прокси (ключи секретные, из браузера нельзя).
 *
 * Контракт провайдера:
 *   submitJob(video, opts) -> { jobId }
 *   getStatus(jobId)       -> { state: 'queued'|'processing'|'done'|'error',
 *                               progress?: number, resultUrl?: string, error?: string }
 * resultUrl — ссылка на .splat/.ply, который потом рендерит SplatViewer.
 */

const NOT_CONFIGURED = 'RECONSTRUCTION_PROVIDER_NOT_CONFIGURED';

/** KIRI Engine API — рекомендуемый (видео→3DGS, ~$1/скан, ~7–20 мин). */
export const kiriProvider = {
  id: 'kiri',
  label: 'KIRI Engine',
  // POST video -> job; GET job -> status; скачать .ply/.splat по готовности.
  async submitJob(_video, _opts) {
    throw new Error(NOT_CONFIGURED);
  },
  async getStatus(_jobId) {
    throw new Error(NOT_CONFIGURED);
  },
};

/** Polycam API — подписка, видео/фото→сплаты. */
export const polycamProvider = {
  id: 'polycam',
  label: 'Polycam',
  async submitJob(_video, _opts) {
    throw new Error(NOT_CONFIGURED);
  },
  async getStatus(_jobId) {
    throw new Error(NOT_CONFIGURED);
  },
};

/** Турнкей (SplatTour/Real Horizons) — свой хостинг тура, отдаёт ссылку/эмбед. */
export const turnkeyProvider = {
  id: 'turnkey',
  label: 'SplatTour / Real Horizons',
  async submitJob(_video, _opts) {
    throw new Error(NOT_CONFIGURED);
  },
  async getStatus(_jobId) {
    throw new Error(NOT_CONFIGURED);
  },
};

export const PROVIDERS = { kiri: kiriProvider, polycam: polycamProvider, turnkey: turnkeyProvider };

/** Активный провайдер выбирается позже (env/настройка). Пока — не задан. */
export function getProvider(_id) {
  throw new Error(NOT_CONFIGURED);
}

export default { PROVIDERS, getProvider };
