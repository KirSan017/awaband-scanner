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
 * Map raw vitals, voice metrics, and vibraimage data to 7 biofield parameters.
 *
 * @param {{ hr: number|null, hrv: number|null, sdnn: number|null, pnn50: number|null, lfhf: number|null, stressIndex: number|null, breathingRate: number|null, coherence: number|null, hrSmoothed: number|null }} vitals
 * @param {{ pitch: number|null, jitter: number|null, shimmer: number|null, hnr: number|null, rms: number|null, spectralCentroid: number|null, formants: number[]|null, voiceBioCenter: number|null }} voice
 * @param {{ amplitude: number|null, frequency: number|null, symmetry: number|null, entropy: number|null }|null} vibraimage
 * @returns {{ stability: number, flow: number, energy: number, resonance: number, vibration: number, clarity: number, integrity: number, luminosity: number }}
 */
export function mapToBiofield(vitals, voice, vibraimage = null) {
  const vib = vibraimage || { amplitude: null, frequency: null, symmetry: null, entropy: null };

  // 1. Стабильность — HRV (RMSSD + SDNN) + vibraimage symmetry
  //    Optimal RMSSD ~50ms, SDNN ~50-100ms; low stress index = stable
  let stabilityBase = vitals.hrv !== null
    ? 100 - Math.min(100, Math.abs(vitals.hrv - 50) * 2)
    : 50;
  // SDNN bonus: good SDNN (50-100ms) adds up to 10 points
  if (vitals.sdnn !== null) {
    const sdnnScore = 100 - Math.min(100, Math.abs(vitals.sdnn - 75) * 2);
    stabilityBase = Math.round(stabilityBase * 0.7 + sdnnScore * 0.3);
  }
  // Stress index penalty: SI > 150 reduces stability
  if (vitals.stressIndex !== null) {
    const stressPenalty = Math.max(0, Math.min(30, (vitals.stressIndex - 150) * 0.1));
    stabilityBase = Math.round(Math.max(0, stabilityBase - stressPenalty));
  }
  // Vibraimage symmetry bonus
  if (vib.symmetry !== null) {
    stabilityBase = Math.round(stabilityBase * 0.8 + vib.symmetry * 0.2);
  }
  const stability = Math.min(100, stabilityBase);

  // 2. Поток — smoothness of HR + low vibraimage entropy (regular micro-movements)
  let flowBase = vitals.hrSmoothed !== null
    ? norm(vitals.hrSmoothed, 0, 100)
    : 50;
  // pNN50: moderate values (10-30%) indicate good parasympathetic tone
  if (vitals.pnn50 !== null) {
    const pnnScore = 100 - Math.min(100, Math.abs(vitals.pnn50 - 20) * 3);
    flowBase = Math.round(flowBase * 0.7 + pnnScore * 0.3);
  }
  // Vibraimage: low entropy = regular patterns = better flow
  if (vib.entropy !== null) {
    const entropyFlow = Math.max(0, 100 - vib.entropy);
    flowBase = Math.round(flowBase * 0.8 + entropyFlow * 0.2);
  }
  const flow = Math.min(100, flowBase);

  // 3. Энергия — HR in normal zone + voice volume + vibraimage amplitude
  const hrScore = vitals.hr !== null
    ? 100 - Math.min(100, Math.abs(vitals.hr - 70) * 2.5)
    : 50;
  const volumeScore = norm(voice.rms, 0, 0.3);
  let energyBase = Math.round(hrScore * 0.5 + volumeScore * 0.3);
  // Vibraimage amplitude: moderate movement = vitality
  if (vib.amplitude !== null) {
    const ampScore = 100 - Math.min(100, Math.abs(vib.amplitude - 40) * 2.5);
    energyBase += Math.round(ampScore * 0.2);
  } else {
    energyBase = Math.round(hrScore * 0.6 + volumeScore * 0.4);
  }
  const energy = Math.min(100, energyBase);

  // 4. Резонанс — Heart Coherence + LF/HF balance
  let resonanceBase = vitals.coherence ?? 50;
  // LF/HF: optimal ~1.0-2.0 (balanced ANS); too high = stress, too low = fatigue
  if (vitals.lfhf !== null) {
    const lfhfScore = 100 - Math.min(100, Math.abs(vitals.lfhf - 1.5) * 40);
    resonanceBase = Math.round(resonanceBase * 0.7 + lfhfScore * 0.3);
  }
  const resonance = Math.min(100, Math.max(0, resonanceBase));

  // 5. Вибрация — Pitch + spectral centroid + vibraimage frequency
  const pitchScore = norm(voice.pitch, 80, 300);
  const centroidScore = norm(voice.spectralCentroid, 500, 4000);
  let vibrationBase = Math.round(pitchScore * 0.4 + centroidScore * 0.4);
  // Vibraimage frequency: moderate tremor frequency = healthy
  if (vib.frequency !== null) {
    vibrationBase += Math.round(vib.frequency * 0.2);
  } else {
    vibrationBase = Math.round(pitchScore * 0.5 + centroidScore * 0.5);
  }
  const vibration = Math.min(100, vibrationBase);

  // 6. Ясность — HNR + low jitter + formant clarity + vibraimage stillness
  const hnrScore = norm(voice.hnr, 0, 25);
  const jitterScore = norm(voice.jitter, 0, 5, true);
  // Formant bonus: well-defined formants (F1 300-800, F2 800-2500) indicate clear articulation
  let formantScore = 50;
  if (voice.formants && voice.formants[0] && voice.formants[1]) {
    const f1ok = voice.formants[0] >= 250 && voice.formants[0] <= 900;
    const f2ok = voice.formants[1] >= 800 && voice.formants[1] <= 2800;
    formantScore = (f1ok ? 75 : 30) * 0.5 + (f2ok ? 75 : 30) * 0.5;
  }
  let clarityBase = Math.round(hnrScore * 0.4 + jitterScore * 0.25 + formantScore * 0.15);
  // Low vibraimage amplitude = calm/focused = high clarity
  if (vib.amplitude !== null) {
    const calmScore = Math.max(0, 100 - vib.amplitude);
    clarityBase += Math.round(calmScore * 0.2);
  } else {
    clarityBase = Math.round(hnrScore * 0.5 + jitterScore * 0.3 + formantScore * 0.2);
  }
  const clarity = Math.min(100, clarityBase);

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
