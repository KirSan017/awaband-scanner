# AWABAND Scanner

AWABAND Scanner is a browser-based wellness demo that turns camera and microphone signals into a seven-parameter "biofield" visualization inside the Awaterra 2225 universe.

The current repository already contains:

- live camera scanning with heuristic face tracking and optional native `FaceDetector` usage;
- rPPG pulse extraction, HRV metrics, vibraimage-style motion analysis, voice metrics and simple emotion heuristics;
- quality-aware runtime diagnostics, retained-value handling and a structured JSON export with session timeline and signal buffers;
- simulation modes for demoing the app without real camera/microphone hardware;
- optional HD mode via MediaPipe Selfie Segmentation loaded on demand from CDN.

The app is a frontend-only demo. It is not a medical device and does not provide clinical interpretation.

## Quick Start

```bash
npm install
npm run build
npm run build:site
npm start
```

Open [http://localhost:3001](http://localhost:3001).

Development checks:

```bash
npm run build
npm test
npm run fixture:import -- C:\path\to\awaband-scan.json calm-full-signal
npm run fixture:replay
npm run fixture:replay -- --all
npm run fixture:summary
```

## Simulation Modes

The scanner supports URL-driven simulation through the `sim` query parameter.

Examples:

```text
http://localhost:3001/?sim=fake-camera+fake-mic
http://localhost:3001/?sim=fake-camera+fake-mic+face-loss
http://localhost:3001/?sim=camera-denied
http://localhost:3001/?sim=mic-denied
http://localhost:3001/?sim=fake-camera+pulse-weak
```

Supported tokens:

- `camera-denied`
- `mic-denied`
- `fake-camera`
- `fake-mic`
- `face-loss`
- `pulse-weak`

## Documentation

- [Feature inventory](docs/features.md)
- [Onboarding guide](docs/onboarding.md)
- [Methodology](docs/methodology.md)
- [User guide](docs/user-guide.md)
- [Algorithm and parameter documentation](docs/parameters.md)
- [Project audit](docs/audit.md)
- [Real-session fixtures](docs/real-session-fixtures.md)

## Runtime Notes

- `npm start` serves static files from the project root and `dist/` on port `3001`.
- HD mode is optional and lazy-loads MediaPipe Selfie Segmentation from `jsdelivr`, so it depends on network availability.
- The result screen can export both `PNG` and a structured `JSON` session dump with timeline samples plus rolling `rPPG` and `vibraimage` buffers.
- The scanning screen also exposes a quick `JSON` export button for live session capture without switching to the result screen.
- Live `awaband-scan.json` exports can be imported into `tests/fixtures/real-sessions/` together with `*.meta.json` sidecars for review status, scenario tags and capture context.
- Imported live fixtures start with `reviewStatus: pending`; they still validate and appear in coverage, but do not gate strict replay until promoted to `reviewed`.
- `npm run fixture:replay` re-derives status, quality and biofield from stored timeline samples and fails on drift for `reviewed` fixtures only. Use `npm run fixture:replay -- --all` to inspect pending drift as well.
- `npm run fixture:summary` prints current dataset coverage, declared scenario tags and metadata-sidecar gaps.

## Deployment

The app is deployable as a static site.

Local deployment artifact:

```bash
npm run build:site
```

This creates `site/` with:

- `index.html`
- `scanner.css`
- `favicon.svg`
- `dist/app.js`

GitHub Pages automation is configured in [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml). It deploys on push to `master` and also supports manual `workflow_dispatch`.
