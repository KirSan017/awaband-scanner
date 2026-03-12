import { createSensorStatus } from './scan-contracts.js';

export const QUALITY_KEYS = [
  'stability',
  'flow',
  'energy',
  'resonance',
  'vibration',
  'clarity',
  'integrity',
];

const QUALITY_REASON_TEXT = {
  camera_unavailable: 'камера недоступна',
  microphone_unavailable: 'голосовой канал отключен',
  face_missing: 'лицо не фиксируется',
  pulse_warming_up: 'пульсовой сигнал прогревается',
  pulse_acquiring: 'пульсовой сигнал собирается',
  pulse_weak: 'пульсовой сигнал слабый',
};

const DIAGNOSTICS_ONLY_METRICS = Object.freeze([
  'vitals.breathingRate',
  'vitals.hrSmoothed',
  'voiceMetrics.shimmer',
  'voiceMetrics.voiceBioCenter',
]);

export function deriveSensorStatus({
  cameraReady = false,
  microphoneReady = false,
  microphoneDenied = false,
  faceDetected = false,
  framesWithoutFace = 0,
  bufferFullness = 0,
  signalQuality = null,
  hr = null,
  hdMode = 'off',
} = {}) {
  const camera = cameraReady ? 'ready' : 'denied';
  const microphone = microphoneReady ? 'ready' : (microphoneDenied ? 'denied' : 'pending');

  let face = 'searching';
  if (cameraReady && faceDetected) {
    face = 'tracking';
  } else if (cameraReady && (framesWithoutFace > 15 || bufferFullness > 0.2)) {
    face = 'lost';
  }

  let pulse = 'unavailable';
  if (cameraReady) {
    if (bufferFullness < 0.25) {
      pulse = 'warming_up';
    } else if (hr === null && bufferFullness < 1) {
      pulse = 'acquiring';
    } else if (signalQuality !== null && signalQuality < 30) {
      pulse = 'weak';
    } else if (hr !== null) {
      pulse = 'ready';
    }
  }

  return createSensorStatus({ camera, microphone, face, pulse, hdMode });
}

export function formatQualityReason(reason) {
  return QUALITY_REASON_TEXT[reason] || reason;
}

export function deriveQualityFlags(statuses) {
  const partialReasons = [];

  if (statuses.camera !== 'ready') {
    partialReasons.push('camera_unavailable');
  }
  if (statuses.microphone === 'denied') {
    partialReasons.push('microphone_unavailable');
  }
  if (statuses.face !== 'tracking') {
    partialReasons.push('face_missing');
  }
  if (statuses.pulse === 'warming_up') {
    partialReasons.push('pulse_warming_up');
  } else if (statuses.pulse === 'acquiring') {
    partialReasons.push('pulse_acquiring');
  } else if (statuses.pulse === 'weak') {
    partialReasons.push('pulse_weak');
  }

  const detailLines = partialReasons.map(formatQualityReason);
  const partial = partialReasons.length > 0;
  const parameterConfidenceCaps = deriveParameterConfidenceCaps(statuses);
  const scanState = statuses.camera !== 'ready' ? 'unavailable' : (partial ? 'partial' : 'full');

  let summary = 'Полный результат: все основные каналы доступны.';
  if (statuses.camera !== 'ready') {
    summary = 'Результат ограничен: камера недоступна.';
  } else if (partial) {
    summary = `Частичный результат: ${detailLines.join(', ')}.`;
  }

  return {
    partial,
    partialReasons,
    detailLines,
    summary,
    cameraReady: statuses.camera === 'ready',
    microphoneReady: statuses.microphone === 'ready',
    faceDetected: statuses.face === 'tracking',
    pulseReadable: statuses.pulse === 'ready' || statuses.pulse === 'weak',
    pulseReliable: statuses.pulse === 'ready',
    hdActive: statuses.hdMode === 'active',
    scanState,
    scanConfidence: Math.round(average(Object.values(parameterConfidenceCaps)) * 100),
    parameterConfidenceCaps,
    parameterStates: createDefaultParameterStates(parameterConfidenceCaps),
    retainedParameters: [],
    diagnosticsOnlyMetrics: [...DIAGNOSTICS_ONLY_METRICS],
  };
}

export function finalizeQualityFlags(baseFlags, confidence = {}, retainedParameters = []) {
  const next = {
    ...baseFlags,
    retainedParameters: [...retainedParameters],
    diagnosticsOnlyMetrics: [...(baseFlags?.diagnosticsOnlyMetrics || DIAGNOSTICS_ONLY_METRICS)],
  };

  next.parameterStates = Object.fromEntries(
    QUALITY_KEYS.map((key) => [key, deriveParameterState(key, confidence[key] ?? 0, retainedParameters)]),
  );
  next.scanConfidence = Math.round(
    average(QUALITY_KEYS.map((key) => confidence[key] ?? 0)) * 100,
  );
  next.summary = buildQualitySummary(next);

  return next;
}

export function deriveStatusMessage(statuses, { hr = null, bufferFullness = 0 } = {}) {
  const progress = `${Math.round(bufferFullness * 100)}%`;

  if (statuses.camera !== 'ready') {
    return 'Камера недоступна — проверьте разрешения';
  }
  if (statuses.face === 'searching') {
    return 'Ищем лицо...';
  }
  if (statuses.face === 'lost') {
    return 'Лицо потеряно — результат частичный';
  }
  if (statuses.pulse === 'warming_up') {
    return `Калибровка пульса... ${progress}`;
  }
  if (statuses.pulse === 'acquiring') {
    return `Захват сигнала... ${progress}`;
  }
  if (statuses.pulse === 'weak') {
    return 'Пульсовой сигнал слабый — добавьте свет и держите голову ровно';
  }
  if (hr !== null && statuses.microphone === 'denied') {
    return `HR: ${hr} bpm · голосовой канал отключен`;
  }
  if (hr !== null) {
    return `HR: ${hr} bpm`;
  }
  return `Захват сигнала... ${progress}`;
}

function deriveParameterConfidenceCaps(statuses) {
  const caps = {
    stability: 1,
    flow: 1,
    energy: 1,
    resonance: 1,
    vibration: 1,
    clarity: 1,
    integrity: 1,
  };

  if (statuses.camera !== 'ready' || statuses.face !== 'tracking') {
    for (const key of QUALITY_KEYS) {
      caps[key] = 0;
    }
    return caps;
  }

  if (statuses.pulse === 'warming_up') {
    caps.stability = 0.2;
    caps.flow = 0.2;
    caps.energy = 0.35;
    caps.resonance = 0.2;
  } else if (statuses.pulse === 'acquiring') {
    caps.stability = 0.35;
    caps.flow = 0.35;
    caps.energy = 0.45;
    caps.resonance = 0.35;
  } else if (statuses.pulse === 'weak') {
    caps.stability = 0.55;
    caps.flow = 0.55;
    caps.energy = 0.7;
    caps.resonance = 0.5;
  }

  if (statuses.microphone === 'denied') {
    caps.vibration = Math.min(caps.vibration, 0.65);
    caps.clarity = Math.min(caps.clarity, 0.65);
  }

  caps.integrity = average([
    caps.stability,
    caps.flow,
    caps.energy,
    caps.resonance,
    caps.vibration,
    caps.clarity,
  ]);

  return caps;
}

function createDefaultParameterStates(caps) {
  return Object.fromEntries(
    QUALITY_KEYS.map((key) => {
      const cap = caps[key] ?? 0;
      if (cap <= 0.01) return [key, 'unavailable'];
      if (cap < 0.7) return [key, 'partial'];
      return [key, 'ready'];
    }),
  );
}

function deriveParameterState(key, confidence, retainedParameters) {
  if (retainedParameters.includes(key)) {
    return 'retained';
  }
  if (confidence <= 0.01) {
    return 'unavailable';
  }
  if (confidence < 0.7) {
    return 'partial';
  }
  return 'ready';
}

function buildQualitySummary(flags) {
  const base = flags.scanState === 'full'
    ? 'Полный результат: все основные каналы доступны.'
    : flags.scanState === 'unavailable'
      ? 'Результат ограничен: камера недоступна.'
      : `Частичный результат: ${flags.detailLines.join(', ')}.`;
  return `${base} Доверие скана: ${flags.scanConfidence}%.`;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
