# Методология `awaband-scanner`

Документ фиксирует, как проект устроен по состоянию на 12 марта 2026 года. Это не маркетинговое описание, а краткая карта текущей runtime-модели.

## 1. Границы модели

`awaband-scanner` — клиентский wellness-интерфейс. Он:

- использует камеру и микрофон браузера;
- считает набор эвристических физиологических и околофизиологических признаков;
- переводит их в 7 интерпретационных шкал вселенной Awaterra;
- не является медицинским прибором и не ставит диагноз.

Важная граница: в проекте есть два разных слоя.

1. Sensor layer: камера, rPPG, motion/vibraimage-style анализ, голосовые признаки.
2. Interpretation layer: маппинг этих признаков в `stability`, `flow`, `energy`, `resonance`, `vibration`, `clarity`, `integrity`.

## 2. Источники сигнала

### 2.1 Камера: pulse / rPPG

Камера даёт видеопоток лица. По ROI в зоне лба строится пульсовой сигнал CHROM-подходом. Из него рантайм выводит:

- `hr`
- `rmssd`
- `sdnn`
- `pnn50`
- `lfhf`
- `coherence`
- `stressIndex`
- `breathingRate`
- `signalQuality`

Этот канал сильнее всего зависит от света, стабильности лица в кадре и длины окна наблюдения.

### 2.2 Камера: motion / vibraimage-style heuristics

Отдельно рантайм считает межкадровые различия внутри ROI лица. Это даёт:

- `amplitude`
- `frequency`
- `symmetry`
- `entropy`

Это не отдельный сертифицированный vibraimage-прибор. Это browser runtime heuristic на основе diff-кадров.

### 2.3 Микрофон: voice metrics

Если аудиоканал доступен, проект считает:

- `pitch`
- `jitter`
- `shimmer`
- `hnr`
- `rms`
- `spectralCentroid`
- `formants`
- `voiceBioCenter`

Если пользователь молчит или микрофон недоступен, часть шкал не обнуляется, а уходит в отдельную silent-mode/fallback-логику.

## 3. Маппинг в 7 шкал

Итоговые шкалы лежат в диапазоне `0..100`, но это не лабораторные величины и не независимые сенсоры. Это интерпретационные показатели, собранные из нескольких каналов сразу.

- `stability`: HRV + stressIndex + symmetry
- `flow`: `hrDelta` + `pnn50` + motion entropy
- `energy`: `hr` + `rms` + motion amplitude
- `resonance`: `coherence` + `lfhf`
- `vibration`: `pitch`/`spectralCentroid` или silent fallback + motion frequency
- `clarity`: `hnr`/`jitter`/`formants` или silent fallback + motion calmness
- `integrity`: согласованность первых шести шкал

Подробные формулы и ограничения по каждому параметру вынесены в [parameters.md](parameters.md).

## 4. Quality model

Проект теперь считает не только числа, но и качество результата.

Ключевые сущности:

- sensor statuses: `CAM`, `MIC`, `FACE`, `PULSE`, `HD`
- `quality.scanState`: `full`, `partial`, `unavailable`
- `quality.scanConfidence`
- `retainedParameters`
- per-parameter `confidence`

Практический смысл:

- `partial` означает, что часть каналов недоступна, не прогрета или шумит;
- `retained` означает, что шкала удержана от предыдущего стабильного кадра;
- низкий `confidence` может скрыть число на панели, даже если столбик ещё виден;
- silent mode не означает "всё стало нейтральным": часть шкал пересчитывается по camera/motion fallback-правилам.

## 5. Result UX

Итоговый экран показывает:

- финальный snapshot;
- summary по качеству скана;
- partial/full state;
- retained parameters;
- diagnostics-only metrics;
- structured export.

Читать результат нужно вместе с quality-блоком, а не отдельно от него.

## 6. Export и regression workflow

`awaband-scan.json` сейчас включает:

- final snapshot;
- `session` metadata;
- `timeline` с runtime-сэмплами;
- rolling buffers для `signals.rppg`;
- rolling buffers для `signals.vibraimage`.

Экспорт пока не включает сырой audio waveform и полный видеоряд.

Для regression workflow в репозитории есть:

- synthetic fixture harness;
- import pipeline для live `awaband-scan.json`;
- replay-check против сохранённого timeline;
- metadata sidecars `*.meta.json`;
- dataset summary по real-session fixture coverage.

## 7. Главные ограничения

- качество результата сильно зависит от света, положения лица и шума среды;
- face tracking остаётся эвристическим и хрупким по сравнению с face landmarks/mesh;
- семантика `null` / `0` / `retained` / partial confidence ещё не идеальна;
- real-session dataset pipeline готов, но ценность benchmark-набора появится только после заполнения живыми экспортами.
