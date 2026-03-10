// dashboard/public/scanner/biofield.js

export const PARAM_COLORS = [
  '#ff6b8a', '#ff9f5a', '#ffd06b', '#5ae8b0',
  '#5ac8ff', '#8b8aff', '#c77dff'
];

export const PARAM_NAMES = [
  'Стабильность', 'Поток', 'Энергия', 'Резонанс',
  'Вибрация', 'Ясность', 'Целостность'
];

export const PARAM_KEYS = [
  'stability', 'flow', 'energy', 'resonance',
  'vibration', 'clarity', 'integrity'
];

/** Normalize a value to 0-100 given expected range */
function norm(value, min, max, invert = false) {
  if (value === null || value === undefined) return 50; // default neutral
  const clamped = Math.max(min, Math.min(max, value));
  const ratio = (clamped - min) / (max - min);
  return Math.round((invert ? 1 - ratio : ratio) * 100);
}

/**
 * Map raw vitals and voice metrics to 7 biofield parameters.
 *
 * @param {{ hr: number|null, hrv: number|null, breathingRate: number|null, coherence: number|null, hrSmoothed: number|null }} vitals
 * @param {{ pitch: number|null, jitter: number|null, shimmer: number|null, hnr: number|null, rms: number|null, spectralCentroid: number|null }} voice
 * @returns {{ stability: number, flow: number, energy: number, resonance: number, vibration: number, clarity: number, integrity: number, luminosity: number }}
 */
export function mapToBiofield(vitals, voice) {
  // 1. Стабильность — HRV (RMSSD): middle values (around 50ms) = high stability
  const stability = vitals.hrv !== null
    ? 100 - Math.min(100, Math.abs(vitals.hrv - 50) * 2)
    : 50;

  // 2. Поток — smoothness of HR (low variance = high flow)
  const flow = vitals.hrSmoothed !== null
    ? norm(vitals.hrSmoothed, 0, 100)
    : 50;

  // 3. Энергия — HR in normal zone (60-80 optimal) + voice volume
  const hrScore = vitals.hr !== null
    ? 100 - Math.min(100, Math.abs(vitals.hr - 70) * 2.5)
    : 50;
  const volumeScore = norm(voice.rms, 0, 0.3);
  const energy = Math.round(hrScore * 0.6 + volumeScore * 0.4);

  // 4. Резонанс — Heart Coherence
  const resonance = vitals.coherence ?? 50;

  // 5. Вибрация — Pitch + spectral centroid (richness of overtones)
  const pitchScore = norm(voice.pitch, 80, 300);
  const centroidScore = norm(voice.spectralCentroid, 500, 4000);
  const vibration = Math.round(pitchScore * 0.5 + centroidScore * 0.5);

  // 6. Ясность — HNR (clarity) + low jitter
  const hnrScore = norm(voice.hnr, 0, 25);
  const jitterScore = norm(voice.jitter, 0, 5, true); // inverted: low jitter = high clarity
  const clarity = Math.round(hnrScore * 0.6 + jitterScore * 0.4);

  // 7. Целостность — consistency of all parameters (low spread)
  const params = [stability, flow, energy, resonance, vibration, clarity];
  const mean = params.reduce((a, b) => a + b) / params.length;
  const variance = params.reduce((s, v) => s + (v - mean) ** 2, 0) / params.length;
  const consistency = Math.max(0, 100 - Math.sqrt(variance) * 3);
  const integrity = Math.round(consistency);

  // Светимость — weighted average of all 7
  const all = [stability, flow, energy, resonance, vibration, clarity, integrity];
  const luminosity = Math.round(all.reduce((a, b) => a + b) / all.length);

  return { stability, flow, energy, resonance, vibration, clarity, integrity, luminosity };
}
