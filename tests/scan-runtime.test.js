import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildScanExport,
  computeBiofieldFrame,
  SCAN_EXPORT_SCHEMA,
  SCAN_EXPORT_VERSION,
} from '../scan-runtime.js';

const baseVitals = {
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

const baseVoice = {
  pitch: 182,
  jitter: 1.2,
  shimmer: 2.1,
  hnr: 18,
  rms: 0.08,
  spectralCentroid: 1800,
  formants: [540, 1480, 2550],
  voiceBioCenter: 4,
};

const baseVibra = {
  amplitude: 42,
  frequency: 32,
  symmetry: 86,
  entropy: 24,
  amplitudeLower: 28,
};

const qualityFlags = {
  partial: false,
  partialReasons: [],
  detailLines: [],
  summary: 'Полный результат: все основные каналы доступны.',
  cameraReady: true,
  microphoneReady: true,
  faceDetected: true,
  pulseReadable: true,
  pulseReliable: true,
  hdActive: false,
  scanState: 'full',
  scanConfidence: 100,
  retainedParameters: [],
  diagnosticsOnlyMetrics: [
    'vitals.breathingRate',
    'vitals.hrSmoothed',
    'voiceMetrics.shimmer',
    'voiceMetrics.voiceBioCenter',
  ],
  parameterConfidenceCaps: {
    stability: 1,
    flow: 1,
    energy: 1,
    resonance: 1,
    vibration: 1,
    clarity: 1,
    integrity: 1,
  },
  parameterStates: {
    stability: 'ready',
    flow: 'ready',
    energy: 'ready',
    resonance: 'ready',
    vibration: 'ready',
    clarity: 'ready',
    integrity: 'ready',
  },
};

test('computeBiofieldFrame keeps formulas but attaches contracts and trace', () => {
  const biofield = computeBiofieldFrame({
    vitals: baseVitals,
    voiceMetrics: baseVoice,
    vibraimageMetrics: baseVibra,
    emotions: { laughing: false, smiling: true, laughIntensity: 0, smileIntensity: 40 },
    baseline: { hrMedian: 70, rmssdMedian: 50, amplitudeMedian: 40 },
    facePresent: true,
    previousBiofield: null,
    qualityFlags,
  });

  assert.equal(biofield.qualityFlags.partial, false);
  assert.ok(Array.isArray(biofield.trace.flow));
  assert.ok(biofield.trace.flow.includes('vitals.hrDelta'));
  assert.ok(biofield.energy > 0);
  assert.equal(biofield.qualityFlags.scanState, 'full');
  assert.equal(biofield.qualityFlags.retainedParameters.length, 0);
});

test('computeBiofieldFrame decays to neutral when face is lost', () => {
  const previousBiofield = {
    stability: 80,
    flow: 60,
    energy: 50,
    resonance: 40,
    vibration: 30,
    clarity: 20,
    integrity: 10,
    luminosity: 35,
    confidence: {
      stability: 1,
      flow: 1,
      energy: 1,
      resonance: 1,
      vibration: 1,
      clarity: 1,
      integrity: 1,
    },
    qualityFlags,
    trace: {},
  };

  const biofield = computeBiofieldFrame({
    vitals: baseVitals,
    voiceMetrics: baseVoice,
    vibraimageMetrics: baseVibra,
    emotions: null,
    baseline: null,
    facePresent: false,
    previousBiofield,
    qualityFlags: { ...qualityFlags, partial: true, partialReasons: ['face_missing'], detailLines: ['лицо не фиксируется'] },
  });

  assert.equal(biofield.stability, 40);
  assert.equal(biofield.energy, 25);
  assert.equal(biofield.confidence.stability, 0);
  assert.equal(biofield.qualityFlags.partial, true);
  assert.equal(biofield.qualityFlags.scanConfidence, 0);
});

test('computeBiofieldFrame marks retained parameters when raw data is absent', () => {
  const biofield = computeBiofieldFrame({
    vitals: {
      hr: null,
      hrv: 40,
      sdnn: 55,
      pnn50: null,
      lfhf: null,
      stressIndex: null,
      breathingRate: null,
      coherence: null,
      hrSmoothed: null,
      hrDelta: null,
      signalQuality: 80,
    },
    voiceMetrics: baseVoice,
    vibraimageMetrics: baseVibra,
    emotions: { laughing: false, smiling: false, laughIntensity: 0, smileIntensity: 0 },
    baseline: null,
    facePresent: true,
    previousBiofield: {
      stability: 70,
      flow: 52,
      energy: 61,
      resonance: 59,
      vibration: 48,
      clarity: 64,
      integrity: 58,
      luminosity: 59,
      confidence: { stability: 1, flow: 1, energy: 1, resonance: 1, vibration: 1, clarity: 1, integrity: 1 },
      qualityFlags,
      trace: {},
    },
    qualityFlags: {
      ...qualityFlags,
      partial: true,
      partialReasons: ['pulse_acquiring'],
      detailLines: ['пульсовой сигнал собирается'],
      scanState: 'partial',
      parameterConfidenceCaps: {
        stability: 0.35,
        flow: 0.35,
        energy: 0.45,
        resonance: 0.35,
        vibration: 1,
        clarity: 1,
        integrity: 0.58,
      },
    },
  });

  assert.ok(biofield.qualityFlags.retainedParameters.includes('resonance'));
  assert.equal(biofield.qualityFlags.parameterStates.resonance, 'retained');
});

test('buildScanExport matches internal contract snapshot', () => {
  const exportData = buildScanExport({
    timestamp: '2026-03-12T10:00:00.000Z',
    statusMessage: 'HR: 72 bpm',
    biofield: {
      stability: 60,
      flow: 58,
      energy: 65,
      resonance: 62,
      vibration: 55,
      clarity: 68,
      integrity: 64,
      luminosity: 62,
      confidence: { stability: 1, flow: 1, energy: 1, resonance: 1, vibration: 1, clarity: 1, integrity: 1 },
      qualityFlags,
      trace: { stability: ['vitals.hrv'] },
    },
    vitals: baseVitals,
    voiceMetrics: baseVoice,
    vibraimageMetrics: baseVibra,
    emotions: { laughing: false, smiling: false, laughIntensity: 0, smileIntensity: 0 },
    statuses: { camera: 'ready', microphone: 'ready', face: 'tracking', pulse: 'ready', hdMode: 'off' },
    runtime: {
      trackerMode: 'fallback',
      simulationMode: 'fake-camera+fake-mic',
      scanState: 'full',
      scanConfidence: 100,
      partialReasons: [],
    },
    baseline: {
      hrMedian: 70,
      rmssdMedian: 50,
      amplitudeMedian: 40,
    },
    session: {
      startedAt: '2026-03-12T09:59:30.000Z',
      updatedAt: '2026-03-12T10:00:00.000Z',
      durationMs: 30000,
      sampleCount: 2,
      timelineLimit: 600,
      captureMode: 'simulation',
      trackerMode: 'fallback',
      simulationMode: 'fake-camera+fake-mic',
      hdMode: 'off',
      bufferFullness: 1,
      userAgent: 'Mozilla/5.0',
    },
    timeline: [
      {
        timestamp: '2026-03-12T09:59:45.000Z',
        elapsedMs: 15000,
        frameCount: 450,
        bufferFullness: 0.8,
        statusMessage: 'Калибровка пульса... 80%',
        statuses: { camera: 'ready', microphone: 'ready', face: 'tracking', pulse: 'acquiring', hdMode: 'off' },
        vitals: { ...baseVitals, hr: null, hrSmoothed: null, hrDelta: null },
        voiceMetrics: { ...baseVoice, pitch: null, jitter: null, shimmer: null, hnr: null, formants: null, voiceBioCenter: null },
        vibraimageMetrics: baseVibra,
        emotions: { laughing: false, smiling: false, laughIntensity: 0, smileIntensity: 0 },
        biofield: {
          stability: 20,
          flow: 18,
          energy: 24,
          resonance: null,
          vibration: 55,
          clarity: 68,
          integrity: 0,
          luminosity: 26,
          confidence: {
            stability: 0.35,
            flow: 0.35,
            energy: 0.45,
            resonance: 0.35,
            vibration: 1,
            clarity: 1,
            integrity: 0.58,
          },
        },
        quality: {
          scanState: 'partial',
          scanConfidence: 58,
          partialReasons: ['pulse_acquiring'],
          retainedParameters: [],
        },
      },
    ],
    signals: {
      rppg: {
        fps: 30,
        bufferSize: 256,
        bufferFullness: 1,
        rgb: {
          r: [101, 103, 104],
          g: [87, 89, 90],
          b: [74, 75, 76],
        },
        pulseSignal: [0.01, -0.02, 0.05],
      },
      vibraimage: {
        maxHistory: 128,
        frameCount: 96,
        diffHistory: [2.5, 2.7, 2.6],
        symmetryHistory: [0.08, 0.09],
        upperDiffHistory: [1.2, 1.4],
        lowerDiffHistory: [2.1, 2.3],
      },
    },
  });

  assert.deepEqual(Object.keys(exportData), [
    'exportSchema',
    'exportVersion',
    'timestamp',
    'statusMessage',
    'biofield',
    'vitals',
    'voiceMetrics',
    'vibraimageMetrics',
    'emotions',
    'statuses',
    'runtime',
    'baseline',
    'session',
    'timeline',
    'signals',
  ]);
  assert.equal(exportData.exportSchema, SCAN_EXPORT_SCHEMA);
  assert.equal(exportData.exportVersion, SCAN_EXPORT_VERSION);
  assert.equal(exportData.statusMessage, 'HR: 72 bpm');
  assert.equal(exportData.statuses.pulse, 'ready');
  assert.equal(exportData.runtime.simulationMode, 'fake-camera+fake-mic');
  assert.equal(exportData.session.sampleCount, 2);
  assert.equal(exportData.timeline[0].quality.scanState, 'partial');
  assert.equal(exportData.signals.rppg.rgb.r[1], 103);
  assert.equal(exportData.signals.vibraimage.diffHistory[0], 2.5);
  assert.equal(exportData.biofield.qualityFlags.summary, qualityFlags.summary);
  assert.equal(exportData.biofield.qualityFlags.scanConfidence, qualityFlags.scanConfidence);
});

test('buildScanExport clones session timeline and signal buffers', () => {
  const input = {
    timestamp: '2026-03-12T10:00:00.000Z',
    statusMessage: 'HR: 72 bpm',
    biofield: {
      stability: 60,
      flow: 58,
      energy: 65,
      resonance: 62,
      vibration: 55,
      clarity: 68,
      integrity: 64,
      luminosity: 62,
      confidence: { stability: 1, flow: 1, energy: 1, resonance: 1, vibration: 1, clarity: 1, integrity: 1 },
      qualityFlags,
      trace: { stability: ['vitals.hrv'] },
    },
    vitals: baseVitals,
    voiceMetrics: baseVoice,
    vibraimageMetrics: baseVibra,
    emotions: { laughing: false, smiling: false, laughIntensity: 0, smileIntensity: 0 },
    statuses: { camera: 'ready', microphone: 'ready', face: 'tracking', pulse: 'ready', hdMode: 'off' },
    runtime: {
      trackerMode: 'fallback',
      simulationMode: 'fake-camera+fake-mic',
      scanState: 'full',
      scanConfidence: 100,
      partialReasons: [],
    },
    session: {
      startedAt: '2026-03-12T09:59:30.000Z',
      updatedAt: '2026-03-12T10:00:00.000Z',
      durationMs: 30000,
      sampleCount: 1,
      timelineLimit: 600,
      captureMode: 'simulation',
      trackerMode: 'fallback',
      simulationMode: 'fake-camera+fake-mic',
      hdMode: 'off',
      bufferFullness: 1,
      userAgent: 'Mozilla/5.0',
    },
    timeline: [
      {
        timestamp: '2026-03-12T09:59:45.000Z',
        elapsedMs: 15000,
        frameCount: 450,
        bufferFullness: 0.8,
        statusMessage: 'Калибровка пульса... 80%',
        statuses: { camera: 'ready', microphone: 'ready', face: 'tracking', pulse: 'acquiring', hdMode: 'off' },
        vitals: baseVitals,
        voiceMetrics: baseVoice,
        vibraimageMetrics: baseVibra,
        emotions: { laughing: false, smiling: false, laughIntensity: 0, smileIntensity: 0 },
        biofield: {
          stability: 20,
          flow: 18,
          energy: 24,
          resonance: null,
          vibration: 55,
          clarity: 68,
          integrity: 0,
          luminosity: 26,
          confidence: {
            stability: 0.35,
            flow: 0.35,
            energy: 0.45,
            resonance: 0.35,
            vibration: 1,
            clarity: 1,
            integrity: 0.58,
          },
        },
        quality: {
          scanState: 'partial',
          scanConfidence: 58,
          partialReasons: ['pulse_acquiring'],
          retainedParameters: [],
        },
      },
    ],
    signals: {
      rppg: {
        fps: 30,
        bufferSize: 256,
        bufferFullness: 1,
        rgb: {
          r: [101, 103, 104],
          g: [87, 89, 90],
          b: [74, 75, 76],
        },
        pulseSignal: [0.01, -0.02, 0.05],
      },
      vibraimage: {
        maxHistory: 128,
        frameCount: 96,
        diffHistory: [2.5, 2.7, 2.6],
        symmetryHistory: [0.08, 0.09],
        upperDiffHistory: [1.2, 1.4],
        lowerDiffHistory: [2.1, 2.3],
      },
    },
  };

  const exportData = buildScanExport(input);

  input.timeline[0].statuses.camera = 'denied';
  input.timeline[0].biofield.confidence.stability = 0;
  input.signals.rppg.rgb.r[0] = 999;
  input.signals.vibraimage.diffHistory[0] = 999;

  assert.equal(exportData.timeline[0].statuses.camera, 'ready');
  assert.equal(exportData.timeline[0].biofield.confidence.stability, 0.35);
  assert.equal(exportData.signals.rppg.rgb.r[0], 101);
  assert.equal(exportData.signals.vibraimage.diffHistory[0], 2.5);
});
