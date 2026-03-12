import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveQualityFlags, deriveSensorStatus, deriveStatusMessage } from '../scan-quality.js';
import { buildScanExport, computeBiofieldFrame } from '../scan-runtime.js';
import {
  REGRESSION_TIMESTAMP,
  scanRegressionFixtures,
} from './fixtures/scan-regression-fixtures.js';

for (const fixture of scanRegressionFixtures) {
  test(`scan regression fixture: ${fixture.name}`, () => {
    const snapshot = createRegressionSnapshot(fixture.input);
    assert.deepEqual(snapshot, fixture.expected);
  });
}

function createRegressionSnapshot(input) {
  const statuses = deriveSensorStatus(input.sensorInput);
  const qualityFlags = deriveQualityFlags(statuses);
  const biofield = computeBiofieldFrame({
    vitals: input.vitals,
    voiceMetrics: input.voiceMetrics,
    vibraimageMetrics: input.vibraimageMetrics,
    emotions: input.emotions,
    baseline: input.baseline,
    facePresent: input.facePresent,
    previousBiofield: input.previousBiofield,
    qualityFlags,
  });
  const statusMessage = deriveStatusMessage(statuses, {
    hr: input.vitals.hr,
    bufferFullness: input.sensorInput.bufferFullness,
  });
  const exportData = buildScanExport({
    timestamp: REGRESSION_TIMESTAMP,
    biofield,
    vitals: input.vitals,
    voiceMetrics: input.voiceMetrics,
    vibraimageMetrics: input.vibraimageMetrics,
    emotions: input.emotions,
    statuses,
    runtime: {
      ...input.runtime,
      scanState: biofield.qualityFlags.scanState,
      scanConfidence: biofield.qualityFlags.scanConfidence,
      partialReasons: [...biofield.qualityFlags.partialReasons],
    },
  });

  return normalizeSnapshot({
    statuses,
    statusMessage,
    biofield: {
      stability: biofield.stability,
      flow: biofield.flow,
      energy: biofield.energy,
      resonance: biofield.resonance,
      vibration: biofield.vibration,
      clarity: biofield.clarity,
      integrity: biofield.integrity,
      luminosity: biofield.luminosity,
      confidence: biofield.confidence,
      trace: biofield.trace,
    },
    quality: {
      scanState: biofield.qualityFlags.scanState,
      scanConfidence: biofield.qualityFlags.scanConfidence,
      partialReasons: biofield.qualityFlags.partialReasons,
      retainedParameters: biofield.qualityFlags.retainedParameters,
      parameterStates: biofield.qualityFlags.parameterStates,
      summary: biofield.qualityFlags.summary,
    },
    export: {
      statuses: exportData.statuses,
      runtime: exportData.runtime,
      luminosity: exportData.biofield.luminosity,
    },
  });
}

function normalizeSnapshot(value) {
  if (typeof value === 'number' && !Number.isInteger(value)) {
    return Number(value.toFixed(4));
  }
  if (Array.isArray(value)) {
    return value.map(normalizeSnapshot);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeSnapshot(item)]),
    );
  }
  return value;
}
