# ИИ-склейка комнаты: фото по стенам → бесшовный 360°

Как из отдельных фото стен (пол/потолок опционально) получить один бесшовный
360°-эквирект, который проецируется на коробку (режим «как на Яндексе»).

**Подход:** отдаём модели **все фото стен разом одним заданием** с контекстом (какая
стена где, что это одна комната, что нужен бесшовный 360). Модель понимает комнату
целиком и **сама собирает панораму** — гнёт стены в эквирект-кривизну, ставит углы,
достраивает потолок/пол, сводит края. Это одна из тех задач, где image-модель силь­на.

> История: сначала пробовали «код сам собирает черновой эквирект → ИИ замазывает швы».
> На реальных фото это давало мусор (модель не стыкует плоские фото, а перерисовывает
> искажённый холст). Отказались. Рабочий путь — ниже.

## Пайплайн

```
фото по стенам           один запрос,          бесшовный 360°        на коробку
(tour.planes[...])   ──►  все фото + контекст ──►  (tour.panorama)  ──►  (RoomViewer, режим A,
первое фото на плоскость   OpenRouter Images API                          пано-шейдер u=atan(dir.z,dir.x))
```

Порядок фото = по кругу по часовой: **front → right → back → left**, затем (если есть)
**floor → ceiling**. Именно в этом порядке модель раскладывает стены слева-направо.

## ⚠️ Важное ограничение (договорённость с пользователем)

Результат **красивый и бесшовный, но это НЕ точный слепок комнаты** — модель додумывает
и переставляет детали. Для «эффектного тура» отлично; для «точно моя квартира» — нет.
Точный 360 даёт только 360-камера или съёмка внахлёст с поворотом (классическая склейка
Hugin/OpenCV; текущим фото по одному на стену без перекрытия она не годится).

## Выбор модели (проверено живыми вызовами, 2026-07)

Тест: 4 сгенерированных фото стен одной гостиной → «собери один бесшовный 360».
Цифры — из ответа OpenRouter (`usage.cost`):

| Модель (OpenRouter slug)              | Время | Цена/комната | Результат |
|---------------------------------------|-------|--------------|-----------|
| **`google/gemini-3-pro-image`** 🏆    | ~30 с | **$0.14**    | чистый бесшовный эквирект: верная кривизна, края заворачиваются, мебель с 4 стен на местах, **швов нет** |
| `google/gemini-3.1-flash-image`       | ~44 с | $0.07        | вся мебель на месте, но **жёсткие вертикальные швы** между панелями → нужен доп. проход |
| `google/gemini-2.5-flash-image`       | ~8 с  | $0.04        | для сборки 360 из нескольких фото слабее, швы/несведение |

**Решение:** по умолчанию `google/gemini-3-pro-image` — единственный дал по-настоящему
бесшовный 360. `3.1-flash` — дешёвый вариант, если готовы мириться со швами (можно
добить вторым проходом: сдвиг краёв + инпейнт шва). Модель переключается полем `model`
в запросе к `/api/stitch`.

> Цена — по токенам изображения (pro ~1290 tok out по $60/M + вход). Реальную стоимость
> каждого вызова возвращает OpenRouter в `usage.cost`; отдаём её на фронт и показываем.

## Вызов OpenRouter (Images API, мульти-референс)

Эндпоинт: `POST https://openrouter.ai/api/v1/images`
Заголовок: `Authorization: Bearer $OPENROUTER_API_KEY`

Тело — **несколько** картинок в `input_references` (в порядке по кругу):
```json
{
  "model": "google/gemini-3-pro-image",
  "prompt": "<инструкция ниже, стены перечислены по порядку>",
  "input_references": [
    { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,<front>" } },
    { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,<right>" } },
    { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,<back>"  } },
    { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,<left>"  } }
  ]
}
```
> `input_references[i]` — обязательно **объект** `{type:'image_url', image_url:{url}}`
> (строку/`b64_json` API отвергает: `ZodError: expected object`). Форма проверена.

Ответ:
```json
{ "data": [{ "b64_json": "<png base64>", "media_type": "image/png" }],
  "usage": { "cost": 0.1419, "completion_tokens_details": { "image_tokens": 1290 } } }
```
Берём `data[0].b64_json` → готовый бесшовный эквирект.

## Промпт (сборка 360 из нескольких фото)

Собирается на сервере из списка присланных плоскостей (`buildStitchPrompt`), чтобы
перечислить именно те фото и в том порядке, что пришли:

```
I give you photos of the surfaces of ONE single room, all taken from the room centre.
Photo 1 is the FRONT wall. Photo 2 is the RIGHT wall. Photo 3 is the BACK wall. Photo 4 is the LEFT wall.
Combine them into ONE single seamless 360° equirectangular panorama (2:1 aspect ratio)
of this room interior, as if shot with a 360 camera standing in the centre.
Rules:
- Arrange the walls left-to-right in clockwise order (front, right, back, left) so panning
  horizontally turns you around the room; the left and right edges MUST wrap seamlessly
  (both are the front wall).
- Bend the vertical wall edges into the natural equirectangular curvature; walls meet at
  smooth inside corners with no hard vertical seams.
- A continuous ceiling fills the top and a continuous floor fills the bottom, matching the
  room style and lighting.   ← если пришли floor/ceiling: «using the provided floor/ceiling photos»
- Keep the real furniture, windows, doors and objects from the photos on their correct
  walls; do not invent extra large objects.
- Consistent, even lighting and white balance across the whole panorama.
Output only the finished equirectangular panorama image, 2:1.
```

Почему так (из тестов):
- Нумерация «Photo N = такая-то стена» + порядок по часовой — иначе модель путает стороны.
- Явное «edges MUST wrap seamlessly» — чтобы левый и правый край сходились (проверено:
  диван оказывается и слева, и справа).
- «no hard vertical seams» + «equirectangular curvature» — гонит от «коллажа из панелей»
  (болезнь flash) к настоящей эквирект-геометрии.
- «do not invent extra large objects» — удерживает реальную мебель, хоть детали и додумывает.

## Конвенция эквиректа (чтобы ложился на коробку)

Пано-шейдер вьювера (`RoomViewer.jsx`): `u = atan(dir.z, dir.x)/2π + 0.5`,
`v = 0.5 − asin(dir.y)/π`, текстура `flipY = false` (верх картинки = зенит-потолок).
Модель отдаёт стандартный 2:1 эквирект в этой же конвенции → фронт-стена садится на
`u≈0.25`, всё не зеркалит и не перевёрнуто. Round-trip проверен рендером на коробку.

## Куда встроено в коде

- **Ключ:** `server/.env` → `OPENROUTER_API_KEY` (git-ignored, только на сервере).
- **Прокси:** `server/index.js` → `POST /api/stitch`
  body: `{ images: [{ key, url:dataURL }, …], model? }` → `{ image, cost, model }`.
  Собирает промпт по списку `key`, шлёт в OpenRouter, ключ в браузер не отдаёт.
  Лимит тела: `express.json({ limit: '30mb' })` (несколько фото в base64).
- **Клиент:** `web/src/lib/panoStitch.js` → `stitchRoom(tour)` собирает `images` в
  порядке `front,right,back,left,floor,ceiling` (по первому фото на плоскость) и зовёт
  `/api/stitch`. `countPhotoPlanes(tour)` — для гейта кнопки.
- **UI:** кнопка «✨ Склеить в 360° (ИИ)» в `RoomEditorPage` (видна, когда есть ≥1 фото
  стены) → результат в `tour.panorama` → рендер режимом A.

## Стоимость и заметки

- 1 комната ≈ 1 вызов ≈ **$0.14** (pro). Пере-склейка после правок — ещё вызов.
- Сейчас на каждую плоскость берётся **только первое** фото. Если на стене несколько
  ракурсов — остальные игнорируются (TODO: слать все, помечая роль).
- Фото уже ужаты клиентом (`fileToPhotoDataURL`, ≤1600 px, JPEG) — 4–6 штук влезают в лимит.
