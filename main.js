// AWABAND Scanner — Biophotonic Wellness HUD
// Awaterra 2225 Universe

import { AuraRenderer } from './aura.js';
import { AwabandPanel } from './awaband-panel.js';
import {
  EMPTY_EMOTIONS,
  EMPTY_VIBRAIMAGE_METRICS,
  EMPTY_VOICE_METRICS,
} from './scan-contracts.js';
import { buildResultDiagnosticsMarkup } from './scan-diagnostics.js';
import { buildGuideOverlay as createGuideOverlay } from './scan-guide.js';
import { installScanSimulation } from './scan-sim.js';
import { ScanSession } from './scan-session.js';

const SIMULATION = installScanSimulation();
const SCREENS = ['splash', 'scanning', 'result'];
const SENSOR_META = {
  camera: { id: 'scan-sensor-camera', label: 'CAM' },
  microphone: { id: 'scan-sensor-microphone', label: 'MIC' },
  face: { id: 'scan-sensor-face', label: 'FACE' },
  pulse: { id: 'scan-sensor-pulse', label: 'PULSE' },
  hdMode: { id: 'scan-sensor-hd', label: 'FOCUS' },
};
const PARAM_LABELS = {
  stability: 'Стабильность',
  flow: 'Поток',
  energy: 'Энергия',
  resonance: 'Резонанс',
  vibration: 'Вибрация',
  clarity: 'Ясность',
  integrity: 'Целостность',
};

// ── Scanning state ──
let scanSession = null;
let lastBiofield = null;
let lastHR = null;
let lastVitals = null;
let lastVoiceMetrics = null;
let lastVibraimageMetrics = null;
let lastEmotions = null;
let lastSensorStatus = null;
let lastQualityFlags = null;
let lastScanExport = null;
let lastTrackerMode = 'fallback';
let lastSimulationMode = SIMULATION.label;
let toastHideTimer = null;

/** Switch visible screen */
function showScreen(id) {
  for (const name of SCREENS) {
    const el = document.getElementById(name);
    if (el) el.classList.toggle('active', name === id);
  }
}

/** Create an element with optional classes and attributes */
function el(tag, cls, attrs) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else e.setAttribute(k, v);
    }
  }
  return e;
}

function buildSimulationBadge(extraClass = '') {
  if (!SIMULATION.active) return null;
  return el('div', `scan-sim-badge ${extraClass}`.trim(), {
    text: `SIM: ${SIMULATION.label}`,
    title: 'Awaband simulation mode is active',
  });
}

function setStatusText(message, isAlert = false) {
  const statusEl = document.getElementById('scan-status');
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.toggle('face-lost', isAlert);
}

function formatSensorState(key, state) {
  const stateMap = {
    camera: {
      pending: 'pending',
      ready: 'ready',
      denied: 'denied',
    },
    microphone: {
      pending: 'pending',
      ready: 'ready',
      denied: 'denied',
    },
    face: {
      searching: 'searching',
      tracking: 'tracking',
      lost: 'lost',
    },
    pulse: {
      warming_up: 'warm-up',
      acquiring: 'acquiring',
      weak: 'weak',
      ready: 'ready',
      unavailable: 'offline',
    },
    hdMode: {
      off: 'off',
      loading: 'loading',
      active: 'active',
      error: 'error',
    },
  };

  return stateMap[key]?.[state] || state;
}

function updateSensorStrip(statuses = lastSensorStatus) {
  if (!statuses) return;

  for (const [key, meta] of Object.entries(SENSOR_META)) {
    const chip = document.getElementById(meta.id);
    if (!chip) continue;

    const state = statuses[key];
    chip.className = `scan-sensor-chip state-${state}`;
    chip.querySelector('.scan-sensor-label').textContent = meta.label;
    chip.querySelector('.scan-sensor-value').textContent = formatSensorState(key, state);
  }
}

function updateResultDiagnostics() {
  const diagnostics = document.getElementById('result-diagnostics');
  if (!diagnostics) return;

  const diagnosticsMarkup = buildResultDiagnosticsMarkup({
    qualityFlags: lastQualityFlags,
    simulationMode: lastSimulationMode,
    paramLabels: PARAM_LABELS,
  });

  diagnostics.classList.toggle('partial', diagnosticsMarkup.partial);
  diagnostics.innerHTML = diagnosticsMarkup.html;
}

function applyScanState(state = null) {
  if (!state) {
    resetRuntimeState();
    updateResultDiagnostics();
    updateDebugPanel();
    return;
  }

  lastBiofield = state.biofield || null;
  lastVitals = state.vitals || null;
  lastVoiceMetrics = state.voiceMetrics || { ...EMPTY_VOICE_METRICS };
  lastVibraimageMetrics = state.vibraimageMetrics || { ...EMPTY_VIBRAIMAGE_METRICS };
  lastEmotions = state.emotions || { ...EMPTY_EMOTIONS };
  lastSensorStatus = state.statuses || null;
  lastQualityFlags = state.qualityFlags || null;
  lastScanExport = state.exportData || null;
  lastHR = state.hr ?? null;
  lastTrackerMode = state.trackerMode || 'fallback';
  lastSimulationMode = state.simulationMode || SIMULATION.label;

  updateResultDiagnostics();
  updateDebugPanel(state);
}

function toggleDebugPanel() {
  const panel = document.getElementById('scan-debug-panel');
  const btn = document.getElementById('scan-debug-btn');
  if (!panel || !btn) return;

  const open = !panel.classList.contains('open');
  panel.classList.toggle('open', open);
  btn.classList.toggle('active', open);
  updateDebugPanel();
}

function updateDebugPanel(state = null) {
  const panel = document.getElementById('scan-debug-panel');
  if (!panel) return;

  let title = panel.querySelector('.scan-debug-title');
  let pre = panel.querySelector('.scan-debug-pre');
  if (!title) {
    title = el('div', 'scan-debug-title', { text: 'Session Debug' });
    panel.appendChild(title);
  }
  if (!pre) {
    pre = el('pre', 'scan-debug-pre');
    panel.appendChild(pre);
  }

  const snapshot = state || {
    biofield: lastBiofield,
    vitals: lastVitals,
    voiceMetrics: lastVoiceMetrics,
    vibraimageMetrics: lastVibraimageMetrics,
    emotions: lastEmotions,
    statuses: lastSensorStatus,
    qualityFlags: lastQualityFlags,
    trackerMode: lastTrackerMode,
    simulationMode: lastSimulationMode,
  };

  if (!snapshot.statuses) {
    pre.textContent = `Simulation: ${snapshot.simulationMode || 'off'}\nNo active scan state.`;
    return;
  }

  const quality = snapshot.qualityFlags || {};
  const lines = [
    `Tracker: ${snapshot.trackerMode || 'fallback'}`,
    `Simulation: ${snapshot.simulationMode || 'off'}`,
    `Scan: ${quality.scanState || 'unknown'} (${quality.scanConfidence ?? 0}%)`,
    `Statuses: ${formatDebugStatuses(snapshot.statuses)}`,
    `Biofield: ${formatDebugMetrics(snapshot.biofield, ['stability', 'flow', 'energy', 'resonance', 'vibration', 'clarity', 'integrity', 'luminosity'])}`,
    `Vitals: ${formatDebugMetrics(snapshot.vitals, ['hr', 'hrv', 'sdnn', 'pnn50', 'lfhf', 'stressIndex', 'coherence', 'signalQuality'])}`,
    `Voice: ${formatDebugMetrics(snapshot.voiceMetrics, ['pitch', 'jitter', 'hnr', 'rms', 'spectralCentroid', 'voiceBioCenter'])}`,
    `Motion: ${formatDebugMetrics(snapshot.vibraimageMetrics, ['amplitude', 'frequency', 'symmetry', 'entropy'])}`,
    `Emotions: ${formatDebugMetrics(snapshot.emotions, ['laughing', 'smiling', 'laughIntensity', 'smileIntensity'])}`,
    `Retained: ${(quality.retainedParameters || []).join(', ') || 'none'}`,
    `Diagnostics-only: ${(quality.diagnosticsOnlyMetrics || []).join(', ') || 'none'}`,
    `Parameter states: ${formatDebugPairs(quality.parameterStates)}`,
    'Trace:',
    formatDebugTrace(snapshot.biofield?.trace),
  ];

  pre.textContent = lines.join('\n');
}

function formatDebugStatuses(statuses = {}) {
  return Object.entries(statuses)
    .map(([key, value]) => `${SENSOR_META[key]?.label || key}:${formatSensorState(key, value)}`)
    .join(' | ');
}

function formatDebugMetrics(source = null, keys = []) {
  return keys
    .map((key) => `${key}=${formatDebugValue(source?.[key])}`)
    .join(' | ');
}

function formatDebugPairs(source = null) {
  if (!source) return 'none';
  return Object.entries(source)
    .map(([key, value]) => `${key}:${value}`)
    .join(' | ');
}

function formatDebugTrace(trace = null) {
  if (!trace || !Object.keys(trace).length) return '  none';
  return Object.entries(trace)
    .map(([key, value]) => `  ${key} <- ${Array.isArray(value) && value.length ? value.join(', ') : 'none'}`)
    .join('\n');
}

function formatDebugValue(value) {
  if (value === null || value === undefined) return '--';
  if (Array.isArray(value)) {
    return `[${value.map((item) => formatDebugValue(item)).join(', ')}]`;
  }
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return `${value}`;
    const decimals = Math.abs(value) < 10 ? 2 : 1;
    return value.toFixed(decimals);
  }
  return `${value}`;
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = filename;
  link.href = url;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function resetRuntimeState() {
  lastBiofield = null;
  lastHR = null;
  lastVitals = null;
  lastVoiceMetrics = { ...EMPTY_VOICE_METRICS };
  lastVibraimageMetrics = { ...EMPTY_VIBRAIMAGE_METRICS };
  lastEmotions = { ...EMPTY_EMOTIONS };
  lastSensorStatus = null;
  lastQualityFlags = null;
  lastScanExport = null;
  lastTrackerMode = 'fallback';
  lastSimulationMode = SIMULATION.label;
}

/** Build splash screen */
function buildSplash() {
  const screen = el('div', 'screen active');
  screen.id = 'splash';

  // Background elements
  screen.appendChild(el('div', 'bg-mesh'));
  screen.appendChild(el('div', 'bg-noise'));
  screen.appendChild(el('div', 'bg-grid'));

  // Concentric sonar rings
  const rings = el('div', 'splash-rings');
  for (let i = 0; i < 4; i++) {
    rings.appendChild(el('div', 'splash-ring'));
  }
  // Radar sweep line
  rings.appendChild(el('div', 'splash-scanline'));
  screen.appendChild(rings);

  // Brand
  const brand = el('div', 'splash-brand');
  brand.innerHTML = 'AWA<span>BAND</span>';
  screen.appendChild(brand);

  // Version
  screen.appendChild(el('div', 'splash-version', { text: 'BIOFIELD INTERFACE // v2225.7' }));

  const splashSimulationBadge = buildSimulationBadge('splash-sim-badge');
  if (splashSimulationBadge) {
    screen.appendChild(splashSimulationBadge);
  }

  // Start button
  const btn = el('button', 'splash-btn');
  btn.appendChild(el('span', 'splash-btn-icon'));
  btn.appendChild(document.createTextNode('Начать сканирование'));
  btn.addEventListener('click', () => startScanning());
  screen.appendChild(btn);

  // Footer
  screen.appendChild(el('div', 'splash-footer', { text: 'AWATERRA DYNAMICS \u00b7 SIGNAL RESEARCH DIVISION \u00b7 2225' }));

  return screen;
}

/** Build scanning screen */
function buildScanning() {
  const screen = el('div', 'screen');
  screen.id = 'scanning';

  // ── Top bar: back + status + guide + stop ──
  const topbar = el('div', 'scan-topbar');

  const backBtn = el('button', 'scan-back-btn', { text: '\u2190' });
  backBtn.addEventListener('click', () => stopScanning(true));
  topbar.appendChild(backBtn);

  const status = el('div', 'scan-status', { text: '\u041a\u0430\u043b\u0438\u0431\u0440\u043e\u0432\u043a\u0430...' });
  status.id = 'scan-status';
  topbar.appendChild(status);

  const simulationBadge = buildSimulationBadge();
  if (simulationBadge) {
    topbar.appendChild(simulationBadge);
  }

  const hdBtn = el('button', 'scan-hd-btn', { text: 'ФОКУС' });
  hdBtn.id = 'scan-hd-btn';
  hdBtn.addEventListener('click', () => toggleHDMode());
  topbar.appendChild(hdBtn);

  const debugBtn = el('button', 'scan-debug-btn', { text: 'DBG' });
  debugBtn.id = 'scan-debug-btn';
  debugBtn.addEventListener('click', () => toggleDebugPanel());
  topbar.appendChild(debugBtn);

  const guideBtn = el('button', 'scan-guide-btn', { text: '?' });
  guideBtn.addEventListener('click', () => toggleGuideOverlay());
  topbar.appendChild(guideBtn);

  const exportBtn = el('button', 'scan-export-btn', { text: 'JSON' });
  exportBtn.addEventListener('click', () => saveScanExport({ announce: true, liveMode: true }));
  topbar.appendChild(exportBtn);

  const stopBtn = el('button', 'scan-stop-btn', { html: '&#9632;' });
  stopBtn.addEventListener('click', () => stopScanning());
  topbar.appendChild(stopBtn);

  screen.appendChild(topbar);

  const sensorStrip = el('div', 'scan-sensor-strip');
  sensorStrip.id = 'scan-sensor-strip';
  for (const [key, meta] of Object.entries(SENSOR_META)) {
    const defaultState = key === 'hdMode' ? 'off' : 'pending';
    const chip = el('div', `scan-sensor-chip state-${defaultState}`);
    chip.id = meta.id;
    chip.innerHTML = `
      <span class="scan-sensor-label">${meta.label}</span>
      <span class="scan-sensor-value">${formatSensorState(key, defaultState)}</span>
    `;
    sensorStrip.appendChild(chip);
  }
  screen.appendChild(sensorStrip);

  const debugPanel = el('div', 'scan-debug-panel');
  debugPanel.id = 'scan-debug-panel';
  screen.appendChild(debugPanel);

  // ── Camera viewport (contained) ──
  const viewport = el('div', 'scan-viewport');

  const video = el('video', 'scan-video', { playsinline: '', autoplay: '' });
  video.id = 'scan-video';
  video.muted = true;
  viewport.appendChild(video);

  // Aura overlay canvas
  const auraCanvas = el('canvas', 'scan-aura-canvas');
  auraCanvas.id = 'scan-aura-canvas';
  viewport.appendChild(auraCanvas);

  // Hidden offscreen canvas for pixel extraction
  const offscreen = el('canvas', '');
  offscreen.id = 'scan-offscreen';
  offscreen.style.display = 'none';
  viewport.appendChild(offscreen);

  // HUD overlay — inside viewport
  const hud = el('div', 'hud-overlay');
  hud.appendChild(el('div', 'hud-corner hud-corner--tl'));
  hud.appendChild(el('div', 'hud-corner hud-corner--tr'));
  hud.appendChild(el('div', 'hud-corner hud-corner--bl'));
  hud.appendChild(el('div', 'hud-corner hud-corner--br'));
  hud.appendChild(el('div', 'hud-scanline'));

  const reticle = el('div', 'hud-reticle');
  reticle.appendChild(el('div', 'hud-reticle-ring'));
  hud.appendChild(reticle);

  const dataTL = el('div', 'hud-data hud-data--tl');
  dataTL.id = 'hud-data-tl';
  dataTL.textContent = 'SIG: ---';
  hud.appendChild(dataTL);

  const dataTR = el('div', 'hud-data hud-data--tr');
  dataTR.id = 'hud-data-tr';
  dataTR.textContent = 'T+00:00';
  hud.appendChild(dataTR);

  // Pulse indicator (bottom of viewport)
  const pulse = el('div', 'pulse-indicator');
  const pulseBar = el('div', 'pulse-indicator-bar');
  pulseBar.id = 'pulse-bar';
  pulse.appendChild(pulseBar);
  hud.appendChild(pulse);

  viewport.appendChild(hud);
  screen.appendChild(viewport);

  // ── AWABAND panel (below viewport) ──
  const panelDiv = el('div', '');
  panelDiv.id = 'scan-panel';
  screen.appendChild(panelDiv);

  // ── Guide overlay ──
  screen.appendChild(buildGuideOverlay());

  return screen;
}

/** Build result screen */
function buildResult() {
  const screen = el('div', 'screen');
  screen.id = 'result';

  // Canvas wrap for aura snapshot
  const canvasWrap = el('div', 'result-canvas-wrap');
  const resultCanvas = el('canvas', 'result-canvas');
  resultCanvas.id = 'result-canvas';
  canvasWrap.appendChild(resultCanvas);
  screen.appendChild(canvasWrap);

  // Panel container for final values
  const panelDiv = el('div', '');
  panelDiv.id = 'result-panel';
  screen.appendChild(panelDiv);

  const diagnostics = el('div', 'result-diagnostics');
  diagnostics.id = 'result-diagnostics';
  screen.appendChild(diagnostics);

  // Action buttons
  const actions = el('div', 'result-actions');

  const newScanBtn = el('button', 'result-btn', { text: '\u041d\u043e\u0432\u043e\u0435 \u0441\u043a\u0430\u043d\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435' });
  newScanBtn.addEventListener('click', () => showScreen('splash'));

  const exportJsonBtn = el('button', 'result-btn', { text: 'Экспорт JSON' });
  exportJsonBtn.addEventListener('click', () => saveScanExport());

  const saveBtn = el('button', 'result-btn result-btn-primary', { text: '\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c PNG' });
  saveBtn.addEventListener('click', () => saveSnapshot());

  actions.appendChild(newScanBtn);
  actions.appendChild(exportJsonBtn);
  actions.appendChild(saveBtn);
  screen.appendChild(actions);

  return screen;
}

/** Toggle guide overlay visibility */
function toggleGuideOverlay() {
  const overlay = document.getElementById('guide-overlay');
  if (!overlay) return;
  overlay.classList.toggle('open');
}

/** Build guide overlay (inside scanning screen) */
function buildGuideOverlay() {
  return createGuideOverlay({ onClose: toggleGuideOverlay });
}

/** Toggle focus mode */
async function toggleHDMode() {
  if (!scanSession) return;
  await scanSession.toggleHD();
}
/** Show a temporary toast message */
function showToast(msg) {
  let toast = document.getElementById('scan-toast');
  if (!toast) {
    toast = el('div', 'scan-toast');
    toast.id = 'scan-toast';
    document.querySelector('#scanning')?.appendChild(toast);
  }
  if (toast.textContent === msg && toast.classList.contains('visible')) return;
  toast.textContent = msg;
  toast.classList.add('visible');
  if (toastHideTimer) clearTimeout(toastHideTimer);
  toastHideTimer = setTimeout(() => {
    toast.classList.remove('visible');
    toastHideTimer = null;
  }, 3000);
}

/** Start the scanning session */
async function startScanning() {
  showScreen('scanning');
  if (scanSession) {
    applyScanState(scanSession.stop());
    scanSession = null;
  }

  const scanVideo = document.getElementById('scan-video');
  const scanAuraCanvas = document.getElementById('scan-aura-canvas');
  const scanOffscreen = document.getElementById('scan-offscreen');
  const scanPanelDiv = document.getElementById('scan-panel');
  const scanHudDataTL = document.getElementById('hud-data-tl');
  const scanHudDataTR = document.getElementById('hud-data-tr');
  const scanPulseBar = document.getElementById('pulse-bar');
  const scanHdBtn = document.getElementById('scan-hd-btn');

  resetRuntimeState();
  updateDebugPanel();

  scanSession = new ScanSession({
    video: scanVideo,
    auraCanvas: scanAuraCanvas,
    offscreen: scanOffscreen,
    panelDiv: scanPanelDiv,
    hudDataTL: scanHudDataTL,
    hudDataTR: scanHudDataTR,
    pulseBar: scanPulseBar,
    hdButton: scanHdBtn,
    setStatusText,
    updateSensorStrip,
    updateDiagnostics: () => updateResultDiagnostics(),
    showToast,
    onScanState: (state) => applyScanState(state),
    simulation: SIMULATION,
  });

  await scanSession.start();
}

/** Stop scanning and show results (or go back to splash) */
function stopScanning(goBack = false) {
  if (scanSession) {
    applyScanState(scanSession.stop());
    scanSession = null;
  }

  const snapshotCanvas = document.getElementById('result-canvas');
  const snapshotPanel = document.getElementById('result-panel');

  if (lastBiofield && snapshotCanvas) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    snapshotCanvas.width = w;
    snapshotCanvas.height = h;

    const ctx = snapshotCanvas.getContext('2d');
    ctx.fillStyle = '#060910';
    ctx.fillRect(0, 0, w, h);

    const snapshotAura = new AuraRenderer(snapshotCanvas);
    snapshotAura.resize(w, h);
    snapshotAura.render(lastBiofield, null);
  }

  if (goBack) {
    updateDebugPanel();
    showScreen('splash');
    return;
  }

  if (lastBiofield && snapshotPanel) {
    const panel = new AwabandPanel(snapshotPanel);
    panel.update(lastBiofield);
  }

  updateResultDiagnostics();
  showScreen('result');
}

/** Save aura snapshot as PNG */
function saveSnapshot() {
  const canvas = document.getElementById('result-canvas');
  if (!canvas) return;
  canvas.toBlob((blob) => {
    if (!blob) return;
    downloadBlob('awaband-scan.png', blob);
  }, 'image/png');
}

function saveScanExport({ announce = false, liveMode = false } = {}) {
  if (!lastScanExport && scanSession) {
    applyScanState(scanSession.getState());
  }
  if (!lastScanExport) {
    if (announce) {
      showToast('JSON пока недоступен — дождитесь первых данных скана');
    }
    return false;
  }
  const payload = JSON.stringify(lastScanExport, null, 2);
  downloadBlob('awaband-scan.json', new Blob([payload], { type: 'application/json' }));
  if (announce) {
    showToast(liveMode ? 'JSON экспорт сохранён без перехода на результат' : 'JSON экспорт сохранён');
  }
  return true;
}

/** Initialize the app */
function init() {
  const app = document.getElementById('app');
  if (!app) return;

  // Background layers (shared)
  app.appendChild(el('div', 'bg-mesh'));
  app.appendChild(el('div', 'bg-noise'));
  app.appendChild(el('div', 'bg-grid'));

  app.appendChild(buildSplash());
  app.appendChild(buildScanning());
  app.appendChild(buildResult());
}

// Boot
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
