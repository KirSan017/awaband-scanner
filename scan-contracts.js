export const EMPTY_VOICE_METRICS = Object.freeze({
  pitch: null,
  jitter: null,
  shimmer: null,
  hnr: null,
  rms: null,
  spectralCentroid: null,
  formants: null,
  voiceBioCenter: null,
});

export const EMPTY_VIBRAIMAGE_METRICS = Object.freeze({
  amplitude: null,
  frequency: null,
  symmetry: null,
  entropy: null,
  amplitudeLower: null,
});

export const EMPTY_EMOTIONS = Object.freeze({
  laughing: false,
  smiling: false,
  laughIntensity: 0,
  smileIntensity: 0,
});

export const EMPTY_VITALS = Object.freeze({
  hr: null,
  hrv: null,
  sdnn: null,
  pnn50: null,
  lfhf: null,
  stressIndex: null,
  breathingRate: null,
  coherence: null,
  hrSmoothed: null,
  hrDelta: null,
  signalQuality: null,
});

export const DEFAULT_SENSOR_STATUS = Object.freeze({
  camera: 'pending',
  microphone: 'pending',
  face: 'searching',
  pulse: 'warming_up',
  hdMode: 'off',
});

export function cloneVoiceMetrics(metrics = EMPTY_VOICE_METRICS) {
  return {
    ...EMPTY_VOICE_METRICS,
    ...(metrics || {}),
    formants: Array.isArray(metrics?.formants) ? [...metrics.formants] : null,
  };
}

export function cloneVibraimageMetrics(metrics = EMPTY_VIBRAIMAGE_METRICS) {
  return { ...EMPTY_VIBRAIMAGE_METRICS, ...(metrics || {}) };
}

export function cloneEmotions(emotions = EMPTY_EMOTIONS) {
  return { ...EMPTY_EMOTIONS, ...(emotions || {}) };
}

export function cloneVitals(vitals = EMPTY_VITALS) {
  return { ...EMPTY_VITALS, ...(vitals || {}) };
}

export function createSensorStatus(overrides = {}) {
  return { ...DEFAULT_SENSOR_STATUS, ...overrides };
}
