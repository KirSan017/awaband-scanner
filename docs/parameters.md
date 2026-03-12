# AWABAND Scanner — актуальная документация алгоритмов

Актуально по коду репозитория `awaband-scanner` на 12 марта 2026 года. Источник истины для этого документа — текущая реализация в `camera.js`, `rppg.js`, `vitals.js`, `vibraimage.js`, `voice.js`, `emotion-detector.js`, `calibration.js`, `biofield.js`, `aura.js`, `awaband-panel.js` и `main.js`.

Документ описывает то, как сканер работает сейчас, а не то, как он задумывался ранее. Если старые тексты, тултипы или комментарии расходятся с кодом, приоритет у кода.

## 1. Что это за система

`AWABAND Scanner` — фронтенд-приложение, которое:

- получает видеопоток с фронтальной камеры;
- пытается выделить лицо эвристикой по цвету кожи;
- извлекает из видео три типа признаков: rPPG, микродвижения и положение/масштаб головы;
- получает аудио с микрофона и извлекает голосовые признаки;
- превращает все это в 7 параметров `biofield` плюс `luminosity` и `confidence`;
- сглаживает значения во времени и рисует результат как HUD, панель и итоговый снимок.

Важно: в текущем виде это не медицинское изделие и не клинически валидированная система. В коде есть физиологические и DSP-эвристики, но итоговые 7 параметров — продуктовый слой интерпретации поверх этих признаков.

## 2. Что было исправлено относительно прежней версии документации

Ниже перечислены самые важные расхождения, которые были приведены к фактическому коду.

- `flow` считается не по `hrSmoothed`, а по `hrDelta = abs(currentHR - prevHR)` с добавками от `pNN50` и `vibraimage.entropy`.
- `energy` использует плато `60-85 BPM`, а не фиксированную цель `70 BPM`.
- `stability` начинает штрафоваться по `stressIndex` уже при `SI > 100`, а не только после `150`.
- во многих ветках fallback — это `0` или `null`, а не "нейтральные 50". Это принципиально влияет на поведение при неполных данных.
- при отсутствии голоса включается отдельный `silent mode` с другими весами для `energy`, `vibration`, `clarity` и `confidence`.
- `confidence` считается отдельно для каждого параметра и влияет на отображение в панели, но почти не участвует в самой формуле параметра.
- `luminosity` в коде — это простое среднее 7 итоговых параметров. Это не взвешенная сумма.
- персональный baseline собирает `hrMedian`, `rmssdMedian`, `amplitudeMedian`, но реально влияет только `rmssdMedian`.
- в `vitals`-контракт входят `breathingRate` и `hrSmoothed`, но в `mapToBiofield()` сейчас не используются.
- в `voiceMetrics` есть `shimmer` и `voiceBioCenter`, но `shimmer` не влияет на `biofield`, а `voiceBioCenter` используется только для визуальной подсветки ауры.

## 3. Архитектура и роли модулей

| Модуль | Роль |
|---|---|
| `server.js` | Раздача статических файлов `dist/` и корня проекта через Express |
| `main.js` | Оркестрация UI, запуск сканирования, цикл кадров, сбор данных, вызов маппинга, переходы между экранами |
| `camera.js` | Доступ к камере, ROI лба, усреднение RGB по ROI |
| `aura.js` | Эвристическая детекция лица, позиционирование ауры, отрисовка glow/geometry/VoiceBio/emotion effects |
| `rppg.js` | CHROM-сигнал, буфер RGB, оценка ЧСС и качества сигнала |
| `vitals.js` | HRV, дыхание, LF/HF, индекс Баевского, coherence |
| `vibraimage.js` | Межкадровая разность по яркости, амплитуда/частота/симметрия/энтропия микродвижений |
| `voice.js` | Голосовые метрики через Web Audio API |
| `emotion-detector.js` | Эвристики смеха и улыбки по голосу и микродвижениям |
| `calibration.js` | Сбор персонального baseline по медианам |
| `biofield.js` | Преобразование входных метрик в 7 параметров `biofield` + `luminosity` + `confidence` |
| `awaband-panel.js` | Вертикальная панель параметров и confidence-aware отображение |
| `segmentation.js` | Ленивое подключение MediaPipe Selfie Segmentation для режима `ФОКУС` |

Высокоуровневый поток данных:

```text
camera -> aura face tracking -> ROI forehead + face ROI
       -> rPPG -> vitals
       -> vibraimage
microphone -> voice metrics
voice + vibraimage -> emotion detection
vitals + voice + vibraimage + emotions + baseline -> mapToBiofield
raw biofield -> EMA smoothing -> aura + panel + result screen
```

## 4. Контракты данных

Это не отдельные публичные API, а внутренние контракты между модулями.

### 4.1 `vitals`

```js
{
  hr: number | null,
  hrv: number | null,
  sdnn: number | null,
  pnn50: number | null,
  lfhf: number | null,
  stressIndex: number | null,
  breathingRate: number | null,
  coherence: number | null,
  hrSmoothed: number | null,
  hrDelta: number | null,
  signalQuality: number | null
}
```

Примечания:

- `hrv` — это `rmssd`.
- `breathingRate` и `hrSmoothed` собираются, но в итоговом `mapToBiofield()` сейчас не участвуют.

### 4.2 `voiceMetrics`

```js
{
  pitch: number | null,
  jitter: number | null,
  shimmer: number | null,
  hnr: number | null,
  rms: number | null,
  spectralCentroid: number | null,
  formants: number[] | null,
  voiceBioCenter: number | null
}
```

Примечания:

- `shimmer` считается, но в `biofield` не используется.
- `voiceBioCenter` не влияет на численные параметры, только подсвечивает соответствующий слой ауры.

### 4.3 `vibraimageMetrics`

```js
{
  amplitude: number | null,
  frequency: number | null,
  symmetry: number | null,
  entropy: number | null,
  amplitudeLower: number | null
}
```

### 4.4 `biofield`

```js
{
  stability: number | null,
  flow: number | null,
  energy: number | null,
  resonance: number | null,
  vibration: number,
  clarity: number,
  integrity: number,
  luminosity: number,
  confidence: {
    stability: number,
    flow: number,
    energy: number,
    resonance: number,
    vibration: number,
    clarity: number,
    integrity: number
  }
}
```

## 5. Жизненный цикл скана

### 5.1 Запуск

По кнопке "Начать сканирование" `main.js`:

- переводит экран в `scanning`;
- инициализирует `RPPGProcessor`, `VibraimageProcessor`, `EmotionDetector`, `PersonalBaseline`;
- обнуляет `lastBiofield`, `smoothedBiofield`, `lastHR`, `prevHR`, `frameCount`;
- запускает камеру через `startCamera(video)`;
- пытается запустить микрофон через `VoiceAnalyzer.start()`, но микрофон опционален;
- создает `AuraRenderer` и `AwabandPanel`;
- запускает `requestAnimationFrame(loop)`.

Если камера недоступна, скан остается на экране scanning со статусом `Камера недоступна`. Если микрофон недоступен, это гасится молча: `voiceAnalyzer = null`.

### 5.2 Цикл кадров

На каждом кадре:

- видео рисуется в скрытый `offscreen` canvas;
- если `auraRenderer.faceDetected === true`, данные попадают в `rPPG` и `vibraimage`;
- если лицо долго потеряно, очищаются буферы `rPPG`, `vibraimage`, `emotionDetector` и локальная HR-сглажка.

Периодические задачи:

- каждые 10 кадров: `AuraRenderer.detectFaceFromCanvas()` обновляет `faceX`, `faceY`, `faceScale`, `faceDetected`;
- каждые 15 кадров: пересчет vitals, voice, vibraimage, emotions, baseline, biofield и панели;
- каждые 30 кадров: обновление таймера HUD;
- каждые 3 кадра в режиме `ФОКУС`: запрос маски сегментации.

### 5.3 Потеря лица

Поведение при потере лица двухступенчатое:

- пока лицо кратковременно потеряно, новые raw-значения не рассчитываются, а итог продолжает жить за счет предыдущего сглаженного состояния;
- после `FACE_LOST_CLEAR_THRESHOLD = 60` кадров без лица очищаются буферы и начинается быстрое затухание к нулям через `EMA_ALPHA_FAST = 0.5`.

### 5.4 Остановка

`stopScanning()`:

- отменяет `requestAnimationFrame`;
- останавливает треки камеры;
- останавливает и закрывает `VoiceAnalyzer`;
- рисует финальный aura snapshot в `result-canvas`;
- создает отдельную панель с финальными значениями на экране результата.

Сохранение результата — это PNG снимок канваса, а не JSON и не экспорт сырых метрик.

## 6. Камера, face tracking и ROI

### 6.1 Доступ к камере

`camera.js` запрашивает:

```js
video: {
  facingMode: 'user',
  width: { ideal: 640 },
  height: { ideal: 480 }
}
```

Аудио в этом запросе выключено.

### 6.2 Эвристика лица

`AuraRenderer.detectFaceFromCanvas()`:

- читает весь кадр из `offscreen` canvas;
- сэмплирует каждый 8-й пиксель;
- определяет "кожеподобные" пиксели по YCbCr:

```text
y  = 0.299R + 0.587G + 0.114B
cb = -0.169R - 0.331G + 0.500B + 128
cr =  0.500R - 0.419G - 0.081B + 128

skin = y > 60 && 77 < cb < 127 && 133 < cr < 173
```

- считает лицо найденным, если таких пикселей больше `max(40, 2% sampled frame)`;
- зеркалит `x`, поднимает `y` вверх на `0.35 * faceHeight`, чтобы центрировать ауру выше носа;
- сглаживает позицию лица:

```text
faceX = faceX * 0.75 + rawX * 0.25
faceY = faceY * 0.75 + rawY * 0.25
faceScale = faceScale * 0.85 + rawScale * 0.15
```

Это быстрая кросс-браузерная эвристика. Она чувствительна к свету, тону кожи, теплым фонам и пересветам.

### 6.3 ROI лба для rPPG

Если `facePos` есть:

```text
roiW = videoWidth  * 0.25 * scale
roiH = videoHeight * 0.12 * scale
cx   = facePos.x * videoWidth
cy   = (facePos.y - 0.15 * scale) * videoHeight
```

Дальше ROI центрируется вокруг `(cx, cy)` и ограничивается границами кадра.

Если `facePos` нет, используется фиксированный fallback:

```text
x = videoWidth / 3
y = videoHeight * 0.15
w = videoWidth / 3
h = videoHeight * 0.15
```

### 6.4 ROI лица для vibraimage

Если `facePos` есть:

```text
x = (facePos.x - 0.3 * scale) * width
y = (facePos.y - 0.3 * scale) * height
w = 0.6 * scale * width
h = 0.7 * scale * height
```

Если `facePos` нет:

```text
x = 0.2 * width
y = 0.1 * height
w = 0.6 * width
h = 0.7 * height
```

## 7. rPPG, HR и HRV

### 7.1 Буферы и минимумы

`RPPGProcessor` держит три FIFO-буфера `rBuffer`, `gBuffer`, `bBuffer`:

- размер буфера: `256` кадров;
- минимум для `getPulseSignal()`: `64` кадра;
- расчет предполагает `FPS = 30`.

### 7.2 CHROM-сигнал

На массиве средних RGB-значений по ROI:

```text
meanR = avg(rBuffer)
meanG = avg(gBuffer)
meanB = avg(bBuffer)

rn = R / meanR
gn = G / meanG
bn = B / meanB

S1 = rn - gn
S2 = rn + gn - 2 * bn
alpha = std(S1) / std(S2)
H = S1 + alpha * S2
```

Возвращается массив `H`, который используется дальше и для HR, и для HRV.

### 7.3 Heart rate

Используется простой DFT `O(N^2)`, а не быстрая FFT.

- диапазон поиска: `40-180 BPM`, то есть `0.67-3.0 Hz`;
- границы спектра:

```text
minBin = floor(0.67 * N / FPS)
maxBin = ceil(3.0  * N / FPS)
```

- выбирается бин с максимальной амплитудой;
- перевод в BPM:

```text
freqHz = peakBin * FPS / N
BPM = round(freqHz * 60)
```

### 7.4 Качество сигнала

`getSignalQuality()` считает отношение мощности пика к общей мощности внутри того же диапазона `40-180 BPM`:

```text
power = spectrum[i]^2
snr = peakPower / totalPower
signalQuality = min(100, round(snr * 400))
```

Это не классический SNR, а собственная шкала качества 0-100.

### 7.5 Peak detection и IBI

`calculateHRV()` ищет локальные максимумы с окном 2 сэмпла:

```text
signal[i] > signal[i-1], signal[i+1], signal[i-2], signal[i+2]
```

Дальше считает межпиковые интервалы:

```text
IBI_ms = ((peak[i] - peak[i-1]) / fps) * 1000
```

Фильтрация:

- допустимый IBI: `333-1500 ms`;
- минимум для результата: `2` валидных IBI;
- минимум для старта функции: `3` пика.

### 7.6 Производные метрики

| Метрика | Минимум данных | Формула или логика |
|---|---:|---|
| `rmssd` | `ibis.length >= 2` | `sqrt(sum((IBI[i]-IBI[i-1])^2) / (n-1))` |
| `sdnn` | `ibis.length >= 2` | `sqrt(sum((IBI-mean)^2) / n)` |
| `pnn50` | `ibis.length >= 2` | `count(abs(diff) > 50) / (n-1) * 100` |
| `breathingRate` | `ibis.length >= 8` | zero-crossings вокруг среднего IBI, 2 crossings = 1 вдох; диапазон валидности `8-25` дыханий/мин |
| `lfhf` | `ibis.length >= 10` | DFT на центрированном IBI; `LF 0.04-0.15`, `HF 0.15-0.40`; `LF/HF = lfPower / hfPower` |
| `stressIndex` | `ibis.length >= 8` | `AMo / (2 * Mo * MxDMn)` по 50ms бинам |
| `coherence` | `ibis.length >= 10` | `peakPower / totalPower * 300`, пик ищется в `0.04-0.26 Hz` |

Примечание: `calculateLFHF()` и `calculateCoherence()` используют частоту дискретизации `sampleRate = 1000 / meanIBI`.

## 8. Vibraimage

`VibraimageProcessor` — это чисто видеоэвристика на межкадровой разности по яркости.

### 8.1 Базовая идея

Для каждого пикселя ROI:

```text
Y = 0.299R + 0.587G + 0.114B
diff = abs(Y_current - Y_prev)
```

Считаются:

- средняя разность по всему ROI;
- раздельно левая/правая половины;
- раздельно верхняя/нижняя половины.

История:

- `maxHistory = 128` кадров;
- минимум для `getMetrics()`: `30` кадров.

### 8.2 Метрики

#### `amplitude`

Нормализованная средняя интенсивность движения:

```text
roiArea = roi.w * roi.h
scaleFactor = sqrt(roiArea / (200 * 150))
meanDiff = avg(diffHistory)
amplitude = min(100, round((meanDiff / (4 * scaleFactor)) * 100))
```

#### `amplitudeLower`

То же самое, но только по нижней половине лица. Используется в `smile detection`.

#### `frequency`

Частота осцилляций через zero-crossings относительно среднего:

```text
oscillationsPerSec = (crossings / 2) / (N / 30)
frequency = min(100, round((oscillationsPerSec / (12 * max(0.5, scaleFactor))) * 100))
```

#### `symmetry`

```text
leftAvg = leftDiff / leftPixels
rightAvg = rightDiff / rightPixels
asymmetry = abs(leftAvg - rightAvg) / max(leftAvg, rightAvg, 0.001)
symmetry = round(max(0, 1 - meanAsymmetry * 2) * 100)
```

#### `entropy`

История движений раскладывается на 10 бинов. Далее считается Shannon entropy:

```text
entropy = -sum(p * log2(p))
normalizedEntropy = min(100, round((entropy / 3.32) * 100))
```

Где `3.32 ~= log2(10)` — максимум для 10 бинов.

## 9. Голосовые метрики

### 9.1 Захват аудио

`VoiceAnalyzer.start()` запрашивает:

```js
audio: {
  echoCancellation: true,
  noiseSuppression: true
}
```

Дальше создается `AudioContext`, `AnalyserNode` и `MediaStreamSource`.

Параметры анализатора:

- `fftSize = 4096`;
- time-domain и frequency-domain данные читаются на каждом шаге `getMetrics()`.

### 9.2 Общие сигналы

- `rms = sqrt(sum(sample^2) / bufferLength)`
- если `rms <= 0.01`, pitch-dependent расчеты подавляются как слишком тихие

### 9.3 Pitch

Автокорреляция по лагам, соответствующим `60-500 Hz`:

```text
minPeriod = floor(sampleRate / 500)
maxPeriod = floor(sampleRate / 60)
```

Берется лаг с максимальной корреляцией. Если `bestCorrelation < 0.01`, результат `null`.

### 9.4 Jitter

По positive zero crossings измеряются периоды около ожидаемого pitch-периода:

```text
jitter = avg(abs(P[i] - P[i-1])) / meanPeriod * 100
```

Минимум: `3` периода.

### 9.5 Shimmer

Голос разбивается на окна длиной в один pitch-период. Для каждого окна берется максимум амплитуды:

```text
shimmer = avg(abs(A[i] - A[i-1])) / meanAmplitude * 100
```

Сейчас считается, но в `biofield` не участвует.

### 9.6 HNR

Упрощенный harmonics-to-noise ratio:

- строится средний pitch-период `avgWave`;
- harmonic energy — энергия `avgWave`;
- noise energy — энергия остатка `(original - avgWave)`.

Формула:

```text
HNR = 10 * log10(harmonicEnergy / noiseEnergy)
```

Если `noiseEnergy == 0`, возвращается `30`.

### 9.7 Spectral centroid

`freqData` приходит в dB и переводится в линейную магнитуду:

```text
mag = 10^(db / 20)
centroid = sum(freq * mag) / sum(mag)
```

### 9.8 Formants

Алгоритм:

- сглаживание спектра окном 5 бинов;
- поиск локальных максимумов в диапазоне `200-4000 Hz`;
- выбор трех strongest peaks;
- сортировка по частоте.

Для `biofield` реально используются только `F1` и `F2`.

### 9.9 VoiceBio center

Pitch складывается в диапазон `128-256 Hz`:

```text
while f > 256: f /= 2
while f < 128: f *= 2
```

Дальше выбирается ближайший центр:

| Нота | Частота центра | Индекс |
|---|---:|---:|
| C | 131.8 | 0 |
| D | 147.9 | 1 |
| E | 166.0 | 2 |
| F | 175.9 | 3 |
| G | 197.5 | 4 |
| A | 221.7 | 5 |
| B | 248.8 | 6 |

Это значение идет в `AuraRenderer.setVoiceBioCenter()` и визуально подсвечивает слой ауры.

## 10. Дополнительные подсистемы

### 10.1 Personal baseline

`PersonalBaseline` собирает медианы:

- `hrMedian`
- `rmssdMedian`
- `amplitudeMedian`

Данные пишутся только до `finalize()`. В текущей логике baseline финализируется, когда `rppg.bufferFullness > 0.5`.

Фактическое влияние на итог:

- используется только `rmssdMedian` как персональная цель для `stability`;
- `hrMedian` и `amplitudeMedian` сейчас собираются, но в формулах не используются;
- `getDeviation()` реализован, но не вызывается.

### 10.2 Emotion detection

#### Laugh

Основан на голосе:

- burst по `rms > 0.05`;
- debounce: не чаще, чем раз в `80 ms`;
- окно истории burst'ов: `3 s`;
- смеховой интервал между burst'ами: `100-400 ms`;
- бонусы от `hnr > 15` и `pitch > 200`.

Сырая формула:

```text
burstScore = min(1, laughBursts / 4)
hnrBonus   = hnr > 15    ? min(1, (hnr - 15) / 10)    : 0
pitchBonus = pitch > 200 ? min(1, (pitch - 200) / 100) : 0
rawLaugh = burstScore * 0.5 + hnrBonus * 0.3 + pitchBonus * 0.2
```

Потом:

```text
laughSmoothed = laughSmoothed * 0.7 + rawLaugh * 0.3
laughing = laughSmoothed > 0.25
laughIntensity = round(laughSmoothed * 100)
```

#### Smile

Основан на `vibraimage`:

- симметрия лица;
- усиление движения нижней половины лица;
- умеренная общая амплитуда;
- накопление устойчивого паттерна.

Сырая формула:

```text
symScore   = symmetry > 65 ? min(1, (symmetry - 65) / 25) : 0
lowerBoost = amplitudeLower > amplitude * 1.1 ? min(1, (amplitudeLower - amplitude) / 20) : 0
ampOk      = amplitude > 15 && amplitude < 60 ? 0.5 : 0

rawSmile = symScore * 0.5 + lowerBoost * 0.25 + ampOk * 0.25
```

Аккумулятор:

- `smileThreshold = 30`
- при `rawSmile > 0.2` растет на `+1`
- иначе падает на `-2`

Итог:

```text
sustained = smileAccumulator >= 30 ? 1 : 0
effectiveSmile = rawSmile * (0.5 + sustained * 0.5)
smileSmoothed = smileSmoothed * 0.8 + effectiveSmile * 0.2
smiling = smileSmoothed > 0.2
smileIntensity = round(smileSmoothed * 100)
```

### 10.3 Segmentation / режим `ФОКУС`

`segmentation.js` не входит в базовую логику. Это опциональный режим `ФОКУС`:

- лениво грузит `@mediapipe/selfie_segmentation` с CDN `jsdelivr`;
- при успешной загрузке получает mask кадра;
- масштабирует маску до размера viewport;
- блюрит фон с радиусом `12px`;
- при наличии маски принудительно ставит:

```text
auraRenderer.faceDetected = true
auraRenderer.framesWithoutFace = 0
```

Это визуальный и UX-модуль. Численные формулы `biofield` он не меняет напрямую.

## 11. Нормализация, confidence и семантика отсутствующих данных

### 11.1 `norm()`

`biofield.js` использует:

```text
norm(value, min, max, invert = false)
```

Логика:

- если `value == null`, результат `null`;
- значение клампится в `[min, max]`;
- потом переводится в `0-100`;
- при `invert = true` шкала переворачивается.

### 11.2 `val()`

`val(computed, fallback = 0)` возвращает:

- `computed`, если оно есть;
- иначе `0`.

Это важно: текущая реализация в большинстве мест не использует нейтральный fallback `50`.

### 11.3 Общий сигнал `sigQ`

Перед confidence:

```text
sigQ = signalQuality !== null && signalQuality < 30 ? 0.5 : 1
```

То есть при слабом пульсовом сигнале confidence pulse-dependent параметров режется вдвое.

### 11.4 Silent mode

```text
isSilent = !voice.rms || voice.rms < 0.02
```

При `silent mode` меняются:

- confidence для `vibration` и `clarity`;
- веса `energy`;
- сама логика `vibration`;
- сама логика `clarity`.

### 11.5 Confidence по параметрам

Формулы:

```text
stability =
  (hrv != null ? 0.7 : 0) +
  (sdnn != null ? 0.15 : 0) +
  (vib.symmetry != null ? 0.15 : 0)

flow =
  (hrDelta != null ? 0.5 : 0) +
  (pnn50 != null ? 0.3 : 0) +
  (vib.entropy != null ? 0.2 : 0)

energy =
  (hr != null ? 0.5 : 0) +
  (voice.rms > 0.01 ? 0.3 : 0) +
  (vib.amplitude != null ? 0.2 : 0)

resonance =
  (coherence != null ? 0.7 : hr != null ? 0.3 : 0) +
  (lfhf != null ? 0.3 : 0)
```

Для `vibration` и `clarity` формулы зависят от `silent mode`.

После этого:

```text
confidence.stability *= sigQ
confidence.flow *= sigQ
confidence.energy = min(confidence.energy, confidence.energy * (sigQ * 0.5 + 0.5))
confidence.resonance *= sigQ
```

### 11.6 Как confidence используется в UI

`AwabandPanel.update()`:

- если `confidence < 0.3`, столбик рисуется, но число скрывается как `--`;
- если `0.3 <= confidence < 0.7`, столбик помечается как `uncertain`;
- если `confidence >= 0.7`, отображается обычное значение.

## 12. Как считаются 7 параметров

Ниже — точные правила из `mapToBiofield()`.

### 12.1 Стабильность

Цель:

- персональная цель `rmssdTarget = baseline?.rmssdMedian ?? 50`

Шаги:

```text
hrvScore = norm(vitals.hrv, 0, rmssdTarget * 2)
stabilityBase = val(hrvScore)
```

Если есть `sdnn`:

```text
sdnnScore = 100 - min(100, abs(sdnn - 75) * 1.5)
stabilityBase = round(stabilityBase * 0.7 + sdnnScore * 0.3)
```

Если есть `stressIndex`:

```text
stressPenalty = max(0, min(40, (stressIndex - 100) * 0.2))
stabilityBase = round(max(0, stabilityBase - stressPenalty))
```

Если есть `vib.symmetry`:

```text
stabilityBase = round(stabilityBase * 0.8 + vib.symmetry * 0.2)
```

Итог:

- `null`, если одновременно нет `hrv`, `sdnn` и `vib.symmetry`;
- иначе `min(100, stabilityBase)`.

### 12.2 Поток

Базовая идея — не "ровный средний пульс", а маленькая дельта HR между пересчетами.

```text
smoothness = hrDelta != null ? max(0, 100 - hrDelta * 8) : null
flowBase = val(smoothness)
```

Если есть `pnn50`:

```text
pnnScore = 100 - min(100, abs(pnn50 - 20) * 3)
flowBase = round(flowBase * 0.7 + pnnScore * 0.3)
```

Если есть `vib.entropy`:

```text
entropyFlow = max(0, 100 - vib.entropy)
flowBase = round(flowBase * 0.8 + entropyFlow * 0.2)
```

Итог:

- `null`, если одновременно нет `hrDelta`, `pnn50`, `vib.entropy`;
- иначе `min(100, flowBase)`.

### 12.3 Энергия

Сначала HR переводится в score с широким плато:

```text
if 60 <= hr <= 85:
  hrScore = 80 + round((1 - abs(hr - 72.5) / 12.5) * 20)
else:
  boundary = hr < 60 ? 60 : 85
  hrScore = max(0, 80 - abs(hr - boundary) * 3)
```

Далее режимы:

```text
voiceWeight = isSilent ? 0.1 : 0.3
cameraWeight = isSilent ? 0.7 : 0.5
volumeScore = norm(voice.rms, 0, 0.3)
energyBase = round(val(hrScore) * cameraWeight + val(volumeScore) * voiceWeight)
```

Если есть `vib.amplitude`:

```text
ampScore = 100 - min(100, abs(vib.amplitude - 40) * 2.5)
energyBase += round(ampScore * 0.2)
```

Иначе:

```text
energyBase = round(val(hrScore) * (cameraWeight + 0.1) + val(volumeScore) * (voiceWeight + 0.1))
```

Итог:

- `null`, если одновременно нет `hr` и `vib.amplitude`;
- иначе `min(100, energyBase)`.

### 12.4 Резонанс

```text
resonanceBase = coherence ?? 0
```

Если есть `lfhf`:

```text
lfhfScore = 100 - min(100, abs(lfhf - 1.5) * 40)
resonanceBase = round(resonanceBase * 0.7 + lfhfScore * 0.3)
```

Итог:

- `null`, только если одновременно нет `coherence`, `lfhf` и `hr`;
- иначе `min(100, max(0, resonanceBase))`.

Практический нюанс: если `hr` уже есть, а `coherence` и `lfhf` еще не набрались, параметр становится `0`, а не `null`.

### 12.5 Вибрация

#### В тишине

```text
vibration = vib.frequency != null
  ? clamp(round(vib.frequency * 0.7 + 15), 0, 100)
  : 0
```

#### При наличии голоса

```text
pitchScore = norm(voice.pitch, 80, 300)
centroidScore = norm(voice.spectralCentroid, 500, 4000)
vibrationBase = round(val(pitchScore) * 0.4 + val(centroidScore) * 0.4)
```

Если есть `vib.frequency`, добавляется:

```text
vibrationBase += round(vib.frequency * 0.2)
```

Если нет:

```text
vibrationBase = round(val(pitchScore) * 0.5 + val(centroidScore) * 0.5)
```

Итог:

- всегда число `0-100`, а не `null`.

### 12.6 Ясность

#### В тишине

```text
calmScore = vib.amplitude != null ? max(0, 100 - vib.amplitude) : 0
silenceBonus = vib.amplitude != null && vib.amplitude < 20 ? 15 : 0
clarity = min(100, round(calmScore * 0.7) + silenceBonus)
```

#### При наличии голоса

```text
hnrScore = norm(voice.hnr, 0, 25)
jitterScore = norm(voice.jitter, 0, 5, true)
```

Если есть `F1` и `F2`:

```text
f1ok = 250 <= F1 <= 900
f2ok = 800 <= F2 <= 2800
formantScore = (f1ok ? 75 : 30) * 0.5 + (f2ok ? 75 : 30) * 0.5
```

База:

```text
clarityBase = round(val(hnrScore) * 0.4 + val(jitterScore) * 0.25 + formantScore * 0.15)
```

Если есть `vib.amplitude`:

```text
calmScore = max(0, 100 - vib.amplitude)
clarityBase += round(calmScore * 0.2)
```

Если нет:

```text
clarityBase = round(val(hnrScore) * 0.5 + val(jitterScore) * 0.3 + formantScore * 0.2)
```

Итог:

- всегда число `0-100`, а не `null`.

### 12.7 Эмоциональные бонусы

После расчета основных параметров:

```text
li = laughIntensity / 100
si = smileIntensity / 100

energy += round(li * 15)
flow += round(li * 10)
stability += round(si * 10)
resonance += round(si * 10)
```

Бонус применяется только если параметр не `null`.

### 12.8 Целостность

Берутся:

```text
paramsArr = [stability, flow, energy, resonance, vibration, clarity]
confValues = [confidence.stability, confidence.flow, confidence.energy, confidence.resonance, confidence.vibration, confidence.clarity]
highConfCount = count(conf > 0.5)
```

Если `highConfCount >= 4`:

```text
mean = avg(paramsArr with null -> 0)
variance = avg((value - mean)^2)
consistency = max(0, 100 - sqrt(variance) * 3)
integrity = round(consistency)
```

Иначе:

```text
integrity = 0
```

Confidence для `integrity`:

```text
confidence.integrity = highConfCount >= 4 ? 1 : highConfCount / 8
```

Замечание: знаменатель `8` выглядит необычно, потому что входных confidence здесь фактически `6`.

### 12.9 Светимость

Фактическая формула:

```text
all = [stability, flow, energy, resonance, vibration, clarity, integrity]
luminosity = round(avg(all with null -> 0))
```

То есть это простое арифметическое среднее 7 параметров.

## 13. Сглаживание и вывод в интерфейс

### 13.1 EMA для biofield

При наличии лица:

```text
new = round(prev * 0.85 + raw * 0.15)
```

При потере лица:

```text
new = round(prev * 0.5 + neutral * 0.5)
```

Где `neutral` в текущем коде — это все нули.

Особый случай:

- `confidence` не сглаживается;
- если `raw[key] === null`, сохраняется предыдущее значение параметра;
- но при `facePresent === false` система не использует `null`, а декрементирует к нулевому `NEUTRAL_BIOFIELD`.

### 13.2 Пульс на HUD

Если есть `hr`:

```text
beatDuration = 60 / hr
```

Это значение записывается в CSS variable `--beat-duration` для pulse bar.

### 13.3 Отображение результата

- в реальном времени используется `lastBiofield`;
- на итоговом экране аура рисуется заново, но уже без живого `heartRate`;
- итоговая картинка сохраняется как PNG.

## 14. Что сейчас считается, но не влияет на итоговые числа

В коде уже есть несколько заготовок или побочных метрик:

- `vitals.hrSmoothed`
- `vitals.breathingRate`
- `voiceMetrics.shimmer`
- `voiceMetrics.voiceBioCenter` влияет только на визуал
- `baseline.hrMedian`
- `baseline.amplitudeMedian`
- `PersonalBaseline.getDeviation()`

Это важно учитывать при развитии проекта: наличие поля в контракте не означает, что оно реально меняет итоговые 7 параметров.

## 15. Ограничения и типичные источники шума

### 15.1 Ограничения реализации

- face tracking основан на цвете кожи, а не на face landmarks или face mesh;
- `rPPG` использует простой DFT без band-pass фильтра, detrending и motion compensation исследовательского уровня;
- `HRV`, `LF/HF` и `coherence` считаются по коротким окнам, поэтому могут быть нестабильны;
- `vibraimage` чувствителен к компрессии, автоэкспозиции, роллинг-шаттеру и шуму матрицы;
- voice metrics зависят от микрофона, шумоподавления ОС, браузера и акустики комнаты;
- режим `ФОКУС` тянет модель с CDN и не гарантирован офлайн;
- результат сохраняется только как PNG, без сырых метрик и без истории измерения.

### 15.2 Когда значения особенно шумные

- лицо не по центру или заметно двигается;
- теплый фон или нестабильный свет сбивают skin-color heuristic;
- пользователь молчит, но ожидает "голосовые" параметры;
- микрофон отказал, а UI это явно не показал;
- окно сканирования еще не набрало достаточно кадров;
- лицо пропадает из кадра и параметры начинают затухать к нулю;
- для `resonance` есть HR, но еще нет достаточного окна для coherence/LFHF.

### 15.3 Как интерпретировать значения безопаснее

- сначала смотреть на `confidence` и на факт наличия лица;
- не сравнивать короткие проходы в разных условиях освещения;
- помнить, что `0`, `null` и "старое сглаженное значение" — это разные состояния;
- считать 7 параметров продуктовой интерпретацией, а не прямым физиологическим измерением.
