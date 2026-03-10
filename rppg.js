// dashboard/public/scanner/rppg.js
const BUFFER_SIZE = 256; // ~8.5 sec at 30fps
const FPS = 30;

/**
 * RPPGProcessor — извлечение пульса из видеосигнала методом CHROM.
 *
 * Реализует алгоритм De Haan & Jeanne (2013) — Chrominance-based method,
 * который проецирует нормализованные RGB-сигналы в хроминантное пространство,
 * отделяя пульсовой сигнал от артефактов движения и освещения.
 */
export class RPPGProcessor {
  constructor() {
    this.rBuffer = [];
    this.gBuffer = [];
    this.bBuffer = [];
  }

  /**
   * Добавить средние RGB-значения одного кадра из ROI (область лба).
   * Буфер ограничен BUFFER_SIZE (256) кадрами — старые значения вытесняются.
   *
   * @param {number} r — средний красный канал (0–255)
   * @param {number} g — средний зелёный канал (0–255)
   * @param {number} b — средний синий канал (0–255)
   */
  addFrame(r, g, b) {
    this.rBuffer.push(r);
    this.gBuffer.push(g);
    this.bBuffer.push(b);
    if (this.rBuffer.length > BUFFER_SIZE) {
      this.rBuffer.shift();
      this.gBuffer.shift();
      this.bBuffer.shift();
    }
  }

  /**
   * CHROM method: De Haan & Jeanne (2013)
   *
   * Вычисляет пульсовой сигнал из буферизованных RGB-данных:
   *   S1 = R/mean(R) - G/mean(G)
   *   S2 = R/mean(R) + G/mean(G) - 2*B/mean(B)
   *   H  = S1 + α·S2, где α = std(S1) / std(S2)
   *
   * @returns {number[] | null} Массив значений пульсового сигнала или null,
   *   если данных недостаточно (менее 64 кадров).
   */
  getPulseSignal() {
    if (this.rBuffer.length < 64) return null;

    const n = this.rBuffer.length;
    const meanR = this.rBuffer.reduce((a, b) => a + b) / n;
    const meanG = this.gBuffer.reduce((a, b) => a + b) / n;
    const meanB = this.bBuffer.reduce((a, b) => a + b) / n;

    if (meanR === 0 || meanG === 0 || meanB === 0) return null;

    const s1 = [];
    const s2 = [];
    for (let i = 0; i < n; i++) {
      const rn = this.rBuffer[i] / meanR;
      const gn = this.gBuffer[i] / meanG;
      const bn = this.bBuffer[i] / meanB;
      s1.push(rn - gn);
      s2.push(rn + gn - 2 * bn);
    }

    const stdS1 = std(s1);
    const stdS2 = std(s2);
    const alpha = stdS2 > 0 ? stdS1 / stdS2 : 0;

    return s1.map((v, i) => v + alpha * s2[i]);
  }

  /**
   * Оценить ЧСС (BPM) из пульсового сигнала через поиск пика в спектре FFT.
   *
   * Диапазон поиска: 40–180 BPM (0.67–3.0 Гц).
   *
   * @returns {number | null} ЧСС в ударах в минуту или null, если сигнал недоступен.
   */
  getHeartRate() {
    const signal = this.getPulseSignal();
    if (!signal) return null;

    const spectrum = fft(signal);
    // HR range: 40-180 BPM → 0.67-3.0 Hz
    const minBin = Math.floor(0.67 * signal.length / FPS);
    const maxBin = Math.ceil(3.0 * signal.length / FPS);

    let maxPower = 0;
    let maxIdx = minBin;
    for (let i = minBin; i <= maxBin && i < spectrum.length; i++) {
      if (spectrum[i] > maxPower) {
        maxPower = spectrum[i];
        maxIdx = i;
      }
    }

    const freqHz = maxIdx * FPS / signal.length;
    return Math.round(freqHz * 60);
  }

  /**
   * Заполненность буфера (0..1). Используется для отображения прогресса
   * пользователю перед первым измерением.
   *
   * @returns {number} Доля заполненности от 0 до 1.
   */
  get bufferFullness() {
    return this.rBuffer.length / BUFFER_SIZE;
  }
}

/**
 * Стандартное отклонение (популяционное) массива чисел.
 * @param {number[]} arr
 * @returns {number}
 */
function std(arr) {
  const mean = arr.reduce((a, b) => a + b) / arr.length;
  const variance = arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

/**
 * Простой DFT (спектр амплитуд). Сложность O(N²), допустимо для N=256.
 * Для продакшена можно заменить на FFT (Cooley–Tukey).
 *
 * @param {number[]} signal — входной сигнал
 * @returns {number[]} Амплитудный спектр (N/2 значений)
 */
function fft(signal) {
  const N = signal.length;
  const spectrum = [];
  for (let k = 0; k < N / 2; k++) {
    let real = 0, imag = 0;
    for (let n = 0; n < N; n++) {
      const angle = (2 * Math.PI * k * n) / N;
      real += signal[n] * Math.cos(angle);
      imag -= signal[n] * Math.sin(angle);
    }
    spectrum.push(Math.sqrt(real * real + imag * imag));
  }
  return spectrum;
}
