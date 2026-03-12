# Real-Session Fixtures

This workflow turns exported `awaband-scan.json` files from live scans into checked-in regression fixtures.

## Goal

Synthetic fixtures already cover formula and quality-state logic. Real-session fixtures are for drift detection against recorded live scans: stable signal, noisy signal, silent mode, face loss, partial quality cases.

## What Counts As A Real-Session Fixture

Accepted input must already be a valid `awaband-scan.json` export and must satisfy:

- `exportSchema = awaband-session-export`
- `exportVersion = 2`
- `session.captureMode = real`
- non-empty `timeline`
- `session.sampleCount === timeline.length`
- at least one recorded signal dump in `signals.rppg` or `signals.vibraimage`

The current export still does not include raw audio waveform or full video. These fixtures are session traces, not complete recordings.

## Import Command

```bash
npm run fixture:import -- C:\path\to\awaband-scan.json calm-full-signal
```

Optional overwrite:

```bash
npm run fixture:import -- C:\path\to\awaband-scan.json calm-full-signal --force
```

Imported fixtures are written as:

- `tests/fixtures/real-sessions/<fixture-name>.json`
- `tests/fixtures/real-sessions/<fixture-name>.meta.json`

The metadata sidecar stores:

- `reviewStatus`
- `scenarioTags`
- `captureContext`
- free-form `notes`

New imports start as `reviewStatus: pending`.

On re-import, the tool preserves existing review fields and only refreshes timestamps.

## Naming

Use kebab-case names that describe the capture scenario, for example:

- `calm-full-signal`
- `silent-mode-office`
- `face-loss-turn-away`
- `noisy-room-partial`

## Capture Checklist

1. Run the app with `npm start`.
2. Open the scanner without `?sim=...`.
3. Record a live scan long enough to collect timeline samples and a filled pulse buffer.
4. Export `JSON` from the result screen.
5. Import the export with `npm run fixture:import -- <path> <fixture-name>`.
6. Run `npm test`.
7. Run `npm run fixture:replay` to verify that already reviewed benchmark fixtures still replay without drift.
8. Run `npm run fixture:replay -- --all` if you also want to inspect drift on newly imported `pending` fixtures before review.
9. Run `npm run fixture:summary` to see which real-session scenarios are already covered.

## Repository Checks

`tests/real-session-fixtures.test.js` validates:

- inline coverage for the current real-session export schema;
- every checked-in JSON fixture in `tests/fixtures/real-sessions/`.

This means any imported fixture becomes part of the normal `npm test` run immediately for schema and metadata validation, while strict zero-drift replay only applies after review.

`npm run fixture:replay` uses the stored timeline metrics and statuses to recompute:

- `statusMessage`
- `quality.scanState`
- `quality.scanConfidence`
- `quality.partialReasons`
- `quality.retainedParameters`
- biofield parameter values and confidences

By default, strict replay only covers fixtures with `reviewStatus: reviewed`. This lets new live captures land as `pending` without breaking CI before they are reviewed and accepted into the benchmark set.

Use `npm run fixture:replay -- --all` to include `pending` fixtures in the drift report.

This is the first real regression layer that can catch model drift without requiring raw video or raw audio.

`npm run fixture:summary` additionally reports dataset-level coverage for the recommended scenarios:

- `full_signal`
- `partial_quality`
- `silent_mode`
- `face_loss`
- `microphone_denied`
- `pulse_weak`
- `hd_mode`

It also reports:

- how many fixtures already have metadata sidecars;
- which fixtures still need sidecars;
- declared scenario tags from metadata versus derived scenarios from the timeline;
- review-status counts for the current dataset.
