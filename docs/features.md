# Возможности `awaband-scanner`

Документ фиксирует фактически реализованные возможности проекта по состоянию на 12 марта 2026 года. Основа документа — текущий код репозитория плюс локальная runtime-проверка через браузер и simulation mode.

## 1. Что это за продукт

`awaband-scanner` — это одностраничное браузерное приложение с тремя основными экранами:

- splash-экран с запуском сканирования;
- live-экран сканирования с камерой, HUD, аурой, диагностикой и управлением режимами;
- result-экран с финальным snapshot, диагностикой и экспортом.

Приложение работает полностью на клиенте и не требует отдельного backend API кроме локальной раздачи статических файлов.

## 2. Подтвержденные пользовательские функции

### 2.1 Splash и запуск

- брендированный стартовый экран с CTA `Начать сканирование`;
- поддержка simulation badge на splash-экране, если включен `?sim=...`;
- переход в live-scanning после запроса доступа к устройствам.

### 2.2 Live-сканирование

- видеопоток с фронтальной камеры;
- визуализация ауры поверх live-видео;
- верхняя панель со статусом, simulation badge, переключателем `ФОКУС`, debug toggle, guide overlay и кнопкой остановки;
- sensor strip с отдельными статусами `CAM`, `MIC`, `FACE`, `PULSE`, `FOCUS`;
- HUD внутри viewport: signal quality, heart rate, elapsed time, pulse indicator;
- live-панель параметров `STAB`, `FLOW`, `ENRG`, `RSNC`, `VIBR`, `CLRT`, `INTG` с confidence-aware отображением.

### 2.3 Итоговый экран

- полноэкранный snapshot ауры;
- отдельная финальная панель параметров;
- блок `Scan diagnostics` с summary, partial/full state, retained parameters, diagnostics-only metrics и simulation mode;
- действие `Новое сканирование`;
- экспорт `PNG`;
- экспорт структурированного `JSON` с итоговым snapshot, session timeline и rolling signal buffers.

## 3. Сенсорные и аналитические возможности

### 3.1 Камера и face tracking

- базовый live-видеопоток из `getUserMedia`;
- нативный `FaceDetector`, если он доступен в браузере;
- fallback-детекция лица эвристикой по canvas, если `FaceDetector` недоступен;
- ROI лба для rPPG;
- отдельный ROI лица для расчета vibraimage-подобных метрик.

### 3.2 rPPG и vitals

- CHROM-подход для извлечения пульсового сигнала;
- расчет `hr`;
- расчет HRV-метрик `rmssd`, `sdnn`, `pnn50`;
- расчет `breathingRate`, `coherence`, `lfhf`, `stressIndex`;
- оценка `signalQuality`;
- очистка буферов и деградация состояния при потере лица.

### 3.3 Vibraimage и motion-канал

- межкадровый анализ микродвижений по яркости;
- расчет `amplitude`, `frequency`, `symmetry`, `entropy`, `amplitudeLower`;
- участие motion-канала как в biofield mapping, так и в emotion heuristics.

### 3.4 Голосовой канал

- запуск отдельного аудиоканала через Web Audio API;
- расчет `pitch`, `jitter`, `shimmer`, `hnr`, `rms`, `spectralCentroid`, `formants`, `voiceBioCenter`;
- silent-mode логика, когда голосовой сигнал отсутствует или слишком слаб;
- отдельное уведомление пользователю, если микрофон недоступен.

### 3.5 Эмоции и baseline

- эвристики `laughing` / `smiling`;
- интенсивности `laughIntensity` и `smileIntensity`;
- персональный baseline по медианам (`hrMedian`, `rmssdMedian`, `amplitudeMedian`);
- baseline уже включен в runtime, но используется ограниченно и не влияет на все формулы.

## 4. Quality-aware runtime

После аудита проект получил явный слой качества и внутренних контрактов:

- `scan-contracts.js` задает стабильные структуры для `vitals`, `voiceMetrics`, `vibraimageMetrics`, `emotions` и sensor status;
- `scan-quality.js` выводит `partial/full/unavailable` состояние скана, причины частичного результата и confidence caps по параметрам;
- `scan-runtime.js` собирает trace источников, отмечает retained parameters и готовит structured export;
- `scan-session.js` изолирует orchestration scanning session от верхнего UI.

Пользовательски это дает:

- не только числа, но и объяснение качества результата;
- явный partial state при плохом сигнале;
- сохранение session-level export для последующего анализа: итоговый snapshot, timeline samples и rolling signal buffers;
- debug panel с полным состоянием runtime и trace по источникам каждого параметра.

### 4.1 Что входит в JSON export

Текущий `awaband-scan.json` включает:

- финальный snapshot метрик, статусов и quality state;
- `session`-метаданные со временем старта, длительностью и числом samples;
- `timeline` с последовательностью runtime-сэмплов по мере сканирования;
- `signals.rppg` с rolling RGB buffers и текущим pulse signal;
- `signals.vibraimage` с rolling histories межкадровых различий и симметрии.

Экспорт пока не включает сырой audio waveform и полный видеоряд.

## 5. Guide overlay и объяснимость

Во время live-сканирования есть встроенный guide overlay, который описывает:

- что делает камера;
- что делает vibraimage-канал;
- что делает микрофон;
- как работает VoiceBio;
- как рисуется сакральная геометрия;
- как интерпретируются 7 параметров.

Это не заменяет инженерную документацию, но дает встроенный user-facing explainer прямо в приложении.

## 6. Режим "Фокус"

Режим `ФОКУС` — это опциональный режим сегментации человека:

- включается отдельной кнопкой `ФОКУС`;
- загружается лениво, только по требованию;
- использует MediaPipe Selfie Segmentation;
- тянется с `https://cdn.jsdelivr.net`, то есть не является offline-ready;
- при успешной загрузке переключает sensor strip в состояние `FOCUS: active`;
- визуально очищает фон и иногда помогает дольше удерживать пользователя как основной объект в кадре;
- не меняет формулы `biofield` и не делает расчёт шкал медицински точнее.

Локальная browser-проверка подтвердила, что в сетевой среде режим поднимается успешно. При загрузке MediaPipe появляются служебные WebGL warnings, но runtime errors не было.

## 7. Simulation mode

Simulation mode включается query-параметром `sim` и позволяет прогонять UX без реальных устройств или воспроизводить плохие условия сигнала.

Поддерживаемые токены:

| Token | Что симулирует |
|---|---|
| `camera-denied` | отказ в доступе к камере |
| `mic-denied` | отказ в доступе к микрофону |
| `fake-camera` | синтетический видеопоток |
| `fake-mic` | синтетический аудиопоток |
| `face-loss` | периодическую потерю лица |
| `pulse-weak` | слабый пульсовой сигнал |

Примеры:

```text
?sim=fake-camera+fake-mic
?sim=fake-camera+fake-mic+face-loss
?sim=fake-camera+pulse-weak
?sim=camera-denied
```

Это одна из самых полезных инженерных возможностей текущего репозитория: можно проверять UI-сценарии, quality states и экспорт без ручной подготовки среды.

## 8. Ограничения текущей реализации

- нет backend persistence и синхронизации результатов;
- есть import/validation harness, replay-check, metadata sidecars и coverage summary для real-session JSON fixtures; уже импортирован первый live fixture, но reviewed benchmark dataset ещё не собран;
- режим `ФОКУС` зависит от CDN;
- face tracking остается уязвимым к свету и фону;
- export уже включает timeline и raw buffers для части каналов, но не включает сырой аудиосигнал и полный session recording;
- часть продуктовой риторики по-прежнему звучит увереннее, чем инженерная доказательная база;
- проект не должен позиционироваться как медицинский прибор.

## 9. Связанные документы

- [README](../README.md)
- [Методология](methodology.md)
- [Руководство пользователя](user-guide.md)
- [Аудит проекта](audit.md)
- [Документация по формулам и параметрам](parameters.md)
