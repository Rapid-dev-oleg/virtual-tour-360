/**
 * ⚠️ КАРКАС / STUB — НЕ ИСПОЛЬЗУЕТСЯ, НЕ ВЫЗЫВАЕТСЯ, НЕ ТЕСТИРУЕТСЯ.
 *
 * «Умный слой» вокруг реконструкции на базе Gemini. Сам Gemini НЕ делает
 * видео→3D (это делает сервис реконструкции — см. reconstruct.js). Здесь —
 * только те задачи, где LLM реально полезна: контроль качества съёмки ДО
 * дорогой GPU-реконструкции, авторазметка сцен, описание объявления.
 *
 * Ничего не подключено к приложению. Реальные вызовы появятся, когда будет
 * принято решение по сервису и добавлен ключ (GEMINI_API_KEY / бэкенд-прокси).
 *
 * Предполагаемая модель: gemini-2.x/3 flash (нативный вход видео).
 * Вызовы ДОЛЖНЫ идти через свой бэкенд-прокси, а не из браузера (ключ секретный).
 */

export const GEMINI_STUB = true;
const NOT_IMPLEMENTED = 'GEMINI_NOT_IMPLEMENTED';

/**
 * QC съёмки перед реконструкцией. Экономит деньги на GPU: не гнать плохое видео.
 * @param {Blob|File} _video — видео-проходка
 * @returns {Promise<{ ok:boolean, score:number, issues:string[] }>}
 *   score 0..1; issues: ['too_dark','too_fast','low_coverage','single_pass',...]
 */
export async function analyzeCaptureQuality(_video) {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Распознать комнаты и предложить названия точек по видео.
 * @param {Blob|File} _video
 * @returns {Promise<Array<{ label:string, tSeconds:number }>>}
 *   напр. [{label:'Кухня', tSeconds:12}, {label:'Спальня', tSeconds:41}]
 */
export async function detectRooms(_video) {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Сгенерировать текст объявления/описание тура по видео + метаданным.
 * @param {{ video?:Blob, rooms?:string[], area?:number }} _input
 * @returns {Promise<{ title:string, description:string }>}
 */
export async function describeListing(_input) {
  throw new Error(NOT_IMPLEMENTED);
}

export default { GEMINI_STUB, analyzeCaptureQuality, detectRooms, describeListing };
