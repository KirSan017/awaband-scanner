import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveQualityFlags,
  deriveSensorStatus,
  deriveStatusMessage,
} from '../scan-quality.js';

test('deriveSensorStatus marks microphone denial and weak pulse', () => {
  const statuses = deriveSensorStatus({
    cameraReady: true,
    microphoneReady: false,
    microphoneDenied: true,
    faceDetected: true,
    framesWithoutFace: 0,
    bufferFullness: 0.9,
    signalQuality: 12,
    hr: 74,
    hdMode: 'active',
  });

  assert.deepEqual(statuses, {
    camera: 'ready',
    microphone: 'denied',
    face: 'tracking',
    pulse: 'weak',
    hdMode: 'active',
  });
});

test('deriveQualityFlags exposes partial scan reasons', () => {
  const flags = deriveQualityFlags({
    camera: 'ready',
    microphone: 'denied',
    face: 'tracking',
    pulse: 'weak',
    hdMode: 'off',
  });

  assert.equal(flags.partial, true);
  assert.deepEqual(flags.partialReasons, ['microphone_unavailable', 'pulse_weak']);
  assert.match(flags.summary, /Частичный результат/);
  assert.equal(flags.microphoneReady, false);
  assert.equal(flags.pulseReliable, false);
  assert.equal(flags.scanState, 'partial');
  assert.equal(flags.parameterConfidenceCaps.vibration, 0.65);
  assert.equal(flags.parameterConfidenceCaps.stability, 0.55);
});

test('deriveStatusMessage prefers quality-aware user guidance', () => {
  const cameraDenied = deriveStatusMessage(
    { camera: 'denied', microphone: 'pending', face: 'searching', pulse: 'unavailable', hdMode: 'off' },
    { hr: null, bufferFullness: 0 },
  );
  assert.match(cameraDenied, /Камера недоступна/);

  const warmup = deriveStatusMessage(
    { camera: 'ready', microphone: 'ready', face: 'tracking', pulse: 'warming_up', hdMode: 'off' },
    { hr: null, bufferFullness: 0.22 },
  );
  assert.match(warmup, /Калибровка пульса/);
});
