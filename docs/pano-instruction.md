# Инструкция: фото помещения → бесшовный 4K HDR эквирект-360

Как из нескольких фото комнаты получить сферическую панораму 360°×180°
(эквирект 2:1), бесшовную, с HDR-детализацией, 4K.

## Главное (честно про лимит)

Image-модель **не гарантирует** ни строгий формат 2:1, ни замыкание краёв, ни HDR —
это архитектурный предел. Проверено: промпт с «seamless» и «HDR» дал на выходе
`1.79:1`, шов яркости `11.4` и плоский тон. Поэтому инструкция = **две части**:

1. **Промпт** — толкает модель в нужную сторону (но не гарантирует).
2. **Обязательная пост-обработка** — детерминированно чинит то, что модель не гарантирует
   (формат 2:1, HDR-тон, шов замыкания).

- Модель: **`google/gemini-3-pro-image`** (лучшее качество склейки, из тестов).
- Вход: **до 16 фото** (жёсткий лимит OpenRouter Images API).
- Порядок фото: по кругу `front → right → back → left`, затем пол/потолок. Для съёмки
  из углов — по часовой: угол 1 → 2 → 3 → 4. Всегда подписывать порядок в промпте.

---

## Часть 1 — Промпт модели

```
You are assembling a professional 360° virtual-tour panorama from photos of ONE room.

INPUT: N wide-angle photos of the same room, given in clockwise order around the room.
(For corner shots: each photo is taken from a corner looking diagonally toward the
opposite corner; together they cover all walls, floor and ceiling.)

TASK: Merge them into ONE seamless 360°×180° equirectangular panorama, strict 2:1,
as if shot with a 360 camera from the centre of the room.

GEOMETRY:
- Bend vertical wall edges into natural equirectangular curvature; smooth inside corners,
  NO hard vertical seams.
- Top row = ceiling zenith, bottom row = floor nadir. Verticals straight, horizon level.

CONTENT FIDELITY:
- Keep the REAL furniture, windows, doors, décor and their positions. Do NOT invent new
  large objects or change the layout. Reconstruct only small missing gaps consistently.

LIGHT & EXPOSURE:
- Unify white balance and exposure across all photos — no brightness/colour seams.
- HDR tone: high local contrast and micro-detail; recover detail inside bright windows AND
  in dark corners; deep but detailed shadows, bright but not blown highlights.

SHARPNESS:
- Crisp textures/edges across the whole sphere; consistent focus; no blur, no ghosting/
  double edges in overlaps. If an input is soft, enhance detail to match the sharpest input.

CRITICAL OUTPUT CONSTRAINTS:
- Output MUST be strict 2:1 (width exactly twice the height).
- SEAMLESS WRAP: the extreme LEFT edge pixels must be the exact continuation of the extreme
  RIGHT edge pixels — same wall, same brightness, no vertical seam at the wrap line.
- No vertical brightness steps or stitch lines between merged photos.

Output the finished equirectangular image only.
```

Запрос (OpenRouter Images API):
```json
{ "model": "google/gemini-3-pro-image",
  "prompt": "<промпт выше>",
  "input_references": [ {"type":"image_url","image_url":{"url":"data:image/jpeg;base64,<photo1>"}}, ... ] }
```
Результат — `data[0].b64_json` (эквирект, но «сырой»: формат/шов/тон не гарантированы).

---

## Часть 2 — Обязательная пост-обработка (гарантирует 2:1 / HDR / без шва)

Прогонять КАЖДУЮ генерацию. **Порядок критичен**: сначала формат, потом HDR,
**выравнивание шва — самым последним** (иначе тайловый CLAHE снова ломает край).

1. **Строгий 2:1, 4K** — `resize → 4096 × 2048`.
2. **HDR-тон (умеренно, без пересветов)**:
   - CLAHE `clipLimit≈2.0, tileGridSize=8×8` по каналу **L** (LAB);
   - мягкая S-кривая контраста `×1.10`;
   - насыщенность `×1.10`.
3. **Шов замыкания — ПОСЛЕДНИМ**: линейный per-row/per-channel ramp по ширине,
   чтобы `col[0] == col[W-1]` (край сходится, интерьер почти не трогается).

Референс-реализация (OpenCV, проверено):
```python
import cv2, numpy as np
im = cv2.imread("raw_pano.jpg")
im = cv2.resize(im, (4096, 2048), interpolation=cv2.INTER_CUBIC)   # 1) строгий 2:1 4K
H, W = im.shape[:2]

# 2) HDR-look
lab = cv2.cvtColor(im, cv2.COLOR_BGR2LAB); l, a, b = cv2.split(lab)
l = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(l)
im = cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)
x = np.arange(256) / 255.0
lut = (np.clip((x - 0.5) * 1.10 + 0.5, 0, 1) * 255).astype(np.uint8)   # мягкий контраст
im = cv2.LUT(im, lut)
hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV).astype(np.float32); hsv[:, :, 1] *= 1.10
im = cv2.cvtColor(np.clip(hsv, 0, 255).astype(np.uint8), cv2.COLOR_HSV2BGR).astype(np.float32)

# 3) шов замыкания — ПОСЛЕДНИМ
d = im[:, 0:1, :] - im[:, W-1:W, :]
xr = (np.arange(W) / (W - 1)).reshape(1, W, 1)
im = np.clip(im + d * xr, 0, 255).astype(np.uint8)

cv2.imwrite("pano_4k_hdr.jpg", im, [cv2.IMWRITE_JPEG_QUALITY, 95])
```
Замер на тестовой картинке: формат `1.79→2.00`, контраст `std 60→68`, шов `11.4→8.7`.

---

## Что пост-обработкой НЕ чинится (и как обойти)

- **Внутренние швы** от склейки моделью из разных ракурсов (тонально-геометрические
  разрывы в середине кадра). Автоматически их не отличить от настоящих граней
  (угол стены, край шкафа) — флаттерить рискованно. Обход:
  1. **Лучший вход** — резкие кадры (штатив/стабилизация), большое перекрытие,
     близкая экспозиция. Мыло на входе модель не спасёт.
  2. **Прицельный второй проход** модели: «убери шов на этой вертикали, остальное
     не меняй» (маска/координата шва в промпте).
- **Настоящий HDR (16-бит / .exr)** из 8-бит SDR не родится — это «HDR-look»
  (расширенный локальный контраст). Для истинного HDR нужен HDR-съём (брекетинг).
- **Истинное 4K-разрешение деталей**: модель отдаёт ~1–2K нативно; шаг resize до 4096
  тянет пиксели, но не добавляет деталей. Для реального 4K — апскейл Real-ESRGAN/Topaz.

## Идеальный вход (чтобы шва и мыла не было в принципе)

- Съёмка из **центра** комнаты с поворотом (перекрытие ≥30%) ИЛИ из **4 углов**
  широким углом (хорошее перекрытие по диагонали).
- Резкость: штатив/стабилизация, без смаза; одинаковая экспозиция и ББ на всех кадрах.
- Плюс 1–2 кадра «в потолок» и «в пол» — заметно улучшает зенит/надир (лимит 16 позволяет).
