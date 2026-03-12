import { mapToBiofield } from './biofield.js';
import { finalizeQualityFlags, QUALITY_KEYS } from './scan-quality.js';
import {
  cloneEmotions,
  cloneVibraimageMetrics,
  cloneVitals,
  cloneVoiceMetrics,
} from './scan-contracts.js';

export const EMA_ALPHA = 0.15;
export const EMA_ALPHA_FAST = 0.5;
export const SCAN_EXPORT_SCHEMA = 'awaband-session-export';
export const SCAN_EXPORT_VERSION = 2;

export const NEUTRAL_BIOFIELD = Object.freeze({
  stability: 0,
  flow: 0,
  energy: 0,
  resonance: 0,
  vibration: 0,
  clarity: 0,
  integrity: 0,
  luminosity: 0,
  confidence: Object.freeze({
    stability: 0,
    flow: 0,
    energy: 0,
    resonance: 0,
    vibration: 0,
    clarity: 0,
    integrity: 0,
  }),
});

export function smoothBiofield(raw, prev, alpha = EMA_ALPHA) {
  if (!prev) return cloneBiofield(raw);

  const result = {};
  for (const key of Object.keys(raw)) {
    if (key === 'confidence') {
      result[key] = { ...(raw.confidence || {}) };
      continue;
    }
    if (key === 'qualityFlags') {
      result[key] = cloneQualityFlags(raw.qualityFlags);
      continue;
    }
    if (key === 'trace') {
      result[key] = cloneTrace(raw.trace);
      continue;
    }

    const prevVal = typeof prev[key] === 'number' ? prev[key] : 0;
    if (raw[key] === null) {
      result[key] = prevVal;
      continue;
    }

    const rawVal = typeof raw[key] === 'number' ? raw[key] : 0;
    result[key] = Math.round(prevVal * (1 - alpha) + rawVal * alpha);
  }
  return result;
}

export function buildParameterTrace({
  vitals,
  voiceMetrics,
  vibraimageMetrics,
  emotions,
} = {}) {
  const silent = !voiceMetrics?.rms || voiceMetrics.rms < 0.02;

  return {
    stability: collect([
      vitals?.hrv != null ? 'vitals.hrv' : null,
      vitals?.sdnn != null ? 'vitals.sdnn' : null,
      vitals?.stressIndex != null ? 'vitals.stressIndex' : null,
      vibraimageMetrics?.symmetry != null ? 'vibraimageMetrics.symmetry' : null,
      emotions?.smileIntensity ? 'emotions.smileIntensity' : null,
    ]),
    flow: collect([
      vitals?.hrDelta != null ? 'vitals.hrDelta' : null,
      vitals?.pnn50 != null ? 'vitals.pnn50' : null,
      vibraimageMetrics?.entropy != null ? 'vibraimageMetrics.entropy' : null,
      emotions?.laughIntensity ? 'emotions.laughIntensity' : null,
    ]),
    energy: collect([
      vitals?.hr != null ? 'vitals.hr' : null,
      voiceMetrics?.rms > 0.01 ? 'voiceMetrics.rms' : null,
      vibraimageMetrics?.amplitude != null ? 'vibraimageMetrics.amplitude' : null,
      emotions?.laughIntensity ? 'emotions.laughIntensity' : null,
    ]),
    resonance: collect([
      vitals?.coherence != null ? 'vitals.coherence' : null,
      vitals?.lfhf != null ? 'vitals.lfhf' : null,
      emotions?.smileIntensity ? 'emotions.smileIntensity' : null,
    ]),
    vibration: silent
      ? collect([
          vibraimageMetrics?.frequency != null ? 'vibraimageMetrics.frequency' : null,
          vibraimageMetrics?.amplitude != null ? 'vibraimageMetrics.amplitude' : null,
        ])
      : collect([
          voiceMetrics?.pitch != null ? 'voiceMetrics.pitch' : null,
          voiceMetrics?.spectralCentroid != null ? 'voiceMetrics.spectralCentroid' : null,
          vibraimageMetrics?.frequency != null ? 'vibraimageMetrics.frequency' : null,
        ]),
    clarity: silent
      ? collect([
          vibraimageMetrics?.amplitude != null ? 'vibraimageMetrics.amplitude' : null,
          vibraimageMetrics?.symmetry != null ? 'vibraimageMetrics.symmetry' : null,
        ])
      : collect([
          voiceMetrics?.hnr != null ? 'voiceMetrics.hnr' : null,
          voiceMetrics?.jitter != null ? 'voiceMetrics.jitter' : null,
          voiceMetrics?.formants ? 'voiceMetrics.formants' : null,
          vibraimageMetrics?.amplitude != null ? 'vibraimageMetrics.amplitude' : null,
        ]),
    integrity: [
      'biofield.stability',
      'biofield.flow',
      'biofield.energy',
      'biofield.resonance',
      'biofield.vibration',
      'biofield.clarity',
    ],
    luminosity: [
      'biofield.stability',
      'biofield.flow',
      'biofield.energy',
      'biofield.resonance',
      'biofield.vibration',
      'biofield.clarity',
      'biofield.integrity',
    ],
  };
}

export function attachBiofieldMeta(biofield, qualityFlags = null, trace = null) {
  const cloned = cloneBiofield(biofield);
  cloned.qualityFlags = cloneQualityFlags(qualityFlags);
  cloned.trace = cloneTrace(trace);
  return cloned;
}

export function computeBiofieldFrame({
  vitals,
  voiceMetrics,
  vibraimageMetrics,
  emotions,
  baseline,
  facePresent,
  previousBiofield,
  qualityFlags = null,
} = {}) {
  const trace = buildParameterTrace({ vitals, voiceMetrics, vibraimageMetrics, emotions });
  const rawBiofield = facePresent
    ? mapToBiofield(vitals, voiceMetrics, vibraimageMetrics, emotions, baseline)
    : NEUTRAL_BIOFIELD;
  const gatedBiofield = applyQualityCaps(rawBiofield, qualityFlags?.parameterConfidenceCaps);
  const retainedParameters = facePresent ? detectRetainedParameters(rawBiofield, previousBiofield) : [];
  const resolvedQualityFlags = finalizeQualityFlags(
    qualityFlags || {},
    gatedBiofield.confidence || {},
    retainedParameters,
  );
  const smoothed = smoothBiofield(
    attachBiofieldMeta(gatedBiofield, resolvedQualityFlags, trace),
    previousBiofield,
    facePresent ? EMA_ALPHA : EMA_ALPHA_FAST,
  );
  smoothed.qualityFlags = cloneQualityFlags(resolvedQualityFlags);
  smoothed.trace = cloneTrace(trace);
  return smoothed;
}

export function buildScanExport({
  timestamp,
  biofield,
  vitals,
  voiceMetrics,
  vibraimageMetrics,
  emotions,
  statuses,
  runtime,
  baseline = null,
  session = null,
  timeline = null,
  signals = null,
  statusMessage = null,
} = {}) {
  return {
    exportSchema: SCAN_EXPORT_SCHEMA,
    exportVersion: SCAN_EXPORT_VERSION,
    timestamp,
    statusMessage,
    biofield: cloneBiofield(biofield),
    vitals: cloneVitals(vitals),
    voiceMetrics: cloneVoiceMetrics(voiceMetrics),
    vibraimageMetrics: cloneVibraimageMetrics(vibraimageMetrics),
    emotions: cloneEmotions(emotions),
    statuses: statuses ? { ...statuses } : null,
    runtime: cloneRuntime(runtime),
    baseline: cloneBaseline(baseline),
    session: cloneSession(session),
    timeline: cloneTimeline(timeline),
    signals: cloneSignals(signals),
  };
}

export function cloneBiofield(biofield) {
  if (!biofield) return null;
  return {
    ...biofield,
    confidence: { ...(biofield.confidence || {}) },
    qualityFlags: cloneQualityFlags(biofield.qualityFlags),
    trace: cloneTrace(biofield.trace),
  };
}

function applyQualityCaps(biofield, caps = null) {
  if (!caps) return cloneBiofield(biofield);

  const next = cloneBiofield(biofield);
  next.confidence = Object.fromEntries(
    Object.entries(next.confidence || {}).map(([key, value]) => [
      key,
      Math.min(value ?? 0, caps[key] ?? 1),
    ]),
  );
  next.confidence.integrity = Math.min(
    next.confidence.integrity ?? 0,
    caps.integrity ?? 1,
  );
  return next;
}

function detectRetainedParameters(rawBiofield, previousBiofield) {
  if (!previousBiofield) return [];

  return QUALITY_KEYS.filter((key) => (
    rawBiofield[key] === null && typeof previousBiofield[key] === 'number'
  ));
}

function cloneQualityFlags(qualityFlags) {
  if (!qualityFlags) return null;
  return {
    ...qualityFlags,
    partialReasons: [...(qualityFlags.partialReasons || [])],
    detailLines: [...(qualityFlags.detailLines || [])],
    retainedParameters: [...(qualityFlags.retainedParameters || [])],
    diagnosticsOnlyMetrics: [...(qualityFlags.diagnosticsOnlyMetrics || [])],
    parameterConfidenceCaps: { ...(qualityFlags.parameterConfidenceCaps || {}) },
    parameterStates: { ...(qualityFlags.parameterStates || {}) },
  };
}

function cloneTrace(trace) {
  if (!trace) return null;
  return Object.fromEntries(
    Object.entries(trace).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]),
  );
}

function cloneRuntime(runtime) {
  if (!runtime) return null;
  return {
    ...runtime,
    partialReasons: [...(runtime.partialReasons || [])],
  };
}

function cloneBaseline(baseline) {
  if (!baseline) return null;
  return { ...baseline };
}

function cloneSession(session) {
  if (!session) return null;
  return { ...session };
}

function cloneTimeline(timeline) {
  if (!Array.isArray(timeline)) return null;
  return timeline.map((entry) => ({
    ...entry,
    biofield: entry?.biofield
      ? {
          ...entry.biofield,
          confidence: { ...(entry.biofield.confidence || {}) },
        }
      : null,
    vitals: cloneVitals(entry?.vitals),
    voiceMetrics: cloneVoiceMetrics(entry?.voiceMetrics),
    vibraimageMetrics: cloneVibraimageMetrics(entry?.vibraimageMetrics),
    emotions: cloneEmotions(entry?.emotions),
    statuses: entry?.statuses ? { ...entry.statuses } : null,
    quality: entry?.quality
      ? {
          ...entry.quality,
          partialReasons: [...(entry.quality.partialReasons || [])],
          retainedParameters: [...(entry.quality.retainedParameters || [])],
        }
      : null,
  }));
}

function cloneSignals(signals) {
  if (!signals) return null;
  return {
    rppg: signals.rppg
      ? {
          ...signals.rppg,
          rgb: signals.rppg.rgb
            ? {
                r: [...(signals.rppg.rgb.r || [])],
                g: [...(signals.rppg.rgb.g || [])],
                b: [...(signals.rppg.rgb.b || [])],
              }
            : null,
          pulseSignal: Array.isArray(signals.rppg.pulseSignal) ? [...signals.rppg.pulseSignal] : null,
        }
      : null,
    vibraimage: signals.vibraimage
      ? {
          ...signals.vibraimage,
          diffHistory: [...(signals.vibraimage.diffHistory || [])],
          symmetryHistory: [...(signals.vibraimage.symmetryHistory || [])],
          upperDiffHistory: [...(signals.vibraimage.upperDiffHistory || [])],
          lowerDiffHistory: [...(signals.vibraimage.lowerDiffHistory || [])],
        }
      : null,
  };
}

function collect(values) {
  return values.filter(Boolean);
}
