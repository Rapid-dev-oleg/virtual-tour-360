/**
 * ⚠️ SCAFFOLD / STUB — NOT USED, NOT CALLED, NOT TESTED.
 *
 * A unified interface to the reconstruction service «video → 3D (Gaussian Splatting)».
 * The adapter implementations (KIRI / Polycam / turnkey) are stubs. Real calls
 * will go through your own backend proxy (keys are secret, not allowed from the browser).
 *
 * Provider contract:
 *   submitJob(video, opts) -> { jobId }
 *   getStatus(jobId)       -> { state: 'queued'|'processing'|'done'|'error',
 *                               progress?: number, resultUrl?: string, error?: string }
 * resultUrl — a link to the .splat/.ply that SplatViewer then renders.
 */

const NOT_CONFIGURED = 'RECONSTRUCTION_PROVIDER_NOT_CONFIGURED';

/** KIRI Engine API — recommended (video→3DGS, ~$1/scan, ~7–20 min). */
export const kiriProvider = {
  id: 'kiri',
  label: 'KIRI Engine',
  // POST video -> job; GET job -> status; download .ply/.splat when ready.
  async submitJob(_video, _opts) {
    throw new Error(NOT_CONFIGURED);
  },
  async getStatus(_jobId) {
    throw new Error(NOT_CONFIGURED);
  },
};

/** Polycam API — subscription, video/photos→splats. */
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

/** Turnkey (SplatTour/Real Horizons) — hosts the tour itself, returns a link/embed. */
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

/** The active provider is chosen later (env/setting). Not set yet. */
export function getProvider(_id) {
  throw new Error(NOT_CONFIGURED);
}

export default { PROVIDERS, getProvider };
