import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import { buildScanExport } from '../scan-runtime.js';
import {
  buildRealSessionCoverage,
  deriveRealSessionFixtureMetadata,
  diffRealSessionFixtureReplay,
  formatRealSessionCoverageReport,
  formatRealSessionReplayReport,
  partitionRealSessionFixturesForReplay,
  REAL_SESSION_FIXTURE_DIR,
  loadRealSessionFixtures,
  REAL_SESSION_RECOMMENDED_SCENARIOS,
  REAL_SESSION_REVIEW_STATUSES,
  replayRealSessionFixture,
  summarizeRealSessionFixture,
  validateRealSessionFixture,
} from './fixtures/real-session-fixtures.js';

const baseVitals = {
  hr: 72,
  hrv: 52,
  sdnn: 66,
  pnn50: 16,
  lfhf: 1.5,
  stressIndex: 120,
  breathingRate: 12,
  coherence: 74,
  hrSmoothed: 71,
  hrDelta: 2,
  signalQuality: 88,
};

const baseVoice = {
  pitch: 181,
  jitter: 1.1,
  shimmer: 2,
  hnr: 17,
  rms: 0.07,
  spectralCentroid: 1760,
  formants: [530, 1460, 2490],
  voiceBioCenter: 4,
};

const baseVibra = {
  amplitude: 41,
  frequency: 31,
  symmetry: 84,
  entropy: 26,
  amplitudeLower: 27,
};

test('validateRealSessionFixture accepts current real-session export shape', () => {
  const exportData = buildScanExport({
    timestamp: '2026-03-12T18:00:00.000Z',
    statusMessage: 'HR: 72 bpm',
    biofield: {
      stability: 62,
      flow: 59,
      energy: 66,
      resonance: 63,
      vibration: 54,
      clarity: 68,
      integrity: 64,
      luminosity: 63,
      confidence: { stability: 1, flow: 1, energy: 1, resonance: 1, vibration: 1, clarity: 1, integrity: 1 },
    },
    vitals: baseVitals,
    voiceMetrics: baseVoice,
    vibraimageMetrics: baseVibra,
    emotions: { laughing: false, smiling: false, laughIntensity: 0, smileIntensity: 12 },
    statuses: { camera: 'ready', microphone: 'ready', face: 'tracking', pulse: 'ready', hdMode: 'off' },
    runtime: {
      trackerMode: 'native-face-detector',
      simulationMode: 'off',
      scanState: 'full',
      scanConfidence: 100,
      partialReasons: [],
    },
    session: {
      startedAt: '2026-03-12T17:59:42.000Z',
      updatedAt: '2026-03-12T18:00:00.000Z',
      durationMs: 18000,
      sampleCount: 2,
      timelineLimit: 600,
      captureMode: 'real',
      trackerMode: 'native-face-detector',
      simulationMode: 'off',
      hdMode: 'off',
      bufferFullness: 1,
      userAgent: 'Mozilla/5.0',
    },
    timeline: [
      {
        timestamp: '2026-03-12T17:59:50.000Z',
        elapsedMs: 8000,
        frameCount: 240,
        bufferFullness: 0.82,
        statusMessage: 'Калибровка пульса... 82%',
        statuses: { camera: 'ready', microphone: 'ready', face: 'tracking', pulse: 'acquiring', hdMode: 'off' },
        vitals: { ...baseVitals, hr: null, hrSmoothed: null, hrDelta: null, signalQuality: null },
        voiceMetrics: baseVoice,
        vibraimageMetrics: baseVibra,
        emotions: { laughing: false, smiling: false, laughIntensity: 0, smileIntensity: 8 },
        biofield: {
          stability: 28,
          flow: 24,
          energy: 31,
          resonance: null,
          vibration: 54,
          clarity: 68,
          integrity: 0,
          luminosity: 29,
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
      {
        timestamp: '2026-03-12T18:00:00.000Z',
        elapsedMs: 18000,
        frameCount: 540,
        bufferFullness: 1,
        statusMessage: 'HR: 72 bpm',
        statuses: { camera: 'ready', microphone: 'ready', face: 'tracking', pulse: 'ready', hdMode: 'off' },
        vitals: baseVitals,
        voiceMetrics: baseVoice,
        vibraimageMetrics: baseVibra,
        emotions: { laughing: false, smiling: false, laughIntensity: 0, smileIntensity: 12 },
        biofield: {
          stability: 62,
          flow: 59,
          energy: 66,
          resonance: 63,
          vibration: 54,
          clarity: 68,
          integrity: 64,
          luminosity: 63,
          confidence: {
            stability: 1,
            flow: 1,
            energy: 1,
            resonance: 1,
            vibration: 1,
            clarity: 1,
            integrity: 1,
          },
        },
        quality: {
          scanState: 'full',
          scanConfidence: 100,
          partialReasons: [],
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
          r: [101, 102, 103],
          g: [87, 88, 89],
          b: [74, 75, 76],
        },
        pulseSignal: [0.01, -0.02, 0.04],
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

  assert.doesNotThrow(() => validateRealSessionFixture(exportData, 'inline-real-session'));
  assert.equal(exportData.session.captureMode, 'real');
});

test('checked-in real-session fixtures pass validation', () => {
  const fixtures = loadRealSessionFixtures();

  assert.equal(existsSync(REAL_SESSION_FIXTURE_DIR), true);
  assert.ok(Array.isArray(fixtures));

  for (const fixture of fixtures) {
    assert.equal(fixture.data.session.captureMode, 'real');
    assert.equal(fixture.data.session.sampleCount, fixture.data.timeline.length);
    assert.ok(REAL_SESSION_REVIEW_STATUSES.includes(fixture.metadata.reviewStatus));
  }
});

test('real-session metadata derives default sidecar state from fixture data', () => {
  const fixture = createAlignedReplayFixture();
  const metadata = deriveRealSessionFixtureMetadata({
    fixtureName: fixture.name,
    fixtureData: fixture.data,
    importedAt: '2026-03-12T18:15:00.000Z',
  });

  assert.equal(metadata.name, fixture.name);
  assert.equal(metadata.importedAt, '2026-03-12T18:15:00.000Z');
  assert.equal(metadata.updatedAt, '2026-03-12T18:15:00.000Z');
  assert.equal(metadata.reviewStatus, 'pending');
  assert.ok(metadata.scenarioTags.includes('partial_quality'));
  assert.equal(metadata.captureContext.device, 'unknown');
  assert.equal(metadata.notes, '');
});

test('real-session metadata preserves manual review fields on reimport', () => {
  const fixture = createAlignedReplayFixture();
  const metadata = deriveRealSessionFixtureMetadata({
    fixtureName: fixture.name,
    fixtureData: fixture.data,
    importedAt: '2026-03-12T18:20:00.000Z',
    existingMetadata: {
      name: fixture.name,
      importedAt: '2026-03-12T18:16:00.000Z',
      updatedAt: '2026-03-12T18:17:00.000Z',
      reviewStatus: 'reviewed',
      scenarioTags: ['full_signal'],
      captureContext: {
        device: 'Pixel 8',
        lighting: 'office',
        environment: 'quiet',
        posture: 'seated',
      },
      notes: 'keep this fixture in the benchmark set',
    },
  });

  assert.equal(metadata.importedAt, '2026-03-12T18:16:00.000Z');
  assert.equal(metadata.updatedAt, '2026-03-12T18:20:00.000Z');
  assert.equal(metadata.reviewStatus, 'reviewed');
  assert.deepEqual(metadata.scenarioTags, ['full_signal']);
  assert.equal(metadata.captureContext.device, 'Pixel 8');
  assert.equal(metadata.notes, 'keep this fixture in the benchmark set');
});

test('real-session replay detects stored derived drift', () => {
  const fixture = {
    name: 'inline-real-session',
    data: validateRealSessionFixture(buildScanExport({
      timestamp: '2026-03-12T18:00:00.000Z',
      statusMessage: 'HR: 72 bpm',
      biofield: {
        stability: 62,
        flow: 59,
        energy: 66,
        resonance: 63,
        vibration: 54,
        clarity: 68,
        integrity: 64,
        luminosity: 63,
        confidence: { stability: 1, flow: 1, energy: 1, resonance: 1, vibration: 1, clarity: 1, integrity: 1 },
      },
      vitals: baseVitals,
      voiceMetrics: baseVoice,
      vibraimageMetrics: baseVibra,
      emotions: { laughing: false, smiling: false, laughIntensity: 0, smileIntensity: 12 },
      statuses: { camera: 'ready', microphone: 'ready', face: 'tracking', pulse: 'ready', hdMode: 'off' },
      runtime: {
        trackerMode: 'native-face-detector',
        simulationMode: 'off',
        scanState: 'full',
        scanConfidence: 100,
        partialReasons: [],
      },
      session: {
        startedAt: '2026-03-12T17:59:42.000Z',
        updatedAt: '2026-03-12T18:00:00.000Z',
        durationMs: 18000,
        sampleCount: 2,
        timelineLimit: 600,
        captureMode: 'real',
        trackerMode: 'native-face-detector',
        simulationMode: 'off',
        hdMode: 'off',
        bufferFullness: 1,
        userAgent: 'Mozilla/5.0',
      },
      timeline: [
        {
          timestamp: '2026-03-12T17:59:50.000Z',
          elapsedMs: 8000,
          frameCount: 240,
          bufferFullness: 0.82,
          statusMessage: 'Калибровка пульса... 82%',
          statuses: { camera: 'ready', microphone: 'ready', face: 'tracking', pulse: 'acquiring', hdMode: 'off' },
          vitals: { ...baseVitals, hr: null, hrSmoothed: null, hrDelta: null, signalQuality: null },
          voiceMetrics: baseVoice,
          vibraimageMetrics: baseVibra,
          emotions: { laughing: false, smiling: false, laughIntensity: 0, smileIntensity: 8 },
          biofield: {
            stability: 28,
            flow: 24,
            energy: 31,
            resonance: null,
            vibration: 54,
            clarity: 68,
            integrity: 0,
            luminosity: 29,
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
        {
          timestamp: '2026-03-12T18:00:00.000Z',
          elapsedMs: 18000,
          frameCount: 540,
          bufferFullness: 1,
          statusMessage: 'HR: 72 bpm',
          statuses: { camera: 'ready', microphone: 'ready', face: 'tracking', pulse: 'ready', hdMode: 'off' },
          vitals: baseVitals,
          voiceMetrics: baseVoice,
          vibraimageMetrics: baseVibra,
          emotions: { laughing: false, smiling: false, laughIntensity: 0, smileIntensity: 12 },
          biofield: {
            stability: 62,
            flow: 59,
            energy: 66,
            resonance: 63,
            vibration: 54,
            clarity: 68,
            integrity: 64,
            luminosity: 63,
            confidence: {
              stability: 1,
              flow: 1,
              energy: 1,
              resonance: 1,
              vibration: 1,
              clarity: 1,
              integrity: 1,
            },
          },
          quality: {
            scanState: 'full',
            scanConfidence: 100,
            partialReasons: [],
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
            r: [101, 102, 103],
            g: [87, 88, 89],
            b: [74, 75, 76],
          },
          pulseSignal: [0.01, -0.02, 0.04],
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
    }), 'inline-real-session'),
  };

  const replay = replayRealSessionFixture(fixture);
  const diff = diffRealSessionFixtureReplay(fixture);
  const report = formatRealSessionReplayReport([diff]);

  assert.equal(replay.final.statusMessage, 'HR: 72 bpm');
  assert.equal(replay.final.quality.scanState, 'full');
  assert.ok(diff.mismatchCount > 0);
  assert.match(report, /inline-real-session/);
  assert.match(report, /mismatch/);
});

test('real-session summary derives scenario coverage from timeline', () => {
  const fixture = {
    name: 'face-loss-partial',
    data: validateRealSessionFixture(buildScanExport({
      timestamp: '2026-03-12T18:05:00.000Z',
      statusMessage: 'Лицо потеряно — результат частичный',
      biofield: {
        stability: 40,
        flow: 30,
        energy: 28,
        resonance: 20,
        vibration: 16,
        clarity: 18,
        integrity: 22,
        luminosity: 25,
        confidence: { stability: 0, flow: 0, energy: 0, resonance: 0, vibration: 0, clarity: 0, integrity: 0 },
      },
      vitals: baseVitals,
      voiceMetrics: { ...baseVoice, rms: null },
      vibraimageMetrics: baseVibra,
      emotions: { laughing: false, smiling: false, laughIntensity: 0, smileIntensity: 0 },
      statuses: { camera: 'ready', microphone: 'denied', face: 'lost', pulse: 'weak', hdMode: 'active' },
      runtime: {
        trackerMode: 'fallback',
        simulationMode: 'off',
        scanState: 'partial',
        scanConfidence: 42,
        partialReasons: ['face_missing', 'microphone_unavailable', 'pulse_weak'],
      },
      session: {
        startedAt: '2026-03-12T18:04:30.000Z',
        updatedAt: '2026-03-12T18:05:00.000Z',
        durationMs: 30000,
        sampleCount: 2,
        timelineLimit: 600,
        captureMode: 'real',
        trackerMode: 'fallback',
        simulationMode: 'off',
        hdMode: 'active',
        bufferFullness: 0.76,
        userAgent: 'Mozilla/5.0',
      },
      timeline: [
        {
          timestamp: '2026-03-12T18:04:45.000Z',
          elapsedMs: 15000,
          frameCount: 450,
          bufferFullness: 0.78,
          statusMessage: 'Пульсовой сигнал слабый',
          statuses: { camera: 'ready', microphone: 'denied', face: 'tracking', pulse: 'weak', hdMode: 'active' },
          vitals: baseVitals,
          voiceMetrics: { ...baseVoice, rms: null },
          vibraimageMetrics: baseVibra,
          emotions: { laughing: false, smiling: false, laughIntensity: 0, smileIntensity: 0 },
          biofield: {
            stability: 25,
            flow: 23,
            energy: 26,
            resonance: 20,
            vibration: 18,
            clarity: 21,
            integrity: 19,
            luminosity: 22,
            confidence: {
              stability: 0.4,
              flow: 0.4,
              energy: 0.45,
              resonance: 0.4,
              vibration: 0.55,
              clarity: 0.55,
              integrity: 0.4,
            },
          },
          quality: {
            scanState: 'partial',
            scanConfidence: 48,
            partialReasons: ['microphone_unavailable', 'pulse_weak'],
            retainedParameters: [],
          },
        },
        {
          timestamp: '2026-03-12T18:05:00.000Z',
          elapsedMs: 30000,
          frameCount: 900,
          bufferFullness: 0.76,
          statusMessage: 'Лицо потеряно — результат частичный',
          statuses: { camera: 'ready', microphone: 'denied', face: 'lost', pulse: 'weak', hdMode: 'active' },
          vitals: baseVitals,
          voiceMetrics: { ...baseVoice, rms: null },
          vibraimageMetrics: baseVibra,
          emotions: { laughing: false, smiling: false, laughIntensity: 0, smileIntensity: 0 },
          biofield: {
            stability: 40,
            flow: 30,
            energy: 28,
            resonance: 20,
            vibration: 16,
            clarity: 18,
            integrity: 22,
            luminosity: 25,
            confidence: {
              stability: 0,
              flow: 0,
              energy: 0,
              resonance: 0,
              vibration: 0,
              clarity: 0,
              integrity: 0,
            },
          },
          quality: {
            scanState: 'partial',
            scanConfidence: 42,
            partialReasons: ['face_missing', 'microphone_unavailable', 'pulse_weak'],
            retainedParameters: ['stability'],
          },
        },
      ],
      signals: {
        rppg: {
          fps: 30,
          bufferSize: 256,
          bufferFullness: 0.76,
          rgb: {
            r: [101, 100, 99],
            g: [87, 86, 85],
            b: [74, 73, 72],
          },
          pulseSignal: [0.01, -0.01, 0.02],
        },
        vibraimage: {
          maxHistory: 128,
          frameCount: 60,
          diffHistory: [2.5, 2.6],
          symmetryHistory: [0.08, 0.07],
          upperDiffHistory: [1.2, 1.1],
          lowerDiffHistory: [2.1, 2.0],
        },
      },
    }), 'face-loss-partial'),
  };

  const summary = summarizeRealSessionFixture(fixture);

  assert.equal(summary.voiceActiveSamples, 0);
  assert.equal(summary.partialSamples, 2);
  assert.equal(summary.faceLostSamples, 1);
  assert.equal(summary.microphoneDeniedSamples, 2);
  assert.equal(summary.pulseWeakSamples, 2);
  assert.equal(summary.hdActiveSamples, 2);
  assert.equal(summary.retainedSamples, 1);
  assert.equal(summary.scenarioFlags.silent_mode, true);
  assert.equal(summary.scenarioFlags.face_loss, true);
  assert.equal(summary.scenarioFlags.microphone_denied, true);
  assert.equal(summary.scenarioFlags.pulse_weak, true);
  assert.equal(summary.scenarioFlags.hd_mode, true);
  assert.equal(summary.scenarioFlags.full_signal, false);
});

test('real-session coverage report exposes missing recommended scenarios', () => {
  const coverage = buildRealSessionCoverage([]);
  const report = formatRealSessionCoverageReport(coverage);

  assert.equal(coverage.fixtureCount, 0);
  assert.equal(coverage.metadataSidecarCount, 0);
  assert.deepEqual(coverage.fixturesWithoutMetadata, []);
  assert.deepEqual(coverage.coveredScenarioKeys, []);
  assert.deepEqual(coverage.declaredScenarioKeys, []);
  assert.deepEqual(coverage.missingScenarioKeys, REAL_SESSION_RECOMMENDED_SCENARIOS);
  assert.deepEqual(coverage.missingDeclaredScenarioKeys, REAL_SESSION_RECOMMENDED_SCENARIOS);
  assert.match(report, /Fixtures: 0/);
  assert.match(report, /Metadata sidecars: 0\/0/);
  assert.match(report, /Review statuses: none/);
  assert.match(report, /Missing scenarios:/);
});

test('real-session strict replay gating skips pending fixtures', () => {
  const reviewedFixture = withFixtureReviewStatus(createAlignedReplayFixture(), {
    reviewStatus: 'reviewed',
    scenarioTags: ['full_signal'],
  });
  const pendingFixture = withFixtureReviewStatus(
    createDriftedReplayFixture('pending-drift-fixture'),
    {
      reviewStatus: 'pending',
      scenarioTags: ['partial_quality'],
    },
  );
  const replaySelection = partitionRealSessionFixturesForReplay([reviewedFixture, pendingFixture]);
  const results = replaySelection.replayFixtures.map((fixture) => diffRealSessionFixtureReplay(fixture));
  const report = formatRealSessionReplayReport(results, replaySelection);
  const coverage = buildRealSessionCoverage([reviewedFixture, pendingFixture]);

  assert.equal(replaySelection.replayFixtures.length, 1);
  assert.equal(replaySelection.replayFixtures[0].name, reviewedFixture.name);
  assert.deepEqual(replaySelection.skippedFixtures.map((fixture) => fixture.name), [pendingFixture.name]);
  assert.equal(results[0].mismatchCount, 0);
  assert.match(report, /Review filter: reviewed/);
  assert.match(report, /Skipped fixtures: pending-drift-fixture \(pending\)/);
  assert.equal(coverage.fixtureCount, 2);
  assert.equal(coverage.reviewStatuses.reviewed, 1);
  assert.equal(coverage.reviewStatuses.pending, 1);
});

test('checked-in reviewed real-session fixtures replay without drift', () => {
  const fixtures = loadRealSessionFixtures();
  const replaySelection = partitionRealSessionFixturesForReplay(fixtures);
  const results = replaySelection.replayFixtures.map((fixture) => diffRealSessionFixtureReplay(fixture));
  const report = formatRealSessionReplayReport(results, replaySelection);

  if (replaySelection.replayFixtures.length === 0 && replaySelection.skippedFixtures.length > 0) {
    assert.match(report, /Skipped fixtures:/);
  }

  for (const result of results) {
    assert.equal(result.mismatchCount, 0, report);
  }
});

test('real-session replay round-trips an aligned fixture', () => {
  const fixture = createAlignedReplayFixture();
  const diff = diffRealSessionFixtureReplay(fixture);

  assert.equal(diff.mismatchCount, 0);
  assert.deepEqual(diff.mismatches, []);
});

test('real-session coverage tracks metadata sidecars and declared scenarios', () => {
  const fixture = createAlignedReplayFixture();
  fixture.hasMetadataSidecar = true;
  fixture.metadataPath = 'aligned-replay-fixture.meta.json';
  fixture.metadata = deriveRealSessionFixtureMetadata({
    fixtureName: fixture.name,
    fixtureData: fixture.data,
    importedAt: '2026-03-12T18:25:00.000Z',
    existingMetadata: {
      name: fixture.name,
      importedAt: '2026-03-12T18:24:00.000Z',
      updatedAt: '2026-03-12T18:24:00.000Z',
      reviewStatus: 'reviewed',
      scenarioTags: ['full_signal'],
      captureContext: {
        device: 'MacBook Pro',
        lighting: 'daylight',
        environment: 'office',
        posture: 'seated',
      },
      notes: 'manually reviewed',
    },
  });

  const coverage = buildRealSessionCoverage([fixture]);
  const report = formatRealSessionCoverageReport(coverage);

  assert.equal(coverage.fixtureCount, 1);
  assert.equal(coverage.metadataSidecarCount, 1);
  assert.deepEqual(coverage.fixturesWithoutMetadata, []);
  assert.equal(coverage.reviewStatuses.reviewed, 1);
  assert.deepEqual(coverage.declaredScenarioKeys, ['full_signal']);
  assert.match(report, /Declared scenarios: full_signal/);
  assert.match(report, /review=reviewed/);
});

function createAlignedReplayFixture() {
  const draft = {
    name: 'aligned-replay-fixture',
    data: validateRealSessionFixture(buildScanExport({
      timestamp: '2026-03-12T18:10:00.000Z',
      statusMessage: 'placeholder',
      biofield: {
        stability: 0,
        flow: 0,
        energy: 0,
        resonance: 0,
        vibration: 0,
        clarity: 0,
        integrity: 0,
        luminosity: 0,
        confidence: { stability: 0, flow: 0, energy: 0, resonance: 0, vibration: 0, clarity: 0, integrity: 0 },
      },
      vitals: baseVitals,
      voiceMetrics: baseVoice,
      vibraimageMetrics: baseVibra,
      emotions: { laughing: false, smiling: false, laughIntensity: 0, smileIntensity: 10 },
      statuses: { camera: 'ready', microphone: 'ready', face: 'tracking', pulse: 'ready', hdMode: 'off' },
      runtime: {
        trackerMode: 'fallback',
        simulationMode: 'off',
        scanState: 'placeholder',
        scanConfidence: 0,
        partialReasons: [],
      },
      baseline: { hrMedian: 70, rmssdMedian: 50, amplitudeMedian: 40 },
      session: {
        startedAt: '2026-03-12T18:09:42.000Z',
        updatedAt: '2026-03-12T18:10:00.000Z',
        durationMs: 18000,
        sampleCount: 2,
        timelineLimit: 600,
        captureMode: 'real',
        trackerMode: 'fallback',
        simulationMode: 'off',
        hdMode: 'off',
        bufferFullness: 1,
        userAgent: 'Mozilla/5.0',
      },
      timeline: [
        {
          timestamp: '2026-03-12T18:09:48.000Z',
          elapsedMs: 6000,
          frameCount: 180,
          bufferFullness: 0.5,
          statusMessage: 'placeholder',
          statuses: { camera: 'ready', microphone: 'ready', face: 'tracking', pulse: 'acquiring', hdMode: 'off' },
          vitals: { ...baseVitals, hr: null, hrSmoothed: null, hrDelta: null, signalQuality: null },
          voiceMetrics: baseVoice,
          vibraimageMetrics: baseVibra,
          emotions: { laughing: false, smiling: false, laughIntensity: 0, smileIntensity: 5 },
          biofield: {
            stability: 0,
            flow: 0,
            energy: 0,
            resonance: 0,
            vibration: 0,
            clarity: 0,
            integrity: 0,
            luminosity: 0,
            confidence: { stability: 0, flow: 0, energy: 0, resonance: 0, vibration: 0, clarity: 0, integrity: 0 },
          },
          quality: {
            scanState: 'placeholder',
            scanConfidence: 0,
            partialReasons: [],
            retainedParameters: [],
          },
        },
        {
          timestamp: '2026-03-12T18:10:00.000Z',
          elapsedMs: 18000,
          frameCount: 540,
          bufferFullness: 1,
          statusMessage: 'placeholder',
          statuses: { camera: 'ready', microphone: 'ready', face: 'tracking', pulse: 'ready', hdMode: 'off' },
          vitals: baseVitals,
          voiceMetrics: baseVoice,
          vibraimageMetrics: baseVibra,
          emotions: { laughing: false, smiling: false, laughIntensity: 0, smileIntensity: 10 },
          biofield: {
            stability: 0,
            flow: 0,
            energy: 0,
            resonance: 0,
            vibration: 0,
            clarity: 0,
            integrity: 0,
            luminosity: 0,
            confidence: { stability: 0, flow: 0, energy: 0, resonance: 0, vibration: 0, clarity: 0, integrity: 0 },
          },
          quality: {
            scanState: 'placeholder',
            scanConfidence: 0,
            partialReasons: [],
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
            r: [101, 102, 103],
            g: [87, 88, 89],
            b: [74, 75, 76],
          },
          pulseSignal: [0.01, -0.02, 0.04],
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
    }), 'aligned-replay-fixture'),
  };

  const replay = replayRealSessionFixture(draft);
  const alignedData = structuredClone(draft.data);

  alignedData.statusMessage = replay.final.statusMessage;
  alignedData.biofield = replay.final.biofield;
  alignedData.runtime = {
    ...alignedData.runtime,
    scanState: replay.final.quality.scanState,
    scanConfidence: replay.final.quality.scanConfidence,
    partialReasons: [...replay.final.quality.partialReasons],
  };
  alignedData.timeline = alignedData.timeline.map((entry, index) => ({
    ...entry,
    statusMessage: replay.timeline[index].statusMessage,
    biofield: replay.timeline[index].biofield,
    quality: replay.timeline[index].quality,
  }));

  return {
    name: draft.name,
    data: validateRealSessionFixture(alignedData, draft.name),
  };
}

function createDriftedReplayFixture(name = 'drifted-replay-fixture') {
  const fixture = createAlignedReplayFixture();
  const driftedData = structuredClone(fixture.data);

  driftedData.statusMessage = 'Drifted final status';
  driftedData.timeline[0].statusMessage = 'Drifted sample status';

  return {
    name,
    data: validateRealSessionFixture(driftedData, name),
  };
}

function withFixtureReviewStatus(
  fixture,
  {
    reviewStatus = 'pending',
    scenarioTags = ['partial_quality'],
    importedAt = '2026-03-12T18:25:00.000Z',
    updatedAt = importedAt,
  } = {},
) {
  return {
    ...fixture,
    hasMetadataSidecar: true,
    metadataPath: `${fixture.name}.meta.json`,
    metadata: deriveRealSessionFixtureMetadata({
      fixtureName: fixture.name,
      fixtureData: fixture.data,
      importedAt: updatedAt,
      existingMetadata: {
        name: fixture.name,
        importedAt,
        updatedAt,
        reviewStatus,
        scenarioTags,
        captureContext: {
          device: 'Test rig',
          lighting: 'controlled',
          environment: 'lab',
          posture: 'seated',
        },
        notes: '',
      },
    }),
  };
}
