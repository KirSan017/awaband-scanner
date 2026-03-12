import {
  diffRealSessionFixtureReplay,
  formatRealSessionReplayReport,
  loadRealSessionFixtures,
  partitionRealSessionFixturesForReplay,
  REAL_SESSION_REVIEW_STATUSES,
} from '../tests/fixtures/real-session-fixtures.js';

const includeAllFixtures = process.argv.includes('--all');
const fixtures = loadRealSessionFixtures();
const replaySelection = includeAllFixtures
  ? {
      strictReviewStatuses: REAL_SESSION_REVIEW_STATUSES,
      replayFixtures: fixtures,
      skippedFixtures: [],
      totalFixtureCount: fixtures.length,
    }
  : partitionRealSessionFixturesForReplay(fixtures);
const results = replaySelection.replayFixtures.map((fixture) => diffRealSessionFixtureReplay(fixture));

console.log(formatRealSessionReplayReport(results, replaySelection));

if (results.some((result) => result.mismatchCount > 0)) {
  process.exit(1);
}
