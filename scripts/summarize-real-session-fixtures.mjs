import {
  buildRealSessionCoverage,
  formatRealSessionCoverageReport,
  loadRealSessionFixtures,
} from '../tests/fixtures/real-session-fixtures.js';

const fixtures = loadRealSessionFixtures();
const coverage = buildRealSessionCoverage(fixtures);

console.log(formatRealSessionCoverageReport(coverage));
