import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  deriveRealSessionFixtureMetadata,
  REAL_SESSION_FIXTURE_DIR,
  ensureRealSessionFixtureDir,
  getRealSessionMetadataPath,
  sanitizeFixtureName,
  validateRealSessionFixture,
} from '../tests/fixtures/real-session-fixtures.js';

const args = process.argv.slice(2);
const force = args.includes('--force');
const positional = args.filter((arg) => arg !== '--force');
const [sourceArg, fixtureArg] = positional;

if (!sourceArg || !fixtureArg) {
  console.error('Usage: node scripts/import-real-session-fixture.mjs <path-to-awaband-scan.json> <fixture-name> [--force]');
  process.exit(1);
}

const sourcePath = path.resolve(process.cwd(), sourceArg);
const fixtureName = sanitizeFixtureName(fixtureArg);

if (!existsSync(sourcePath)) {
  console.error(`Source file not found: ${sourcePath}`);
  process.exit(1);
}

const targetDir = ensureRealSessionFixtureDir();
const targetPath = path.join(REAL_SESSION_FIXTURE_DIR, `${fixtureName}.json`);
const targetMetadataPath = getRealSessionMetadataPath(targetPath);

if (existsSync(targetPath) && !force) {
  console.error(`Fixture already exists: ${targetPath}`);
  console.error('Re-run with --force to overwrite it.');
  process.exit(1);
}

try {
  const sourceData = JSON.parse(readFileSync(sourcePath, 'utf8'));
  const fixtureData = validateRealSessionFixture(sourceData, fixtureName);
  const existingMetadata = existsSync(targetMetadataPath)
    ? JSON.parse(readFileSync(targetMetadataPath, 'utf8'))
    : null;
  const fixtureMetadata = deriveRealSessionFixtureMetadata({
    fixtureName,
    fixtureData,
    existingMetadata,
    importedAt: new Date().toISOString(),
  });
  writeFileSync(targetPath, `${JSON.stringify(fixtureData, null, 2)}\n`, 'utf8');
  writeFileSync(targetMetadataPath, `${JSON.stringify(fixtureMetadata, null, 2)}\n`, 'utf8');

  console.log(`Imported fixture "${fixtureName}" to ${targetPath}`);
  console.log(`Metadata: ${targetMetadataPath}`);
  console.log(`Samples: ${fixtureData.session.sampleCount}`);
  console.log(`Duration: ${fixtureData.session.durationMs} ms`);
  console.log(`Scan state: ${fixtureData.runtime.scanState}`);
  console.log(`Review status: ${fixtureMetadata.reviewStatus}`);
  console.log(`Scenario tags: ${fixtureMetadata.scenarioTags.length ? fixtureMetadata.scenarioTags.join(', ') : 'none'}`);
  console.log(`Output directory: ${targetDir}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
