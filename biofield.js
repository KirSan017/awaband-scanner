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

/** Normalize a value to 0-100 given expected range. Returns null if no data. */
function norm(value, min, max, invert = false) {
  if (value === null || value === undefined) return null;
  const clamped = Math.max(min, Math.min(max, value));
  const ratio = (clamped - min) / (max - min);
  return Math.round((invert ? 1 - ratio : ratio) * 100);
}

/** Use computed value or fallback (default 0, not 50) */
function val(computed, fallback = 0) {
  return computed !== null && computed !== undefined ? computed : fallback;
}

/**
 * Map raw vitals, voice metrics, and vibraimage data to 7 biofield parameters.
 *
 * @param {{ hr: number|null, hrv: number|null, sdnn: number|null, pnn50: number|null, lfhf: number|null, stressIndex: number|null, breathingRate: number|null, coherence: number|null, hrSmoothed: number|null, hrDelta: number|null, signalQuality: number|null }} vitals
 * @param {{ pitch: number|null, jitter: number|null, shimmer: number|null, hnr: number|null, rms: number|null, spectralCentroid: number|null, formants: number[]|null, voiceBioCenter: number|null }} voice
 * @param {{ amplitude: number|null, frequency: number|null, symmetry: number|null, entropy: number|null }|null} vibraimage
 * @param {{ laughing: boolean, smiling: boolean, laughIntensity: number, smileIntensity: number }|null} emotions
 * @param {{ hrMedian: number|null, rmssdMedian: number|null, amplitudeMedian: number|null }|null} baseline
 * @returns {{ stability: number, flow: number, energy: number, resonance: number, vibration: number, clarity: number, integrity: number, luminosity: number, confidence: object }}
 */
export function mapToBiofield(vitals, voice, vibraimage = null, emotions = null, baseline = null) {
  const vib = vibraimage || { amplitude: null, frequency: null, symmetry: null, entropy: null };
  const isSilent = !voice.rms || voice.rms < 0.02;

  // Signal quality reduces confidence of pulse-dependent params
  const sigQ = (vitals.signalQuality !== null && vitals.signalQuality < 30) ? 0.5 : 1;

  // ── Confidence calculation ──
  const confidence = {
    stability: (vitals.hrv !== null ? 0.7 : 0) + (vitals.sdnn !== null ? 0.15 : 0) + (vib.symmetry !== null ? 0.15 : 0),
    flow: (vitals.hrDelta !== null ? 0.5 : 0) + (vitals.pnn50 !== null ? 0.3 : 0) + (vib.entropy !== null ? 0.2 : 0),
    energy: (vitals.hr !== null ? 0.5 : 0) + (voice.rms > 0.01 ? 0.3 : 0) + (vib.amplitude !== null ? 0.2 : 0),
    resonance: (vitals.coherence !== null ? 0.7 : vitals.hr !== null ? 0.3 : 0) + (vitals.lfhf !== null ? 0.3 : 0),
    vibration: isSilent
      ? (vib.frequency !== null ? 0.8 : 0) + (vib.amplitude !== null ? 0.2 : 0)
      : (voice.pitch !== null ? 0.4 : 0) + (voice.spectralCentroid !== null ? 0.4 : 0) + (vib.frequency !== null ? 0.2 : 0),
    clarity: isSilent
      ? (vib.amplitude !== null ? 0.8 : 0) + (vib.symmetry !== null ? 0.2 : 0)
      : (voice.hnr !== null ? 0.4 : 0) + (voice.jitter !== null ? 0.25 : 0) + (voice.formants !== null ? 0.15 : 0) + (vib.amplitude !== null ? 0.2 : 0),
  };
  // Scale pulse-dependent confidence by signal quality
  confidence.stability *= sigQ;
  confidence.flow *= sigQ;
  confidence.energy = Math.min(confidence.energy, confidence.energy * (sigQ * 0.5 + 0.5));
  confidence.resonance *= sigQ;

  // Baseline HR target (personal or default)
  const hrTarget = baseline?.hrMedian ?? 70;
  const rmssdTarget = baseline?.rmssdMedian ?? 50;

  // 1. Стабильность — HRV (RMSSD + SDNN) + vibraimage symmetry
  const hrvScore = norm(vitals.hrv, 0, rmssdTarget * 2);
  let stabilityBase = val(hrvScore);
  // SDNN bonus
  if (vitals.sdnn !== null) {
    const sdnnScore = 100 - Math.min(100, Math.abs(vitals.sdnn - 75) * 1.5);
    stabilityBase = Math.round(stabilityBase * 0.7 + sdnnScore * 0.3);
  }
  // Stress index penalty: increased weight — SI > 100 starts reducing
  if (vitals.stressIndex !== null) {
    const stressPenalty = Math.max(0, Math.min(40, (vitals.stressIndex - 100) * 0.2));
    stabilityBase = Math.round(Math.max(0, stabilityBase - stressPenalty));
  }
  // Vibraimage symmetry bonus
  if (vib.symmetry !== null) {
    stabilityBase = Math.round(stabilityBase * 0.8 + vib.symmetry * 0.2);
  }
  // null when no primary data — smoothBiofield will hold previous value
  const stability = (vitals.hrv === null && vitals.sdnn === null && vib.symmetry === null) ? null : Math.min(100, stabilityBase);

  // 2. Поток — smoothness of HR (delta-based) + pNN50 + low vibraimage entropy
  // hrDelta = |currentHR - prevHR|, small delta = high flow
  const smoothness = vitals.hrDelta !== null ? Math.max(0, 100 - vitals.hrDelta * 8) : null;
  let flowBase = val(smoothness);
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
  const flow = (vitals.hrDelta === null && vitals.pnn50 === null && vib.entropy === null) ? null : Math.min(100, flowBase);

  // 3. Энергия — HR in optimal plateau + voice volume + vibraimage amplitude
  //    Plateau 60-85 BPM = score 80-100 (wider sweet spot)
  let hrScore;
  if (vitals.hr !== null) {
    if (vitals.hr >= 60 && vitals.hr <= 85) {
      hrScore = 80 + Math.round((1 - Math.abs(vitals.hr - 72.5) / 12.5) * 20);
    } else {
      hrScore = Math.max(0, 80 - Math.abs(vitals.hr - (vitals.hr < 60 ? 60 : 85)) * 3);
    }
  } else {
    hrScore = null;
  }
  // Voice weight depends on silence
  const voiceWeight = isSilent ? 0.1 : 0.3;
  const cameraWeight = isSilent ? 0.7 : 0.5;
  const volumeScore = norm(voice.rms, 0, 0.3);
  let energyBase = Math.round(val(hrScore) * cameraWeight + val(volumeScore) * voiceWeight);
  // Vibraimage amplitude: moderate movement = vitality
  if (vib.amplitude !== null) {
    const ampScore = 100 - Math.min(100, Math.abs(vib.amplitude - 40) * 2.5);
    energyBase += Math.round(ampScore * 0.2);
  } else {
    energyBase = Math.round(val(hrScore) * (cameraWeight + 0.1) + val(volumeScore) * (voiceWeight + 0.1));
  }
  const energy = (vitals.hr === null && vib.amplitude === null) ? null : Math.min(100, energyBase);

  // 4. Резонанс — Heart Coherence + LF/HF balance
  let resonanceBase = vitals.coherence !== null ? vitals.coherence : 0;
  if (vitals.lfhf !== null) {
    const lfhfScore = 100 - Math.min(100, Math.abs(vitals.lfhf - 1.5) * 40);
    resonanceBase = Math.round(resonanceBase * 0.7 + lfhfScore * 0.3);
  }
  const resonance = (vitals.coherence === null && vitals.lfhf === null && vitals.hr === null) ? null : Math.min(100, Math.max(0, resonanceBase));

  // 5. Вибрация — Pitch + spectral centroid + vibraimage frequency
  //    Silent mode: only vibraimage frequency
  let vibration;
  if (isSilent) {
    vibration = vib.frequency !== null ? Math.max(0, Math.min(100, Math.round(vib.frequency * 0.7 + 15))) : 0;
  } else {
    const pitchScore = norm(voice.pitch, 80, 300);
    const centroidScore = norm(voice.spectralCentroid, 500, 4000);
    let vibrationBase = Math.round(val(pitchScore) * 0.4 + val(centroidScore) * 0.4);
    if (vib.frequency !== null) {
      vibrationBase += Math.round(vib.frequency * 0.2);
    } else {
      vibrationBase = Math.round(val(pitchScore) * 0.5 + val(centroidScore) * 0.5);
    }
    vibration = Math.min(100, vibrationBase);
  }

  // 6. Ясность — HNR + low jitter + formant clarity + vibraimage stillness
  //    Silent mode: bonus +15 for calm body
  let clarity;
  if (isSilent) {
    // In silence, clarity comes from body stillness
    const calmScore = vib.amplitude !== null ? Math.max(0, 100 - vib.amplitude) : 0;
    const silenceBonus = vib.amplitude !== null && vib.amplitude < 20 ? 15 : 0;
    clarity = Math.min(100, Math.round(calmScore * 0.7) + silenceBonus);
  } else {
    const hnrScore = norm(voice.hnr, 0, 25);
    const jitterScore = norm(voice.jitter, 0, 5, true);
    let formantScore = 0;
    if (voice.formants && voice.formants[0] && voice.formants[1]) {
      const f1ok = voice.formants[0] >= 250 && voice.formants[0] <= 900;
      const f2ok = voice.formants[1] >= 800 && voice.formants[1] <= 2800;
      formantScore = (f1ok ? 75 : 30) * 0.5 + (f2ok ? 75 : 30) * 0.5;
    }
    let clarityBase = Math.round(val(hnrScore) * 0.4 + val(jitterScore) * 0.25 + formantScore * 0.15);
    if (vib.amplitude !== null) {
      const calmScore = Math.max(0, 100 - vib.amplitude);
      clarityBase += Math.round(calmScore * 0.2);
    } else {
      clarityBase = Math.round(val(hnrScore) * 0.5 + val(jitterScore) * 0.3 + formantScore * 0.2);
    }
    clarity = Math.min(100, clarityBase);
  }

  // ── Emotion bonuses (laugh/smile) — only apply to non-null params ──
  let eFinal = energy, fFinal = flow, sFinal = stability, rFinal = resonance;

  if (emotions) {
    const li = (emotions.laughIntensity || 0) / 100;
    const si = (emotions.smileIntensity || 0) / 100;

    if (eFinal !== null) eFinal = Math.min(100, eFinal + Math.round(li * 15));
    if (fFinal !== null) fFinal = Math.min(100, fFinal + Math.round(li * 10));
    if (sFinal !== null) sFinal = Math.min(100, sFinal + Math.round(si * 10));
    if (rFinal !== null) rFinal = Math.min(100, rFinal + Math.round(si * 10));
  }

  // 7. Целостность — consistency of all parameters (low spread)
  //    Only calculated if >= 4 params have confidence > 0.5
  const paramsArr = [sFinal, fFinal, eFinal, rFinal, vibration, clarity].map(v => v ?? 0);
  const confValues = [confidence.stability, confidence.flow, confidence.energy, confidence.resonance, confidence.vibration, confidence.clarity];
  const highConfCount = confValues.filter(c => c > 0.5).length;

  let integrity;
  if (highConfCount >= 4) {
    const mean = paramsArr.reduce((a, b) => a + b) / paramsArr.length;
    const variance = paramsArr.reduce((s, v) => s + (v - mean) ** 2, 0) / paramsArr.length;
    const consistency = Math.max(0, 100 - Math.sqrt(variance) * 3);
    integrity = Math.round(consistency);
  } else {
    integrity = 0;
  }
  confidence.integrity = highConfCount >= 4 ? 1 : highConfCount / 8;

  // Светимость — weighted average of all 7 (null params treated as 0)
  const all = [sFinal, fFinal, eFinal, rFinal, vibration, clarity, integrity].map(v => v ?? 0);
  const luminosity = Math.round(all.reduce((a, b) => a + b) / all.length);

  return { stability: sFinal, flow: fFinal, energy: eFinal, resonance: rFinal, vibration, clarity, integrity, luminosity, confidence };
}
