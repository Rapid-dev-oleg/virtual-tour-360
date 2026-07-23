/**
 * ⚠️ SCAFFOLD / STUB — NOT USED, NOT CALLED, NOT TESTED.
 *
 * A Gemini-based "smart layer" around reconstruction. Gemini itself does NOT do
 * video→3D (the reconstruction service does — see reconstruct.js). Here we only
 * handle tasks where an LLM is actually useful: capture quality control BEFORE
 * the expensive GPU reconstruction, auto-labeling scenes, and listing descriptions.
 *
 * Nothing is wired into the app. Real calls will appear once a service is chosen
 * and a key is added (GEMINI_API_KEY / backend proxy).
 *
 * Assumed model: gemini-2.x/3 flash (native video input).
 * Calls MUST go through your own backend proxy, not from the browser (the key is secret).
 */

export const GEMINI_STUB = true;
const NOT_IMPLEMENTED = 'GEMINI_NOT_IMPLEMENTED';

/**
 * Capture QC before reconstruction. Saves GPU money: don't process bad video.
 * @param {Blob|File} _video — video walkthrough
 * @returns {Promise<{ ok:boolean, score:number, issues:string[] }>}
 *   score 0..1; issues: ['too_dark','too_fast','low_coverage','single_pass',...]
 */
export async function analyzeCaptureQuality(_video) {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Detect rooms and suggest point labels from the video.
 * @param {Blob|File} _video
 * @returns {Promise<Array<{ label:string, tSeconds:number }>>}
 *   e.g. [{label:'Kitchen', tSeconds:12}, {label:'Bedroom', tSeconds:41}]
 */
export async function detectRooms(_video) {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Generate listing copy / tour description from the video + metadata.
 * @param {{ video?:Blob, rooms?:string[], area?:number }} _input
 * @returns {Promise<{ title:string, description:string }>}
 */
export async function describeListing(_input) {
  throw new Error(NOT_IMPLEMENTED);
}

export default { GEMINI_STUB, analyzeCaptureQuality, detectRooms, describeListing };
