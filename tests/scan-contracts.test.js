import test from 'node:test';
import assert from 'node:assert/strict';

import { createSensorStatus } from '../scan-contracts.js';
import { deriveQualityFlags } from '../scan-quality.js';
import { computeBiofieldFrame } from '../scan-runtime.js';

const vitalsFixture = {
  hr: 72,
  hrv: 54,
  sdnn: 70,
  pnn50: 18,
  lfhf: 1.4,
  stressIndex: 110,
  breathingRate: 12,
  coherence: 76,
  hrSmoothed: 72,
  hrDelta: 2,
  signalQuality: 88,
};

const voiceFixture = {
  pitch: 182,
  jitter: 1.2,
  shimmer: 2.1,
  hnr: 18,
  rms: 0.08,
  spectralCentroid: 1800,
  formants: [540, 1480, 2550],
  voiceBioCenter: 4,
};

const vibraFixture = {
  amplitude: 42,
  frequency: 32,
  symmetry: 86,
  entropy: 24,
  amplitudeLower: 28,
};

test('SensorStatus contract remains stable', () => {
  const statuses = createSensorStatus({
    camera: 'ready',
    microphone: 'denied',
    face: 'tracking',
    pulse: 'weak',
    hdMode: 'active',
  });

  assert.deepEqual(Object.keys(statuses), [
    'camera',
    'microphone',
    'face',
    'pulse',
    'hdMode',
  ]);
  assert.deepEqual(statuses, {
    camera: 'ready',
    microphone: 'denied',
    face: 'tracking',
    pulse: 'weak',
    hdMode: 'active',
  });
});

test('BiofieldResult contract exposes stable keys, trace and quality state', () => {
  const qualityFlags = deriveQualityFlags({
    camera: 'ready',
    microphone: 'ready',
    face: 'tracking',
    pulse: 'ready',
    hdMode: 'off',
  });

  const biofield = computeBiofieldFrame({
    vitals: vitalsFixture,
    voiceMetrics: voiceFixture,
    vibraimageMetrics: vibraFixture,
    emotions: { laughing: false, smiling: true, laughIntensity: 0, smileIntensity: 32 },
    baseline: { hrMedian: 70, rmssdMedian: 50, amplitudeMedian: 40 },
    facePresent: true,
    previousBiofield: null,
    qualityFlags,
  });

  assert.deepEqual(Object.keys(biofield), [
    'stability',
    'flow',
    'energy',
    'resonance',
    'vibration',
    'clarity',
    'integrity',
    'luminosity',
    'confidence',
    'qualityFlags',
    'trace',
  ]);
  assert.deepEqual(Object.keys(biofield.confidence), [
    'stability',
    'flow',
    'energy',
    'resonance',
    'vibration',
    'clarity',
    'integrity',
  ]);
  assert.ok(Array.isArray(biofield.trace.stability));
  assert.equal(typeof biofield.qualityFlags.scanConfidence, 'number');
});
