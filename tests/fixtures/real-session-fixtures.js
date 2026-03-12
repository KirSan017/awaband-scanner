import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveQualityFlags, deriveStatusMessage } from '../../scan-quality.js';
import { computeBiofieldFrame, SCAN_EXPORT_SCHEMA, SCAN_EXPORT_VERSION } from '../../scan-runtime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const REAL_SESSION_FIXTURE_DIR = path.join(__dirname, 'real-sessions');
export const REAL_SESSION_RECOMMENDED_SCENARIOS = Object.freeze([
  'full_signal',
  'partial_quality',
  'silent_mode',
  'face_loss',
  'microphone_denied',
  'pulse_weak',
  'hd_mode',
]);
export const REAL_SESSION_REVIEW_STATUSES = Object.freeze([
  'pending',
  'reviewed',
]);
const REPLAY_BIOFIELD_KEYS = Object.freeze([
  'stability',
  'flow',
  'energy',
  'resonance',
  'vibration',
  'clarity',
  'integrity',
  'luminosity',
]);
const DEFAULT_CAPTURE_CONTEXT = Object.freeze({
  device: 'unknown',
  lighting: 'unknown',
  environment: 'unknown',
  posture: 'unknown',
});

export function ensureRealSessionFixtureDir() {
  if (!existsSync(REAL_SESSION_FIXTURE_DIR)) {
    mkdirSync(REAL_SESSION_FIXTURE_DIR, { recursive: true });
  }
  return REAL_SESSION_FIXTURE_DIR;
}

export function sanitizeFixtureName(name) {
  const normalized = `${name || ''}`.trim().toLowerCase().replace(/_/g, '-');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)) {
    throw new Error(
      `Fixture name "${name}" must be kebab-case and contain only latin letters, numbers and hyphens.`,
    );
  }
  return normalized;
}

export function getRealSessionMetadataPath(filePath) {
  const parsedPath = path.parse(filePath);
  return path.join(parsedPath.dir, `${parsedPath.name}.meta.json`);
}

export function readRealSessionFixture(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  const name = path.basename(filePath, path.extname(filePath));
  const metadataPath = getRealSessionMetadataPath(filePath);
  const fixtureData = validateRealSessionFixture(parsed, name);
  const hasMetadataSidecar = existsSync(metadataPath);
  const metadata = hasMetadataSidecar
    ? validateRealSessionFixtureMetadata(JSON.parse(readFileSync(metadataPath, 'utf8')), {
        fixtureName: name,
      })
    : deriveRealSessionFixtureMetadata({
        fixtureName: name,
        fixtureData,
      });

  return {
    name,
    filePath,
    metadataPath,
    hasMetadataSidecar,
    metadata,
    data: fixtureData,
  };
}

export function loadRealSessionFixtures(dir = REAL_SESSION_FIXTURE_DIR) {
  ensureRealSessionFixtureDir();
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && !entry.name.endsWith('.meta.json'))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => readRealSessionFixture(path.join(dir, entry.name)));
}

export function validateRealSessionFixture(exportData, fixtureName = 'fixture') {
  const prefix = `Real-session fixture "${fixtureName}"`;

  assertPlainObject(exportData, `${prefix} must be an object.`);
  assert(
    exportData.exportSchema === SCAN_EXPORT_SCHEMA,
    `${prefix} must use exportSchema "${SCAN_EXPORT_SCHEMA}".`,
  );
  assert(
    exportData.exportVersion === SCAN_EXPORT_VERSION,
    `${prefix} must use exportVersion ${SCAN_EXPORT_VERSION}.`,
  );
  assertIsoDate(exportData.timestamp, `${prefix} must have a valid top-level timestamp.`);
  assertPlainObject(exportData.statuses, `${prefix} must contain top-level statuses.`);
  assertPlainObject(exportData.runtime, `${prefix} must contain runtime metadata.`);
  assertPlainObject(exportData.biofield, `${prefix} must contain a biofield snapshot.`);
  assertPlainObject(exportData.session, `${prefix} must contain session metadata.`);
  assert(Array.isArray(exportData.timeline), `${prefix} must contain a timeline array.`);
  assertPlainObject(exportData.signals, `${prefix} must contain a signals object.`);
  assert(
    exportData.session.captureMode === 'real',
    `${prefix} must have session.captureMode = "real".`,
  );

  assertIsoDate(
    exportData.session.startedAt,
    `${prefix} must contain session.startedAt as an ISO timestamp.`,
  );
  assertIsoDate(
    exportData.session.updatedAt,
    `${prefix} must contain session.updatedAt as an ISO timestamp.`,
  );
  assert(
    Date.parse(exportData.session.updatedAt) >= Date.parse(exportData.session.startedAt),
    `${prefix} must not update before it starts.`,
  );
  assertNonNegativeInteger(
    exportData.session.sampleCount,
    `${prefix} must contain a non-negative integer session.sampleCount.`,
  );
  assert(
    exportData.session.sampleCount > 0,
    `${prefix} must contain at least one timeline sample.`,
  );
  assert(
    exportData.session.sampleCount === exportData.timeline.length,
    `${prefix} session.sampleCount must match timeline length.`,
  );
  assertNonNegativeInteger(
    exportData.session.timelineLimit,
    `${prefix} must contain a non-negative integer session.timelineLimit.`,
  );
  assert(
    exportData.timeline.length <= exportData.session.timelineLimit,
    `${prefix} timeline length must not exceed session.timelineLimit.`,
  );
  assertNonNegativeNumber(
    exportData.session.durationMs,
    `${prefix} must contain a non-negative session.durationMs.`,
  );
  assertBufferFullness(
    exportData.session.bufferFullness,
    `${prefix} session.bufferFullness must stay within [0, 1].`,
  );

  validateTimeline(exportData.timeline, exportData.session.updatedAt, prefix);
  validateSignals(exportData.signals, prefix);

  return exportData;
}

export function validateRealSessionFixtureMetadata(metadata, { fixtureName = 'fixture' } = {}) {
  const prefix = `Real-session fixture metadata "${fixtureName}"`;

  assertPlainObject(metadata, `${prefix} must be an object.`);
  assert(
    metadata.name === fixtureName,
    `${prefix} must use the same fixture name as the JSON export.`,
  );
  assertIsoDate(metadata.importedAt, `${prefix} must contain importedAt as an ISO timestamp.`);
  assertIsoDate(metadata.updatedAt, `${prefix} must contain updatedAt as an ISO timestamp.`);
  assert(
    Date.parse(metadata.updatedAt) >= Date.parse(metadata.importedAt),
    `${prefix} must not update before it is imported.`,
  );
  assert(
    REAL_SESSION_REVIEW_STATUSES.includes(metadata.reviewStatus),
    `${prefix} reviewStatus must be one of: ${REAL_SESSION_REVIEW_STATUSES.join(', ')}.`,
  );
  assert(
    Array.isArray(metadata.scenarioTags),
    `${prefix} scenarioTags must be an array.`,
  );
  assert(
    metadata.scenarioTags.every((tag) => REAL_SESSION_RECOMMENDED_SCENARIOS.includes(tag)),
    `${prefix} scenarioTags must use only known scenario ids.`,
  );
  assertPlainObject(metadata.captureContext, `${prefix} captureContext must be an object.`);
  for (const key of Object.keys(DEFAULT_CAPTURE_CONTEXT)) {
    assert(
      typeof metadata.captureContext[key] === 'string',
      `${prefix} captureContext.${key} must be a string.`,
    );
  }
  assert(
    typeof metadata.notes === 'string',
    `${prefix} notes must be a string.`,
  );

  return {
    name: fixtureName,
    importedAt: new Date(metadata.importedAt).toISOString(),
    updatedAt: new Date(metadata.updatedAt).toISOString(),
    reviewStatus: metadata.reviewStatus,
    scenarioTags: normalizeScenarioTags(metadata.scenarioTags),
    captureContext: {
      ...DEFAULT_CAPTURE_CONTEXT,
      ...metadata.captureContext,
    },
    notes: metadata.notes,
  };
}

export function deriveRealSessionFixtureMetadata({
  fixtureName = 'fixture',
  fixtureData,
  existingMetadata = null,
  importedAt = null,
} = {}) {
  assertPlainObject(fixtureData, `Real-session fixture "${fixtureName}" metadata requires fixture data.`);

  const scenarioFlags = deriveRealSessionScenarioFlags(fixtureData);
  const derivedScenarioTags = REAL_SESSION_RECOMMENDED_SCENARIOS.filter((key) => scenarioFlags[key]);
  const importedTimestamp = new Date(
    existingMetadata?.importedAt || importedAt || fixtureData.session?.updatedAt || fixtureData.timestamp,
  ).toISOString();
  const updatedTimestamp = new Date(
    importedAt || fixtureData.session?.updatedAt || fixtureData.timestamp,
  ).toISOString();

  return validateRealSessionFixtureMetadata({
    name: fixtureName,
    importedAt: importedTimestamp,
    updatedAt: updatedTimestamp,
    reviewStatus: existingMetadata?.reviewStatus || 'pending',
    scenarioTags: existingMetadata?.scenarioTags?.length
      ? existingMetadata.scenarioTags
      : derivedScenarioTags,
    captureContext: {
      ...DEFAULT_CAPTURE_CONTEXT,
      ...(existingMetadata?.captureContext || {}),
    },
    notes: existingMetadata?.notes || '',
  }, { fixtureName });
}

export function summarizeRealSessionFixture(fixture) {
  const normalizedFixture = normalizeFixtureInput(fixture);
  const { name, data, metadata } = normalizedFixture;
  const timeline = data.timeline;
  const qualityValues = timeline.map((entry) => entry.quality.scanConfidence);
  const bufferValues = timeline.map((entry) => entry.bufferFullness);
  const scenarioFlags = deriveRealSessionScenarioFlags(data);
  const voiceActiveSamples = timeline.filter((entry) => (entry.voiceMetrics?.rms ?? 0) > 0.02).length;
  const faceLostSamples = timeline.filter((entry) => entry.statuses.face === 'lost').length;
  const microphoneDeniedSamples = timeline.filter((entry) => entry.statuses.microphone === 'denied').length;
  const pulseWeakSamples = timeline.filter((entry) => entry.statuses.pulse === 'weak').length;
  const hdActiveSamples = timeline.filter((entry) => entry.statuses.hdMode === 'active').length;
  const partialSamples = timeline.filter((entry) => entry.quality.scanState !== 'full').length;
  const retainedSamples = timeline.filter((entry) => (entry.quality.retainedParameters || []).length > 0).length;

  return {
    name,
    filePath: normalizedFixture.filePath || null,
    metadataPath: normalizedFixture.metadataPath || null,
    hasMetadataSidecar: Boolean(normalizedFixture.hasMetadataSidecar),
    reviewStatus: metadata.reviewStatus,
    declaredScenarios: [...metadata.scenarioTags],
    durationMs: data.session.durationMs,
    sampleCount: data.session.sampleCount,
    trackerMode: data.session.trackerMode || data.runtime.trackerMode || 'unknown',
    finalScanState: data.runtime.scanState,
    finalScanConfidence: data.runtime.scanConfidence,
    avgScanConfidence: roundTo(average(qualityValues)),
    minScanConfidence: Math.min(...qualityValues),
    avgBufferFullness: roundTo(average(bufferValues)),
    voiceActiveSamples,
    faceLostSamples,
    microphoneDeniedSamples,
    pulseWeakSamples,
    hdActiveSamples,
    partialSamples,
    retainedSamples,
    scenarioFlags,
    coveredScenarios: REAL_SESSION_RECOMMENDED_SCENARIOS.filter((key) => scenarioFlags[key]),
  };
}

export function buildRealSessionCoverage(fixtures = []) {
  const summaries = fixtures.map((fixture) => summarizeRealSessionFixture(fixture));
  const coveredScenarioKeys = REAL_SESSION_RECOMMENDED_SCENARIOS.filter((scenario) => (
    summaries.some((summary) => summary.scenarioFlags[scenario])
  ));
  const declaredScenarioKeys = REAL_SESSION_RECOMMENDED_SCENARIOS.filter((scenario) => (
    summaries.some((summary) => summary.declaredScenarios.includes(scenario))
  ));

  return {
    fixtureCount: summaries.length,
    metadataSidecarCount: summaries.filter((summary) => summary.hasMetadataSidecar).length,
    fixturesWithoutMetadata: summaries
      .filter((summary) => !summary.hasMetadataSidecar)
      .map((summary) => summary.name),
    totalDurationMs: summaries.reduce((sum, summary) => sum + summary.durationMs, 0),
    totalSamples: summaries.reduce((sum, summary) => sum + summary.sampleCount, 0),
    trackerModes: countBy(summaries, (summary) => summary.trackerMode),
    reviewStatuses: countBy(summaries, (summary) => summary.reviewStatus),
    finalScanStates: countBy(summaries, (summary) => summary.finalScanState),
    declaredScenarioKeys,
    missingDeclaredScenarioKeys: REAL_SESSION_RECOMMENDED_SCENARIOS.filter((key) => !declaredScenarioKeys.includes(key)),
    coveredScenarioKeys,
    missingScenarioKeys: REAL_SESSION_RECOMMENDED_SCENARIOS.filter((key) => !coveredScenarioKeys.includes(key)),
    summaries,
  };
}

export function partitionRealSessionFixturesForReplay(fixtures = [], { reviewStatuses = ['reviewed'] } = {}) {
  const strictReviewStatuses = normalizeReviewStatuses(reviewStatuses);
  const normalizedFixtures = fixtures.map((fixture) => normalizeFixtureInput(fixture));

  return {
    strictReviewStatuses,
    replayFixtures: normalizedFixtures.filter((fixture) => (
      strictReviewStatuses.includes(fixture.metadata.reviewStatus)
    )),
    skippedFixtures: normalizedFixtures.filter((fixture) => (
      !strictReviewStatuses.includes(fixture.metadata.reviewStatus)
    )),
    totalFixtureCount: normalizedFixtures.length,
  };
}

export function formatRealSessionCoverageReport(coverage) {
  const lines = [
    'Real-session fixture coverage',
    `Fixtures: ${coverage.fixtureCount}`,
    `Metadata sidecars: ${coverage.metadataSidecarCount}/${coverage.fixtureCount}`,
    `Fixtures without sidecars: ${coverage.fixturesWithoutMetadata.length ? coverage.fixturesWithoutMetadata.join(', ') : 'none'}`,
    `Duration: ${formatDuration(coverage.totalDurationMs)}`,
    `Samples: ${coverage.totalSamples}`,
    `Tracker modes: ${formatCounts(coverage.trackerModes)}`,
    `Review statuses: ${formatCounts(coverage.reviewStatuses)}`,
    `Final scan states: ${formatCounts(coverage.finalScanStates)}`,
    `Declared scenarios: ${coverage.declaredScenarioKeys.length ? coverage.declaredScenarioKeys.join(', ') : 'none'}`,
    `Missing declared scenarios: ${coverage.missingDeclaredScenarioKeys.length ? coverage.missingDeclaredScenarioKeys.join(', ') : 'none'}`,
    `Covered scenarios: ${coverage.coveredScenarioKeys.length ? coverage.coveredScenarioKeys.join(', ') : 'none'}`,
    `Missing scenarios: ${coverage.missingScenarioKeys.length ? coverage.missingScenarioKeys.join(', ') : 'none'}`,
  ];

  if (!coverage.summaries.length) {
    lines.push('Fixtures detail: none');
    return lines.join('\n');
  }

  lines.push('Fixtures detail:');
  for (const summary of coverage.summaries) {
    lines.push(
      `- ${summary.name}: ${formatDuration(summary.durationMs)}, samples=${summary.sampleCount}, `
      + `state=${summary.finalScanState}, review=${summary.reviewStatus}, `
      + `conf=${summary.avgScanConfidence}/${summary.minScanConfidence}, `
      + `declared=${summary.declaredScenarios.length ? summary.declaredScenarios.join('|') : 'none'}, `
      + `derived=${summary.coveredScenarios.length ? summary.coveredScenarios.join('|') : 'none'}`,
    );
  }

  return lines.join('\n');
}

export function replayRealSessionFixture(fixture) {
  const normalizedFixture = normalizeFixtureInput(fixture);
  const { name, data } = normalizedFixture;
  let previousBiofield = null;

  const timeline = data.timeline.map((entry) => {
    const qualityFlags = deriveQualityFlags(entry.statuses);
    const biofield = computeBiofieldFrame({
      vitals: entry.vitals,
      voiceMetrics: entry.voiceMetrics,
      vibraimageMetrics: entry.vibraimageMetrics,
      emotions: entry.emotions,
      baseline: data.baseline || null,
      facePresent: entry.statuses.face === 'tracking',
      previousBiofield,
      qualityFlags,
    });
    previousBiofield = biofield;

    return {
      timestamp: entry.timestamp,
      statusMessage: deriveStatusMessage(entry.statuses, {
        hr: entry.vitals?.hr ?? null,
        bufferFullness: entry.bufferFullness ?? 0,
      }),
      biofield: projectBiofieldSnapshot(biofield),
      quality: projectQualitySnapshot(biofield.qualityFlags),
    };
  });

  const finalEntry = timeline.at(-1) || null;
  const finalQuality = previousBiofield?.qualityFlags || deriveQualityFlags(data.statuses);

  return {
    name,
    filePath: normalizedFixture.filePath || null,
    timeline,
    final: {
      statusMessage: deriveStatusMessage(data.statuses, {
        hr: data.vitals?.hr ?? null,
        bufferFullness: data.session?.bufferFullness ?? data.timeline.at(-1)?.bufferFullness ?? 0,
      }),
      biofield: projectBiofieldSnapshot(previousBiofield),
      quality: projectQualitySnapshot(finalQuality),
      finalEntry,
    },
  };
}

export function diffRealSessionFixtureReplay(fixture) {
  const normalizedFixture = normalizeFixtureInput(fixture);
  const replay = replayRealSessionFixture(normalizedFixture);
  const { data, name } = normalizedFixture;
  const mismatches = [];

  if ((data.statusMessage || null) !== replay.final.statusMessage) {
    mismatches.push({
      path: 'statusMessage',
      expected: data.statusMessage || null,
      actual: replay.final.statusMessage,
    });
  }

  pushMismatchIfNeeded(mismatches, 'biofield', projectBiofieldSnapshot(data.biofield), replay.final.biofield);
  pushMismatchIfNeeded(mismatches, 'runtime.scanState', data.runtime?.scanState ?? null, replay.final.quality.scanState);
  pushMismatchIfNeeded(
    mismatches,
    'runtime.scanConfidence',
    data.runtime?.scanConfidence ?? null,
    replay.final.quality.scanConfidence,
  );
  pushMismatchIfNeeded(
    mismatches,
    'runtime.partialReasons',
    normalizeForComparison(data.runtime?.partialReasons || []),
    normalizeForComparison(replay.final.quality.partialReasons),
  );

  data.timeline.forEach((entry, index) => {
    const replayEntry = replay.timeline[index];
    const prefix = `timeline[${index}]`;

    pushMismatchIfNeeded(
      mismatches,
      `${prefix}.statusMessage`,
      entry.statusMessage,
      replayEntry?.statusMessage ?? null,
    );
    pushMismatchIfNeeded(
      mismatches,
      `${prefix}.biofield`,
      projectBiofieldSnapshot(entry.biofield),
      replayEntry?.biofield ?? null,
    );
    pushMismatchIfNeeded(
      mismatches,
      `${prefix}.quality`,
      projectQualitySnapshot(entry.quality),
      replayEntry?.quality ?? null,
    );
  });

  return {
    fixtureName: name,
    filePath: normalizedFixture.filePath || null,
    mismatchCount: mismatches.length,
    mismatches,
    replay,
  };
}

export function formatRealSessionReplayReport(results = [], {
  strictReviewStatuses = ['reviewed'],
  skippedFixtures = [],
  totalFixtureCount = results.length + skippedFixtures.length,
} = {}) {
  const normalizedReviewStatuses = normalizeReviewStatuses(strictReviewStatuses);
  const normalizedSkippedFixtures = skippedFixtures.map((fixture) => normalizeFixtureInput(fixture));
  const lines = [
    'Real-session fixture replay',
    `Review filter: ${normalizedReviewStatuses.join(', ')}`,
    `Fixtures: ${results.length} replayed / ${totalFixtureCount} total`,
    `Skipped fixtures: ${normalizedSkippedFixtures.length
      ? normalizedSkippedFixtures.map((fixture) => `${fixture.name} (${fixture.metadata.reviewStatus})`).join(', ')
      : 'none'}`,
  ];

  if (!results.length) {
    lines.push(`Status: no ${normalizedReviewStatuses.join(' or ')} real-session fixtures`);
    return lines.join('\n');
  }

  const mismatchedResults = results.filter((result) => result.mismatchCount > 0);
  lines.push(`Mismatched fixtures: ${mismatchedResults.length}`);

  for (const result of results) {
    if (result.mismatchCount === 0) {
      lines.push(`- ${result.fixtureName}: ok`);
      continue;
    }

    lines.push(`- ${result.fixtureName}: ${result.mismatchCount} mismatch(es)`);
    for (const mismatch of result.mismatches) {
      lines.push(`  ${mismatch.path}`);
      lines.push(`    expected: ${JSON.stringify(mismatch.expected)}`);
      lines.push(`    actual:   ${JSON.stringify(mismatch.actual)}`);
    }
  }

  return lines.join('\n');
}

function validateTimeline(timeline, updatedAt, prefix) {
  let previousTimestamp = null;
  let previousElapsed = -1;

  timeline.forEach((entry, index) => {
    const label = `${prefix} timeline[${index}]`;
    assertPlainObject(entry, `${label} must be an object.`);
    assertIsoDate(entry.timestamp, `${label} must contain an ISO timestamp.`);
    assertNonNegativeNumber(entry.elapsedMs, `${label} must contain a non-negative elapsedMs.`);
    assert(
      entry.elapsedMs >= previousElapsed,
      `${label} elapsedMs must be non-decreasing.`,
    );
    assertNonNegativeInteger(entry.frameCount, `${label} must contain a non-negative frameCount.`);
    assertBufferFullness(
      entry.bufferFullness,
      `${label} bufferFullness must stay within [0, 1].`,
    );
    assert(
      typeof entry.statusMessage === 'string',
      `${label} must contain a statusMessage string.`,
    );
    assertPlainObject(entry.statuses, `${label} must contain statuses.`);
    assertPlainObject(entry.quality, `${label} must contain quality metadata.`);
    assert(
      typeof entry.quality.scanState === 'string',
      `${label} quality.scanState must be a string.`,
    );
    assertNumberInRange(
      entry.quality.scanConfidence,
      0,
      100,
      `${label} quality.scanConfidence must stay within [0, 100].`,
    );

    if (previousTimestamp !== null) {
      assert(
        Date.parse(entry.timestamp) >= previousTimestamp,
        `${label} timestamps must be non-decreasing.`,
      );
    }
    previousTimestamp = Date.parse(entry.timestamp);
    previousElapsed = entry.elapsedMs;
  });

  assert(
    Date.parse(updatedAt) >= previousTimestamp,
    `${prefix} session.updatedAt must not be older than the last timeline sample.`,
  );
}

function validateSignals(signals, prefix) {
  assert(
    signals.rppg || signals.vibraimage,
    `${prefix} must contain at least one signal dump.`,
  );

  if (signals.rppg) {
    const label = `${prefix} signals.rppg`;
    assertPlainObject(signals.rppg, `${label} must be an object.`);
    assertPositiveInteger(signals.rppg.bufferSize, `${label}.bufferSize must be positive.`);
    assertBufferFullness(
      signals.rppg.bufferFullness,
      `${label}.bufferFullness must stay within [0, 1].`,
    );
    assertPlainObject(signals.rppg.rgb, `${label}.rgb must be an object.`);
    for (const channel of ['r', 'g', 'b']) {
      assert(
        Array.isArray(signals.rppg.rgb[channel]),
        `${label}.rgb.${channel} must be an array.`,
      );
      assertNumericArray(
        signals.rppg.rgb[channel],
        `${label}.rgb.${channel} must contain only numbers.`,
      );
    }
    assert(
      signals.rppg.rgb.r.length === signals.rppg.rgb.g.length
        && signals.rppg.rgb.g.length === signals.rppg.rgb.b.length,
      `${label}.rgb channel lengths must match.`,
    );
    if (signals.rppg.pulseSignal !== null) {
      assert(
        Array.isArray(signals.rppg.pulseSignal),
        `${label}.pulseSignal must be an array or null.`,
      );
      assertNumericArray(
        signals.rppg.pulseSignal,
        `${label}.pulseSignal must contain only numbers.`,
      );
    }
  }

  if (signals.vibraimage) {
    const label = `${prefix} signals.vibraimage`;
    assertPlainObject(signals.vibraimage, `${label} must be an object.`);
    assertPositiveInteger(signals.vibraimage.maxHistory, `${label}.maxHistory must be positive.`);
    assertNonNegativeInteger(signals.vibraimage.frameCount, `${label}.frameCount must be non-negative.`);
    for (const key of ['diffHistory', 'symmetryHistory', 'upperDiffHistory', 'lowerDiffHistory']) {
      assert(
        Array.isArray(signals.vibraimage[key]),
        `${label}.${key} must be an array.`,
      );
      assertNumericArray(
        signals.vibraimage[key],
        `${label}.${key} must contain only numbers.`,
      );
      assert(
        signals.vibraimage[key].length <= signals.vibraimage.maxHistory,
        `${label}.${key} length must not exceed maxHistory.`,
      );
    }
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertPlainObject(value, message) {
  assert(Boolean(value) && typeof value === 'object' && !Array.isArray(value), message);
}

function assertIsoDate(value, message) {
  assert(typeof value === 'string' && !Number.isNaN(Date.parse(value)), message);
}

function assertPositiveInteger(value, message) {
  assert(Number.isInteger(value) && value > 0, message);
}

function assertNonNegativeInteger(value, message) {
  assert(Number.isInteger(value) && value >= 0, message);
}

function assertNonNegativeNumber(value, message) {
  assert(typeof value === 'number' && Number.isFinite(value) && value >= 0, message);
}

function assertNumberInRange(value, min, max, message) {
  assert(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max, message);
}

function assertBufferFullness(value, message) {
  assertNumberInRange(value, 0, 1, message);
}

function assertNumericArray(values, message) {
  assert(values.every((value) => typeof value === 'number' && Number.isFinite(value)), message);
}

function normalizeFixtureInput(fixture) {
  if (!fixture || typeof fixture !== 'object') {
    throw new Error('Real-session fixture summary input must be an object.');
  }
  if ('data' in fixture) {
    const fixtureName = fixture.name || 'fixture';
    return {
      name: fixtureName,
      filePath: fixture.filePath || null,
      metadataPath: fixture.metadataPath || null,
      hasMetadataSidecar: Boolean(fixture.hasMetadataSidecar),
      metadata: fixture.metadata
        ? validateRealSessionFixtureMetadata(fixture.metadata, { fixtureName })
        : deriveRealSessionFixtureMetadata({
            fixtureName,
            fixtureData: fixture.data,
          }),
      data: fixture.data,
    };
  }
  return {
    name: 'fixture',
    filePath: null,
    metadataPath: null,
    hasMetadataSidecar: false,
    metadata: deriveRealSessionFixtureMetadata({
      fixtureName: 'fixture',
      fixtureData: fixture,
    }),
    data: fixture,
  };
}

function normalizeReviewStatuses(reviewStatuses = ['reviewed']) {
  const normalizedStatuses = [...new Set(
    (Array.isArray(reviewStatuses) ? reviewStatuses : [reviewStatuses])
      .filter((status) => Boolean(status)),
  )];

  if (!normalizedStatuses.length) {
    return ['reviewed'];
  }

  normalizedStatuses.forEach((status) => {
    assert(
      REAL_SESSION_REVIEW_STATUSES.includes(status),
      `Unknown real-session review status "${status}". Expected one of: ${REAL_SESSION_REVIEW_STATUSES.join(', ')}.`,
    );
  });

  return normalizedStatuses.sort((left, right) => left.localeCompare(right));
}

function deriveRealSessionScenarioFlags(data) {
  const timeline = data.timeline || [];
  const voiceActiveSamples = timeline.filter((entry) => (entry.voiceMetrics?.rms ?? 0) > 0.02).length;
  const faceLostSamples = timeline.filter((entry) => entry.statuses.face === 'lost').length;
  const microphoneDeniedSamples = timeline.filter((entry) => entry.statuses.microphone === 'denied').length;
  const pulseWeakSamples = timeline.filter((entry) => entry.statuses.pulse === 'weak').length;
  const hdActiveSamples = timeline.filter((entry) => entry.statuses.hdMode === 'active').length;
  const partialSamples = timeline.filter((entry) => entry.quality.scanState !== 'full').length;

  return {
    full_signal: (
      data.runtime.scanState === 'full'
      && partialSamples === 0
      && data.statuses.face === 'tracking'
      && data.statuses.pulse === 'ready'
      && data.statuses.microphone === 'ready'
    ),
    partial_quality: partialSamples > 0 || data.runtime.scanState !== 'full',
    silent_mode: voiceActiveSamples === 0,
    face_loss: faceLostSamples > 0 || data.statuses.face === 'lost',
    microphone_denied: microphoneDeniedSamples > 0 || data.statuses.microphone === 'denied',
    pulse_weak: pulseWeakSamples > 0 || data.statuses.pulse === 'weak',
    hd_mode: hdActiveSamples > 0 || data.statuses.hdMode === 'active',
  };
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundTo(value) {
  return Math.round(value * 100) / 100;
}

function countBy(values, selector) {
  const entries = values.reduce((counts, value) => {
    const key = selector(value);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});

  return Object.fromEntries(
    Object.entries(entries).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function formatCounts(counts) {
  const entries = Object.entries(counts || {});
  if (!entries.length) return 'none';
  return entries.map(([key, count]) => `${key}:${count}`).join(', ');
}

function formatDuration(durationMs) {
  return `${roundTo(durationMs / 1000)}s`;
}

function projectBiofieldSnapshot(biofield = null) {
  if (!biofield) return null;
  return normalizeForComparison({
    ...Object.fromEntries(REPLAY_BIOFIELD_KEYS.map((key) => [key, biofield[key] ?? null])),
    confidence: { ...(biofield.confidence || {}) },
  });
}

function projectQualitySnapshot(quality = null) {
  if (!quality) return null;
  return normalizeForComparison({
    scanState: quality.scanState ?? null,
    scanConfidence: quality.scanConfidence ?? null,
    partialReasons: [...(quality.partialReasons || [])],
    retainedParameters: [...(quality.retainedParameters || [])],
  });
}

function pushMismatchIfNeeded(mismatches, path, expected, actual) {
  const normalizedExpected = normalizeForComparison(expected);
  const normalizedActual = normalizeForComparison(actual);
  if (JSON.stringify(normalizedExpected) === JSON.stringify(normalizedActual)) {
    return;
  }
  mismatches.push({
    path,
    expected: normalizedExpected,
    actual: normalizedActual,
  });
}

function normalizeForComparison(value) {
  if (typeof value === 'number' && !Number.isInteger(value)) {
    return Math.round(value * 10000) / 10000;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForComparison(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeForComparison(item)]),
    );
  }
  return value ?? null;
}

function normalizeScenarioTags(tags = []) {
  return [...new Set(tags)].sort((left, right) => left.localeCompare(right));
}
