// AWABAND Scanner — Biophotonic Medical HUD
// Awaterra 2225 Universe

import { startCamera, stopCamera, getForeheadROI, extractROIPixels } from './camera.js';
import { RPPGProcessor } from './rppg.js';
import { calculateHRV, calculateBreathingRate, calculateCoherence, calculateLFHF, calculateBaevskySI } from './vitals.js';
import { VibraimageProcessor } from './vibraimage.js';
import { VoiceAnalyzer } from './voice.js';
import { mapToBiofield } from './biofield.js';
import { AuraRenderer } from './aura.js';
import { AwabandPanel } from './awaband-panel.js';

const SCREENS = ['splash', 'scanning', 'result'];

// ── Scanning state ──
let stream = null;
let voiceAnalyzer = null;
let animFrameId = null;
let rppg = null;
let vibraimageProc = null;
let auraRenderer = null;
let awabandPanel = null;
let lastBiofield = null;
let smoothedBiofield = null;
let lastHR = null;
let frameCount = 0;
let scanStartTime = null;

const EMA_ALPHA = 0.15;

/** Exponential moving average for biofield parameters */
function smoothBiofield(raw, prev) {
  if (!prev) return { ...raw };
  const result = {};
  for (const key of Object.keys(raw)) {
    result[key] = Math.round(prev[key] * (1 - EMA_ALPHA) + raw[key] * EMA_ALPHA);
  }
  return result;
}

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
  screen.appendChild(el('div', 'splash-version', { text: 'BIOFIELD SCANNER // v2225.7' }));

  // Start button
  const btn = el('button', 'splash-btn');
  btn.appendChild(el('span', 'splash-btn-icon'));
  btn.appendChild(document.createTextNode('Начать сканирование'));
  btn.addEventListener('click', () => startScanning());
  screen.appendChild(btn);

  // Footer
  screen.appendChild(el('div', 'splash-footer', { text: 'AWATERRA DYNAMICS \u00b7 MED-TECH DIVISION \u00b7 2225' }));

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

  const guideBtn = el('button', 'scan-guide-btn', { text: '?' });
  guideBtn.addEventListener('click', () => toggleGuideOverlay());
  topbar.appendChild(guideBtn);

  const stopBtn = el('button', 'scan-stop-btn', { html: '&#9632;' });
  stopBtn.addEventListener('click', () => stopScanning());
  topbar.appendChild(stopBtn);

  screen.appendChild(topbar);

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

  // Action buttons
  const actions = el('div', 'result-actions');

  const newScanBtn = el('button', 'result-btn', { text: '\u041d\u043e\u0432\u043e\u0435 \u0441\u043a\u0430\u043d\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435' });
  newScanBtn.addEventListener('click', () => showScreen('splash'));

  const saveBtn = el('button', 'result-btn result-btn-primary', { text: '\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c' });
  saveBtn.addEventListener('click', () => saveSnapshot());

  actions.appendChild(newScanBtn);
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
  const overlay = el('div', 'guide-overlay');
  overlay.id = 'guide-overlay';

  // Backdrop (click to close)
  const backdrop = el('div', 'guide-backdrop');
  backdrop.addEventListener('click', () => toggleGuideOverlay());
  overlay.appendChild(backdrop);

  const panel = el('div', 'guide-panel');
  const inner = el('div', 'guide-scroll');

  // Header
  const header = el('div', 'guide-header');
  header.appendChild(el('div', 'guide-title', { text: '\u041a\u0430\u043a \u044d\u0442\u043e \u0440\u0430\u0431\u043e\u0442\u0430\u0435\u0442' }));
  const closeBtn = el('button', 'guide-close', { text: '\u2715' });
  closeBtn.addEventListener('click', () => toggleGuideOverlay());
  header.appendChild(closeBtn);
  inner.appendChild(header);

  // Intro
  inner.appendChild(el('p', 'guide-intro', {
    text: 'AWABAND Scanner \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0435\u0442 \u043a\u0430\u043c\u0435\u0440\u0443 \u0438 \u043c\u0438\u043a\u0440\u043e\u0444\u043e\u043d \u0442\u0435\u043b\u0435\u0444\u043e\u043d\u0430 \u0434\u043b\u044f \u0430\u043d\u0430\u043b\u0438\u0437\u0430 \u0440\u0435\u0430\u043b\u044c\u043d\u044b\u0445 \u0444\u0438\u0437\u0438\u043e\u043b\u043e\u0433\u0438\u0447\u0435\u0441\u043a\u0438\u0445 \u0441\u0438\u0433\u043d\u0430\u043b\u043e\u0432 \u0438 \u043f\u0435\u0440\u0435\u0432\u043e\u0434\u0438\u0442 \u0438\u0445 \u0432 7 \u043f\u0430\u0440\u0430\u043c\u0435\u0442\u0440\u043e\u0432 \u0431\u0438\u043e\u043f\u043e\u043b\u044f \u0432\u0441\u0435\u043b\u0435\u043d\u043d\u043e\u0439 Awaterra. \u0422\u0440\u0438 \u043a\u0430\u043d\u0430\u043b\u0430 \u0434\u0430\u043d\u043d\u044b\u0445: \u043f\u0443\u043b\u044c\u0441 \u0438 \u043c\u0438\u043a\u0440\u043e\u0434\u0432\u0438\u0436\u0435\u043d\u0438\u044f \u0438\u0437 \u043a\u0430\u043c\u0435\u0440\u044b, \u0433\u043e\u043b\u043e\u0441\u043e\u0432\u044b\u0435 \u0431\u0438\u043e\u043c\u0430\u0440\u043a\u0435\u0440\u044b \u0438\u0437 \u043c\u0438\u043a\u0440\u043e\u0444\u043e\u043d\u0430.'
  }));

  // ── SECTION 1: Camera — rPPG ──
  const camSec = el('div', 'guide-section');
  camSec.innerHTML = `
    <div class="guide-section-title">\ud83d\udcf7 \u041a\u0430\u043c\u0435\u0440\u0430: \u043f\u0443\u043b\u044c\u0441 \u0447\u0435\u0440\u0435\u0437 \u043a\u043e\u0436\u0443</div>
    <p class="guide-section-text">\u041a\u043e\u0436\u0430 \u043b\u0438\u0446\u0430 \u043c\u0435\u043d\u044f\u0435\u0442 \u0446\u0432\u0435\u0442 \u0441 \u043a\u0430\u0436\u0434\u044b\u043c \u0443\u0434\u0430\u0440\u043e\u043c \u0441\u0435\u0440\u0434\u0446\u0430. \u041a\u0430\u043c\u0435\u0440\u0430 \u043b\u043e\u0432\u0438\u0442 \u044d\u0442\u0438 \u043c\u0438\u043a\u0440\u043e\u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f \u0430\u043b\u0433\u043e\u0440\u0438\u0442\u043c\u043e\u043c <strong>CHROM</strong> (<em>De Haan & Jeanne</em>, Philips Research, 2013).</p>
    <p class="guide-section-text">\u0418\u0437 \u043f\u0443\u043b\u044c\u0441\u043e\u0432\u043e\u0433\u043e \u0441\u0438\u0433\u043d\u0430\u043b\u0430 \u0438\u0437\u0432\u043b\u0435\u043a\u0430\u0435\u043c:</p>
    <ul class="guide-list">
      <li><strong>HR</strong> \u2014 \u0447\u0430\u0441\u0442\u043e\u0442\u0430 \u043f\u0443\u043b\u044c\u0441\u0430 \u0447\u0435\u0440\u0435\u0437 \u0441\u043f\u0435\u043a\u0442\u0440\u0430\u043b\u044c\u043d\u044b\u0439 \u0430\u043d\u0430\u043b\u0438\u0437 (\u0414\u041f\u0424)</li>
      <li><strong>HRV</strong> \u2014 \u0432\u0430\u0440\u0438\u0430\u0431\u0435\u043b\u044c\u043d\u043e\u0441\u0442\u044c \u0440\u0438\u0442\u043c\u0430: RMSSD, SDNN, pNN50 (<em>Task Force of ESC, 1996</em>)</li>
      <li><strong>LF/HF</strong> \u2014 \u0431\u0430\u043b\u0430\u043d\u0441 \u0441\u0438\u043c\u043f\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u043e\u0439 \u0438 \u043f\u0430\u0440\u0430\u0441\u0438\u043c\u043f\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u043e\u0439 \u043d\u0435\u0440\u0432\u043d\u043e\u0439 \u0441\u0438\u0441\u0442\u0435\u043c\u044b</li>
      <li><strong>\u0418\u043d\u0434\u0435\u043a\u0441 \u0441\u0442\u0440\u0435\u0441\u0441\u0430 \u0411\u0430\u0435\u0432\u0441\u043a\u043e\u0433\u043e</strong> \u2014 SI = AMo/(2\u00b7Mo\u00b7MxDMn), \u043e\u0446\u0435\u043d\u043a\u0430 \u043d\u0430\u043f\u0440\u044f\u0436\u0435\u043d\u0438\u044f \u0412\u041d\u0421 (<em>\u0411\u0430\u0435\u0432\u0441\u043a\u0438\u0439 \u0420.\u041c., 1979</em>)</li>
      <li><strong>\u041a\u043e\u0433\u0435\u0440\u0435\u043d\u0442\u043d\u043e\u0441\u0442\u044c</strong> \u2014 \u043f\u043e \u043c\u0435\u0442\u043e\u0434\u043e\u043b\u043e\u0433\u0438\u0438 <em>HeartMath Institute</em> (<em>McCraty et al., 2009</em>)</li>
      <li><strong>\u0414\u044b\u0445\u0430\u043d\u0438\u0435</strong> \u2014 \u0447\u0430\u0441\u0442\u043e\u0442\u0430 \u0434\u044b\u0445\u0430\u043d\u0438\u044f \u0438\u0437 \u0434\u044b\u0445\u0430\u0442\u0435\u043b\u044c\u043d\u043e\u0439 \u0441\u0438\u043d\u0443\u0441\u043e\u0432\u043e\u0439 \u0430\u0440\u0438\u0442\u043c\u0438\u0438 (RSA)</li>
    </ul>
    <p class="guide-ref">\u041b\u0438\u0442\u0435\u0440\u0430\u0442\u0443\u0440\u0430: De Haan & Jeanne, \u00abRobust Pulse Rate from Chrominance-Based rPPG\u00bb, IEEE Trans. Biomed. Eng., 2013</p>
  `;
  inner.appendChild(camSec);

  // ── SECTION 2: Camera — Vibraimage ──
  const vibSec = el('div', 'guide-section');
  vibSec.innerHTML = `
    <div class="guide-section-title">\ud83d\udd2c \u041a\u0430\u043c\u0435\u0440\u0430: \u043c\u0438\u043a\u0440\u043e\u0434\u0432\u0438\u0436\u0435\u043d\u0438\u044f (Vibraimage)</div>
    <p class="guide-section-text">\u0413\u043e\u043b\u043e\u0432\u0430 \u0447\u0435\u043b\u043e\u0432\u0435\u043a\u0430 \u043d\u0435\u043f\u0440\u0435\u0440\u044b\u0432\u043d\u043e \u0441\u043e\u0432\u0435\u0440\u0448\u0430\u0435\u0442 \u043d\u0435\u0437\u0430\u043c\u0435\u0442\u043d\u044b\u0435 \u043c\u0438\u043a\u0440\u043e\u0434\u0432\u0438\u0436\u0435\u043d\u0438\u044f (tremor) \u2014 \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442 \u0440\u0430\u0431\u043e\u0442\u044b \u043c\u044b\u0448\u0446 \u0438 \u043d\u0435\u0440\u0432\u043d\u043e\u0439 \u0441\u0438\u0441\u0442\u0435\u043c\u044b. \u041c\u044b \u0430\u043d\u0430\u043b\u0438\u0437\u0438\u0440\u0443\u0435\u043c \u0440\u0430\u0437\u043d\u0438\u0446\u0443 \u043c\u0435\u0436\u0434\u0443 \u043a\u0430\u0434\u0440\u0430\u043c\u0438 \u0432\u0438\u0434\u0435\u043e \u043d\u0430 \u0443\u0440\u043e\u0432\u043d\u0435 \u043f\u0438\u043a\u0441\u0435\u043b\u0435\u0439 \u043f\u043e \u043c\u0435\u0442\u043e\u0434\u043e\u043b\u043e\u0433\u0438\u0438 <em>\u0412\u0438\u043a\u0442\u043e\u0440\u0430 \u041c\u0438\u043d\u043a\u0438\u043d\u0430</em>.</p>
    <p class="guide-section-text">\u0418\u0437\u0432\u043b\u0435\u043a\u0430\u0435\u043c\u044b\u0435 \u043c\u0435\u0442\u0440\u0438\u043a\u0438:</p>
    <ul class="guide-list">
      <li><strong>\u0410\u043c\u043f\u043b\u0438\u0442\u0443\u0434\u0430</strong> \u2014 \u0441\u0440\u0435\u0434\u043d\u044f\u044f \u0432\u0435\u043b\u0438\u0447\u0438\u043d\u0430 \u043c\u0438\u043a\u0440\u043e\u0434\u0432\u0438\u0436\u0435\u043d\u0438\u0439. \u0423\u043c\u0435\u0440\u0435\u043d\u043d\u0430\u044f = \u0436\u0438\u0432\u043e\u0439 \u0442\u043e\u043d\u0443\u0441, \u0438\u0437\u0431\u044b\u0442\u043e\u0447\u043d\u0430\u044f = \u0442\u0440\u0435\u0432\u043e\u0436\u043d\u043e\u0441\u0442\u044c</li>
      <li><strong>\u0427\u0430\u0441\u0442\u043e\u0442\u0430</strong> \u2014 \u0441\u043a\u043e\u0440\u043e\u0441\u0442\u044c \u043e\u0441\u0446\u0438\u043b\u043b\u044f\u0446\u0438\u0439 \u043c\u0438\u043a\u0440\u043e\u0442\u0440\u0435\u043c\u043e\u0440\u0430 (2\u201315 \u0413\u0446)</li>
      <li><strong>\u0421\u0438\u043c\u043c\u0435\u0442\u0440\u0438\u044f</strong> \u2014 \u0431\u0430\u043b\u0430\u043d\u0441 \u043b\u0435\u0432\u043e\u0439 \u0438 \u043f\u0440\u0430\u0432\u043e\u0439 \u0441\u0442\u043e\u0440\u043e\u043d\u044b \u043b\u0438\u0446\u0430. \u0412\u044b\u0441\u043e\u043a\u0430\u044f = \u0432\u043d\u0443\u0442\u0440\u0435\u043d\u043d\u0438\u0439 \u0431\u0430\u043b\u0430\u043d\u0441</li>
      <li><strong>\u042d\u043d\u0442\u0440\u043e\u043f\u0438\u044f</strong> \u2014 \u0440\u0435\u0433\u0443\u043b\u044f\u0440\u043d\u043e\u0441\u0442\u044c \u043f\u0430\u0442\u0442\u0435\u0440\u043d\u043e\u0432 \u0434\u0432\u0438\u0436\u0435\u043d\u0438\u044f (\u044d\u043d\u0442\u0440\u043e\u043f\u0438\u044f \u0428\u0435\u043d\u043d\u043e\u043d\u0430)</li>
    </ul>
    <p class="guide-ref">\u041b\u0438\u0442\u0435\u0440\u0430\u0442\u0443\u0440\u0430: Minkin V.A., \u00abVibraimage\u00bb, 2007; \u041c\u0438\u043d\u043a\u0438\u043d \u0412.\u0410., \u00ab\u0412\u0438\u0431\u0440\u0430\u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0435, \u043a\u0438\u0431\u0435\u0440\u043d\u0435\u0442\u0438\u043a\u0430 \u0438 \u044d\u043c\u043e\u0446\u0438\u0438\u00bb, 2020</p>
  `;
  inner.appendChild(vibSec);

  // ── SECTION 3: Microphone ──
  const micSec = el('div', 'guide-section');
  micSec.innerHTML = `
    <div class="guide-section-title">\ud83c\udfa4 \u041c\u0438\u043a\u0440\u043e\u0444\u043e\u043d: \u0433\u043e\u043b\u043e\u0441\u043e\u0432\u044b\u0435 \u0431\u0438\u043e\u043c\u0430\u0440\u043a\u0435\u0440\u044b</div>
    <p class="guide-section-text">\u0413\u043e\u043b\u043e\u0441 \u043d\u0435\u0441\u0451\u0442 \u0438\u043d\u0444\u043e\u0440\u043c\u0430\u0446\u0438\u044e \u043e \u043f\u0441\u0438\u0445\u043e\u044d\u043c\u043e\u0446\u0438\u043e\u043d\u0430\u043b\u044c\u043d\u043e\u043c \u0441\u043e\u0441\u0442\u043e\u044f\u043d\u0438\u0438. \u0412\u043e \u0432\u0440\u0435\u043c\u044f \u0441\u043a\u0430\u043d\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u044f \u043c\u043e\u0436\u043d\u043e \u0433\u043e\u0432\u043e\u0440\u0438\u0442\u044c \u2014 \u0438\u043b\u0438 \u043c\u043e\u043b\u0447\u0430\u0442\u044c (\u0433\u043e\u043b\u043e\u0441\u043e\u0432\u044b\u0435 \u043f\u0430\u0440\u0430\u043c\u0435\u0442\u0440\u044b \u0431\u0443\u0434\u0443\u0442 \u043d\u0435\u0439\u0442\u0440\u0430\u043b\u044c\u043d\u044b\u043c\u0438).</p>
    <p class="guide-section-text">\u0410\u043d\u0430\u043b\u0438\u0437\u0438\u0440\u0443\u0435\u043c:</p>
    <ul class="guide-list">
      <li><strong>Pitch (F0)</strong> \u2014 \u043e\u0441\u043d\u043e\u0432\u043d\u043e\u0439 \u0442\u043e\u043d \u0433\u043e\u043b\u043e\u0441\u0430 \u0447\u0435\u0440\u0435\u0437 \u0430\u0432\u0442\u043e\u043a\u043e\u0440\u0440\u0435\u043b\u044f\u0446\u0438\u044e. \u0421\u0442\u0440\u0435\u0441\u0441 \u043f\u043e\u0432\u044b\u0448\u0430\u0435\u0442 \u0442\u043e\u043d, \u0440\u0430\u0441\u0441\u043b\u0430\u0431\u043b\u0435\u043d\u0438\u0435 \u043f\u043e\u043d\u0438\u0436\u0430\u0435\u0442</li>
      <li><strong>Jitter / Shimmer</strong> \u2014 \u043c\u0438\u043a\u0440\u043e\u043a\u043e\u043b\u0435\u0431\u0430\u043d\u0438\u044f \u0447\u0430\u0441\u0442\u043e\u0442\u044b \u0438 \u0433\u0440\u043e\u043c\u043a\u043e\u0441\u0442\u0438 (<em>Titze, 1994</em>)</li>
      <li><strong>HNR</strong> \u2014 \u0433\u0430\u0440\u043c\u043e\u043d\u0438\u043a\u0438 \u0432\u0441. \u0448\u0443\u043c (<em>Boersma, 1993</em>). \u0427\u0438\u0441\u0442\u044b\u0439 \u0433\u043e\u043b\u043e\u0441 = \u0432\u044b\u0441\u043e\u043a\u0438\u0439 HNR</li>
      <li><strong>\u0424\u043e\u0440\u043c\u0430\u043d\u0442\u044b (F1/F2/F3)</strong> \u2014 \u0440\u0435\u0437\u043e\u043d\u0430\u043d\u0441\u043d\u044b\u0435 \u0447\u0430\u0441\u0442\u043e\u0442\u044b \u0433\u043e\u043b\u043e\u0441\u043e\u0432\u043e\u0433\u043e \u0442\u0440\u0430\u043a\u0442\u0430. F1 \u043e\u0442\u0440\u0430\u0436\u0430\u0435\u0442 \u043e\u0442\u043a\u0440\u044b\u0442\u043e\u0441\u0442\u044c \u0433\u043b\u043e\u0442\u043a\u0438, F2 \u2014 \u043f\u043e\u043b\u043e\u0436\u0435\u043d\u0438\u0435 \u044f\u0437\u044b\u043a\u0430. \u0421\u0436\u0430\u0442\u043e\u0435 \u0433\u043e\u0440\u043b\u043e \u043f\u0440\u0438 \u0441\u0442\u0440\u0435\u0441\u0441\u0435 \u043c\u0435\u043d\u044f\u0435\u0442 \u0444\u043e\u0440\u043c\u0430\u043d\u0442\u044b</li>
      <li><strong>\u0421\u043f\u0435\u043a\u0442\u0440\u0430\u043b\u044c\u043d\u044b\u0439 \u0446\u0435\u043d\u0442\u0440\u043e\u0438\u0434</strong> \u2014 \u00ab\u044f\u0440\u043a\u043e\u0441\u0442\u044c\u00bb \u0437\u0432\u0443\u0447\u0430\u043d\u0438\u044f (\u0446\u0435\u043d\u0442\u0440 \u0442\u044f\u0436\u0435\u0441\u0442\u0438 \u0447\u0430\u0441\u0442\u043e\u0442)</li>
    </ul>
    <p class="guide-ref">\u041b\u0438\u0442\u0435\u0440\u0430\u0442\u0443\u0440\u0430: Titze, \u00abPrinciples of Voice Production\u00bb, 1994; Boersma, 1993; Rabiner & Schafer, 1978</p>
  `;
  inner.appendChild(micSec);

  // ── SECTION 4: VoiceBio ──
  const vbSec = el('div', 'guide-section');
  vbSec.innerHTML = `
    <div class="guide-section-title">\ud83c\udfb5 VoiceBio: \u0433\u043e\u043b\u043e\u0441 \u2192 \u044d\u043d\u0435\u0440\u0433\u0435\u0442\u0438\u0447\u0435\u0441\u043a\u0438\u0439 \u0446\u0435\u043d\u0442\u0440</div>
    <p class="guide-section-text">\u041e\u0441\u043d\u043e\u0432\u043d\u043e\u0439 \u0442\u043e\u043d \u0433\u043e\u043b\u043e\u0441\u0430 \u0441\u043a\u043b\u0430\u0434\u044b\u0432\u0430\u0435\u0442\u0441\u044f \u0432 \u0431\u0430\u0437\u043e\u0432\u0443\u044e \u043e\u043a\u0442\u0430\u0432\u0443 (C3\u2013B3) \u0438 \u0441\u043e\u043f\u043e\u0441\u0442\u0430\u0432\u043b\u044f\u0435\u0442\u0441\u044f \u0441 \u043e\u0434\u043d\u0438\u043c \u0438\u0437 7 \u044d\u043d\u0435\u0440\u0433\u0435\u0442\u0438\u0447\u0435\u0441\u043a\u0438\u0445 \u0446\u0435\u043d\u0442\u0440\u043e\u0432 \u043f\u043e \u043c\u0435\u0442\u043e\u0434\u043e\u043b\u043e\u0433\u0438\u0438 <em>VoiceBio / Sound Health</em>.</p>
    <p class="guide-section-text">\u041a\u043e\u0433\u0434\u0430 \u0432\u044b \u0433\u043e\u0432\u043e\u0440\u0438\u0442\u0435, \u0430\u0443\u0440\u0430 \u043f\u043e\u0434\u0441\u0432\u0435\u0447\u0438\u0432\u0430\u0435\u0442 \u0441\u043b\u043e\u0439, \u0441\u043e\u043e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0443\u044e\u0449\u0438\u0439 \u0432\u0430\u0448\u0435\u0439 \u0442\u0435\u043a\u0443\u0449\u0435\u0439 \u0447\u0430\u0441\u0442\u043e\u0442\u0435. \u041d\u043e\u0442\u0430 C \u2192 \u0421\u0442\u0430\u0431\u0438\u043b\u044c\u043d\u043e\u0441\u0442\u044c, D \u2192 \u041f\u043e\u0442\u043e\u043a, E \u2192 \u042d\u043d\u0435\u0440\u0433\u0438\u044f, F \u2192 \u0420\u0435\u0437\u043e\u043d\u0430\u043d\u0441, G \u2192 \u0412\u0438\u0431\u0440\u0430\u0446\u0438\u044f, A \u2192 \u042f\u0441\u043d\u043e\u0441\u0442\u044c, B \u2192 \u0426\u0435\u043b\u043e\u0441\u0442\u043d\u043e\u0441\u0442\u044c.</p>
  `;
  inner.appendChild(vbSec);

  // ── SECTION 5: Sacred Geometry ──
  const sgSec = el('div', 'guide-section');
  sgSec.innerHTML = `
    <div class="guide-section-title">\u2b50 \u0421\u0430\u043a\u0440\u0430\u043b\u044c\u043d\u0430\u044f \u0433\u0435\u043e\u043c\u0435\u0442\u0440\u0438\u044f</div>
    <p class="guide-section-text">\u041f\u043e\u0432\u0435\u0440\u0445 \u0441\u0432\u0435\u0447\u0435\u043d\u0438\u044f \u0430\u0443\u0440\u044b \u0440\u0438\u0441\u0443\u044e\u0442\u0441\u044f \u0434\u0438\u043d\u0430\u043c\u0438\u0447\u0435\u0441\u043a\u0438\u0435 \u043f\u0430\u0442\u0442\u0435\u0440\u043d\u044b, \u0440\u0435\u0430\u0433\u0438\u0440\u0443\u044e\u0449\u0438\u0435 \u043d\u0430 \u0432\u0430\u0448\u0438 \u043f\u043e\u043a\u0430\u0437\u0430\u0442\u0435\u043b\u0438:</p>
    <ul class="guide-list">
      <li><strong>\u0426\u0432\u0435\u0442\u043e\u043a \u0416\u0438\u0437\u043d\u0438</strong> \u2014 6 \u043f\u0435\u0440\u0435\u0441\u0435\u043a\u0430\u044e\u0449\u0438\u0445\u0441\u044f \u043a\u0440\u0443\u0433\u043e\u0432, \u0440\u0430\u0437\u043c\u0435\u0440 \u0437\u0430\u0432\u0438\u0441\u0438\u0442 \u043e\u0442 <em>\u0420\u0435\u0437\u043e\u043d\u0430\u043d\u0441\u0430</em></li>
      <li><strong>\u0422\u0440\u0435\u0443\u0433\u043e\u043b\u044c\u043d\u0438\u043a\u0438 \u0428\u0440\u0438 \u042f\u043d\u0442\u0440\u044b</strong> \u2014 \u0434\u0432\u0430 \u0432\u0440\u0430\u0449\u0430\u044e\u0449\u0438\u0445\u0441\u044f \u0442\u0440\u0435\u0443\u0433\u043e\u043b\u044c\u043d\u0438\u043a\u0430 (\u0432\u0432\u0435\u0440\u0445/\u0432\u043d\u0438\u0437), \u0440\u0430\u0437\u043c\u0435\u0440 \u043e\u0442 <em>\u0426\u0435\u043b\u043e\u0441\u0442\u043d\u043e\u0441\u0442\u0438</em></li>
      <li><strong>\u0421\u043f\u0438\u0440\u0430\u043b\u0438</strong> \u2014 3 \u0441\u043f\u0438\u0440\u0430\u043b\u044c\u043d\u044b\u0445 \u0440\u0443\u043a\u0430\u0432\u0430, \u0438\u043d\u0442\u0435\u043d\u0441\u0438\u0432\u043d\u043e\u0441\u0442\u044c \u043e\u0442 <em>\u042d\u043d\u0435\u0440\u0433\u0438\u0438 + \u041f\u043e\u0442\u043e\u043a\u0430</em></li>
      <li><strong>\u041f\u0443\u043b\u044c\u0441\u0438\u0440\u0443\u044e\u0449\u0438\u0435 \u0442\u043e\u0447\u043a\u0438</strong> \u2014 12 \u0432\u0435\u0440\u0448\u0438\u043d\u043d\u044b\u0445 \u043c\u0430\u0440\u043a\u0435\u0440\u043e\u0432, \u0443\u043f\u0440\u0430\u0432\u043b\u044f\u044e\u0442\u0441\u044f <em>\u0412\u0438\u0431\u0440\u0430\u0446\u0438\u0435\u0439</em></li>
    </ul>
    <p class="guide-section-text">\u041f\u0430\u0442\u0442\u0435\u0440\u043d\u044b \u043f\u043e\u044f\u0432\u043b\u044f\u044e\u0442\u0441\u044f \u043f\u043e\u0441\u0442\u0435\u043f\u0435\u043d\u043d\u043e \u043f\u043e \u043c\u0435\u0440\u0435 \u0440\u043e\u0441\u0442\u0430 \u043f\u043e\u043a\u0430\u0437\u0430\u0442\u0435\u043b\u0435\u0439. \u041f\u0440\u0438 \u043d\u0438\u0437\u043a\u0438\u0445 \u0437\u043d\u0430\u0447\u0435\u043d\u0438\u044f\u0445 \u0433\u0435\u043e\u043c\u0435\u0442\u0440\u0438\u044f \u043f\u043e\u0447\u0442\u0438 \u043d\u0435\u0432\u0438\u0434\u0438\u043c\u0430.</p>
  `;
  inner.appendChild(sgSec);

  // Divider
  inner.appendChild(el('div', 'guide-divider'));
  inner.appendChild(el('div', 'guide-subtitle', { text: '7 \u043f\u0430\u0440\u0430\u043c\u0435\u0442\u0440\u043e\u0432 \u0431\u0438\u043e\u043f\u043e\u043b\u044f' }));

  inner.appendChild(el('p', 'guide-section-text guide-mapping-intro', {
    text: '\u0422\u0440\u0438 \u043a\u0430\u043d\u0430\u043b\u0430 \u0434\u0430\u043d\u043d\u044b\u0445 (\u043f\u0443\u043b\u044c\u0441, \u043c\u0438\u043a\u0440\u043e\u0434\u0432\u0438\u0436\u0435\u043d\u0438\u044f, \u0433\u043e\u043b\u043e\u0441) \u0441\u043b\u0438\u0432\u0430\u044e\u0442\u0441\u044f \u0432 7 \u043f\u0430\u0440\u0430\u043c\u0435\u0442\u0440\u043e\u0432 \u0432\u0441\u0435\u043b\u0435\u043d\u043d\u043e\u0439 Awaterra. \u041a\u0430\u0436\u0434\u044b\u0439 \u043f\u0430\u0440\u0430\u043c\u0435\u0442\u0440 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0435\u0442 \u0434\u0430\u043d\u043d\u044b\u0435 \u0438\u0437 \u043d\u0435\u0441\u043a\u043e\u043b\u044c\u043a\u0438\u0445 \u0438\u0441\u0442\u043e\u0447\u043d\u0438\u043a\u043e\u0432 \u0434\u043b\u044f \u043c\u0443\u043b\u044c\u0442\u0438\u043c\u043e\u0434\u0430\u043b\u044c\u043d\u043e\u0439 \u043e\u0446\u0435\u043d\u043a\u0438.'
  }));

  // Parameters — updated with new data sources
  const params = [
    {
      name: '\u0421\u0442\u0430\u0431\u0438\u043b\u044c\u043d\u043e\u0441\u0442\u044c', color: '#ff3366', freq: '396 Hz',
      how: 'HRV \u043c\u0435\u0442\u0440\u0438\u043a\u0438 RMSSD \u0438 SDNN \u043e\u0446\u0435\u043d\u0438\u0432\u0430\u044e\u0442 \u0440\u0430\u0432\u043d\u043e\u043c\u0435\u0440\u043d\u043e\u0441\u0442\u044c \u0441\u0435\u0440\u0434\u0435\u0447\u043d\u043e\u0433\u043e \u0440\u0438\u0442\u043c\u0430 (<em>Task Force of ESC, 1996</em>). \u0418\u043d\u0434\u0435\u043a\u0441 \u0441\u0442\u0440\u0435\u0441\u0441\u0430 \u0411\u0430\u0435\u0432\u0441\u043a\u043e\u0433\u043e \u0448\u0442\u0440\u0430\u0444\u0443\u0435\u0442 \u043f\u043e\u043a\u0430\u0437\u0430\u0442\u0435\u043b\u044c \u043f\u0440\u0438 SI > 150. \u0421\u0438\u043c\u043c\u0435\u0442\u0440\u0438\u044f \u043c\u0438\u043a\u0440\u043e\u0434\u0432\u0438\u0436\u0435\u043d\u0438\u0439 \u043b\u0438\u0446\u0430 \u0434\u043e\u0431\u0430\u0432\u043b\u044f\u0435\u0442 \u0431\u043e\u043d\u0443\u0441 \u043a \u0441\u0442\u0430\u0431\u0438\u043b\u044c\u043d\u043e\u0441\u0442\u0438.',
      why: '\u0412\u044b\u0441\u043e\u043a\u0430\u044f \u0441\u0442\u0430\u0431\u0438\u043b\u044c\u043d\u043e\u0441\u0442\u044c = \u043d\u0435\u0440\u0432\u043d\u0430\u044f \u0441\u0438\u0441\u0442\u0435\u043c\u0430 \u0432 \u0431\u0430\u043b\u0430\u043d\u0441\u0435, \u043e\u0440\u0433\u0430\u043d\u0438\u0437\u043c \u0430\u0434\u0430\u043f\u0442\u0438\u0432\u0435\u043d.',
      source: '\u041a\u0430\u043c\u0435\u0440\u0430 \u2192 HRV (RMSSD + SDNN) + \u0441\u0442\u0440\u0435\u0441\u0441-\u0438\u043d\u0434\u0435\u043a\u0441 + vibraimage \u0441\u0438\u043c\u043c\u0435\u0442\u0440\u0438\u044f'
    },
    {
      name: '\u041f\u043e\u0442\u043e\u043a', color: '#ff7a2e', freq: '417 Hz',
      how: '\u041f\u043b\u0430\u0432\u043d\u043e\u0441\u0442\u044c \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f \u043f\u0443\u043b\u044c\u0441\u0430 (EMA-\u0444\u0438\u043b\u044c\u0442\u0440\u0430\u0446\u0438\u044f) + pNN50 \u2014 \u0434\u043e\u043b\u044f \u0438\u043d\u0442\u0435\u0440\u0432\u0430\u043b\u043e\u0432 \u0441 \u0440\u0430\u0437\u043d\u0438\u0446\u0435\u0439 > 50\u043c\u0441 (\u043f\u0430\u0440\u0430\u0441\u0438\u043c\u043f\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0438\u0439 \u0442\u043e\u043d\u0443\u0441). \u041d\u0438\u0437\u043a\u0430\u044f \u044d\u043d\u0442\u0440\u043e\u043f\u0438\u044f \u043c\u0438\u043a\u0440\u043e\u0434\u0432\u0438\u0436\u0435\u043d\u0438\u0439 = \u0440\u0435\u0433\u0443\u043b\u044f\u0440\u043d\u044b\u0435 \u043f\u0430\u0442\u0442\u0435\u0440\u043d\u044b = \u043b\u0443\u0447\u0448\u0438\u0439 \u043f\u043e\u0442\u043e\u043a.',
      why: '\u041f\u043b\u0430\u0432\u043d\u044b\u0439 \u043f\u043e\u0442\u043e\u043a \u2014 \u043e\u0440\u0433\u0430\u043d\u0438\u0437\u043c \u0440\u0430\u0431\u043e\u0442\u0430\u0435\u0442 \u0441\u043b\u0430\u0436\u0435\u043d\u043d\u043e, \u0431\u0435\u0437 \u043f\u0435\u0440\u0435\u0433\u0440\u0443\u0437\u043e\u043a.',
      source: '\u041a\u0430\u043c\u0435\u0440\u0430 \u2192 EMA-\u043f\u0443\u043b\u044c\u0441 + pNN50 + vibraimage \u044d\u043d\u0442\u0440\u043e\u043f\u0438\u044f'
    },
    {
      name: '\u042d\u043d\u0435\u0440\u0433\u0438\u044f', color: '#ffcc00', freq: '528 Hz',
      how: '\u0427\u0430\u0441\u0442\u043e\u0442\u0430 \u043f\u0443\u043b\u044c\u0441\u0430 (\u043e\u043f\u0442\u0438\u043c\u0443\u043c 60\u201380 \u0443\u0434/\u043c\u0438\u043d) + \u0433\u0440\u043e\u043c\u043a\u043e\u0441\u0442\u044c \u0433\u043e\u043b\u043e\u0441\u0430 (RMS) + \u0430\u043c\u043f\u043b\u0438\u0442\u0443\u0434\u0430 \u043c\u0438\u043a\u0440\u043e\u0434\u0432\u0438\u0436\u0435\u043d\u0438\u0439 (\u0443\u043c\u0435\u0440\u0435\u043d\u043d\u044b\u0435 \u0434\u0432\u0438\u0436\u0435\u043d\u0438\u044f = \u0436\u0438\u0437\u043d\u0435\u043d\u043d\u044b\u0439 \u0442\u043e\u043d\u0443\u0441).',
      why: '\u041e\u0431\u0449\u0438\u0439 \u0443\u0440\u043e\u0432\u0435\u043d\u044c \u0430\u043a\u0442\u0438\u0432\u0430\u0446\u0438\u0438. \u0421\u043b\u0438\u0448\u043a\u043e\u043c \u0432\u044b\u0441\u043e\u043a\u0438\u0439 \u043f\u0443\u043b\u044c\u0441 \u0438\u043b\u0438 \u0438\u0437\u0431\u044b\u0442\u043e\u043a \u0434\u0432\u0438\u0436\u0435\u043d\u0438\u0439 \u0441\u043d\u0438\u0436\u0430\u044e\u0442 \u043f\u043e\u043a\u0430\u0437\u0430\u0442\u0435\u043b\u044c.',
      source: '\u041a\u0430\u043c\u0435\u0440\u0430 \u2192 HR + vibraimage \u0430\u043c\u043f\u043b\u0438\u0442\u0443\u0434\u0430 + \u041c\u0438\u043a\u0440\u043e\u0444\u043e\u043d \u2192 RMS'
    },
    {
      name: '\u0420\u0435\u0437\u043e\u043d\u0430\u043d\u0441', color: '#00ff99', freq: '639 Hz',
      how: '\u041a\u043e\u0433\u0435\u0440\u0435\u043d\u0442\u043d\u043e\u0441\u0442\u044c \u0441\u0435\u0440\u0434\u0435\u0447\u043d\u043e\u0433\u043e \u0440\u0438\u0442\u043c\u0430 (<em>HeartMath, McCraty et al., 2009</em>) + \u0431\u0430\u043b\u0430\u043d\u0441 LF/HF \u0441\u043f\u0435\u043a\u0442\u0440\u0430 HRV. \u041e\u043f\u0442\u0438\u043c\u0430\u043b\u044c\u043d\u044b\u0439 LF/HF \u2248 1.0\u20132.0 \u0433\u043e\u0432\u043e\u0440\u0438\u0442 \u043e \u0441\u0431\u0430\u043b\u0430\u043d\u0441\u0438\u0440\u043e\u0432\u0430\u043d\u043d\u043e\u0441\u0442\u0438 \u0412\u041d\u0421.',
      why: '\u0413\u0430\u0440\u043c\u043e\u043d\u0438\u044f \u0441\u0435\u0440\u0434\u0446\u0430, \u0434\u044b\u0445\u0430\u043d\u0438\u044f \u0438 \u043d\u0435\u0440\u0432\u043d\u043e\u0439 \u0441\u0438\u0441\u0442\u0435\u043c\u044b. \u0412\u044b\u0441\u043e\u043a\u0438\u0439 \u0440\u0435\u0437\u043e\u043d\u0430\u043d\u0441 = \u044d\u043c\u043e\u0446\u0438\u043e\u043d\u0430\u043b\u044c\u043d\u044b\u0439 \u0431\u0430\u043b\u0430\u043d\u0441.',
      source: '\u041a\u0430\u043c\u0435\u0440\u0430 \u2192 \u0441\u043f\u0435\u043a\u0442\u0440 HRV \u2192 \u043a\u043e\u0433\u0435\u0440\u0435\u043d\u0442\u043d\u043e\u0441\u0442\u044c + LF/HF'
    },
    {
      name: '\u0412\u0438\u0431\u0440\u0430\u0446\u0438\u044f', color: '#00ccff', freq: '741 Hz',
      how: '\u041e\u0441\u043d\u043e\u0432\u043d\u043e\u0439 \u0442\u043e\u043d \u0433\u043e\u043b\u043e\u0441\u0430 (F0), \u0441\u043f\u0435\u043a\u0442\u0440\u0430\u043b\u044c\u043d\u044b\u0439 \u0446\u0435\u043d\u0442\u0440\u043e\u0438\u0434 \u0438 \u0447\u0430\u0441\u0442\u043e\u0442\u0430 \u043c\u0438\u043a\u0440\u043e\u0442\u0440\u0435\u043c\u043e\u0440\u0430 \u043b\u0438\u0446\u0430. VoiceBio \u043c\u0430\u043f\u043f\u0438\u043d\u0433 \u043e\u043f\u0440\u0435\u0434\u0435\u043b\u044f\u0435\u0442 \u0430\u043a\u0442\u0438\u0432\u043d\u044b\u0439 \u044d\u043d\u0435\u0440\u0433\u0435\u0442\u0438\u0447\u0435\u0441\u043a\u0438\u0439 \u0446\u0435\u043d\u0442\u0440 \u0438 \u043f\u043e\u0434\u0441\u0432\u0435\u0447\u0438\u0432\u0430\u0435\u0442 \u0435\u0433\u043e \u0432 \u0430\u0443\u0440\u0435.',
      why: '\u0417\u0432\u0443\u043a\u043e\u0432\u0430\u044f \u0432\u044b\u0440\u0430\u0437\u0438\u0442\u0435\u043b\u044c\u043d\u043e\u0441\u0442\u044c \u0438 \u0444\u0438\u0437\u0438\u0447\u0435\u0441\u043a\u0430\u044f \u0436\u0438\u0432\u043e\u0441\u0442\u044c. \u0411\u043e\u0433\u0430\u0442\u044b\u0439 \u0433\u043e\u043b\u043e\u0441 + \u0443\u043c\u0435\u0440\u0435\u043d\u043d\u044b\u0439 \u0442\u0440\u0435\u043c\u043e\u0440 = \u0432\u044b\u0441\u043e\u043a\u0430\u044f \u0432\u0438\u0431\u0440\u0430\u0446\u0438\u044f.',
      source: '\u041c\u0438\u043a\u0440\u043e\u0444\u043e\u043d \u2192 pitch + \u0446\u0435\u043d\u0442\u0440\u043e\u0438\u0434 + vibraimage \u0447\u0430\u0441\u0442\u043e\u0442\u0430'
    },
    {
      name: '\u042f\u0441\u043d\u043e\u0441\u0442\u044c', color: '#6677ff', freq: '852 Hz',
      how: 'HNR (<em>Boersma, 1993</em>) + \u043d\u0438\u0437\u043a\u0438\u0439 jitter (<em>Titze, 1994</em>) + \u0447\u0451\u0442\u043a\u043e\u0441\u0442\u044c \u0444\u043e\u0440\u043c\u0430\u043d\u0442 (F1/F2 \u0432 \u043d\u043e\u0440\u043c\u0435) + \u043d\u0438\u0437\u043a\u0430\u044f \u0430\u043c\u043f\u043b\u0438\u0442\u0443\u0434\u0430 \u043c\u0438\u043a\u0440\u043e\u0434\u0432\u0438\u0436\u0435\u043d\u0438\u0439 (\u0441\u043f\u043e\u043a\u043e\u0439\u0441\u0442\u0432\u0438\u0435 \u0442\u0435\u043b\u0430 = \u044f\u0441\u043d\u043e\u0441\u0442\u044c \u0443\u043c\u0430).',
      why: '\u0427\u0438\u0441\u0442\u044b\u0439 \u0433\u043e\u043b\u043e\u0441 \u0441 \u0445\u043e\u0440\u043e\u0448\u0435\u0439 \u0430\u0440\u0442\u0438\u043a\u0443\u043b\u044f\u0446\u0438\u0435\u0439 \u0438 \u043d\u0435\u043f\u043e\u0434\u0432\u0438\u0436\u043d\u043e\u0441\u0442\u044c = \u0441\u043e\u0441\u0440\u0435\u0434\u043e\u0442\u043e\u0447\u0435\u043d\u043d\u043e\u0441\u0442\u044c.',
      source: '\u041c\u0438\u043a\u0440\u043e\u0444\u043e\u043d \u2192 HNR + jitter + \u0444\u043e\u0440\u043c\u0430\u043d\u0442\u044b + vibraimage \u0430\u043c\u043f\u043b\u0438\u0442\u0443\u0434\u0430'
    },
    {
      name: '\u0426\u0435\u043b\u043e\u0441\u0442\u043d\u043e\u0441\u0442\u044c', color: '#bb44ff', freq: '963 Hz',
      how: '\u0421\u043e\u0433\u043b\u0430\u0441\u043e\u0432\u0430\u043d\u043d\u043e\u0441\u0442\u044c \u0432\u0441\u0435\u0445 6 \u043e\u0441\u0442\u0430\u043b\u044c\u043d\u044b\u0445 \u043f\u0430\u0440\u0430\u043c\u0435\u0442\u0440\u043e\u0432. \u0412\u044b\u0447\u0438\u0441\u043b\u044f\u0435\u0442\u0441\u044f \u043a\u0430\u043a \u043e\u0431\u0440\u0430\u0442\u043d\u0430\u044f \u0432\u0435\u043b\u0438\u0447\u0438\u043d\u0430 \u0441\u0442\u0430\u043d\u0434\u0430\u0440\u0442\u043d\u043e\u0433\u043e \u043e\u0442\u043a\u043b\u043e\u043d\u0435\u043d\u0438\u044f \u043f\u0430\u0440\u0430\u043c\u0435\u0442\u0440\u043e\u0432 1\u20136. \u0427\u0435\u043c \u0431\u043b\u0438\u0436\u0435 \u0432\u0441\u0435 \u043f\u043e\u043a\u0430\u0437\u0430\u0442\u0435\u043b\u0438, \u0442\u0435\u043c \u0432\u044b\u0448\u0435 \u0446\u0435\u043b\u043e\u0441\u0442\u043d\u043e\u0441\u0442\u044c.',
      why: '\u0412\u0441\u0435 \u0441\u0438\u0441\u0442\u0435\u043c\u044b \u0440\u0430\u0431\u043e\u0442\u0430\u044e\u0442 \u043a\u0430\u043a \u0435\u0434\u0438\u043d\u043e\u0435 \u0446\u0435\u043b\u043e\u0435 \u2014 \u0431\u0435\u0437 \u00ab\u043f\u0440\u043e\u0432\u0430\u043b\u043e\u0432\u00bb \u0438 \u00ab\u043f\u0438\u043a\u043e\u0432\u00bb.',
      source: '\u0420\u0430\u0441\u0447\u0451\u0442 \u2192 \u0434\u0438\u0441\u043f\u0435\u0440\u0441\u0438\u044f \u043f\u0430\u0440\u0430\u043c\u0435\u0442\u0440\u043e\u0432 1\u20136'
    }
  ];

  for (const p of params) {
    const card = el('div', 'guide-param');
    card.style.borderLeftColor = p.color;
    card.innerHTML = `
      <div class="guide-param-head">
        <span class="guide-param-dot" style="background:${p.color};box-shadow:0 0 8px ${p.color}"></span>
        <span class="guide-param-name">${p.name}</span>
        <span class="guide-param-freq">${p.freq}</span>
      </div>
      <div class="guide-param-row">
        <span class="guide-param-label">\u041a\u0430\u043a \u0441\u0447\u0438\u0442\u0430\u0435\u0442\u0441\u044f:</span>
        <span>${p.how}</span>
      </div>
      <div class="guide-param-row">
        <span class="guide-param-label">\u041d\u0430 \u0447\u0442\u043e \u0432\u043b\u0438\u044f\u0435\u0442:</span>
        <span>${p.why}</span>
      </div>
      <div class="guide-param-source">${p.source}</div>
    `;
    inner.appendChild(card);
  }

  // Disclaimer
  inner.appendChild(el('p', 'guide-disclaimer', {
    text: 'AWABAND Scanner \u2014 \u0438\u0433\u0440\u043e\u0432\u043e\u0439 \u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442 \u0432\u0441\u0435\u043b\u0435\u043d\u043d\u043e\u0439 Awaterra 2225. \u041c\u0435\u0442\u043e\u0434\u044b \u0438\u0437\u043c\u0435\u0440\u0435\u043d\u0438\u044f \u043e\u0441\u043d\u043e\u0432\u0430\u043d\u044b \u043d\u0430 \u043d\u0430\u0443\u0447\u043d\u044b\u0445 \u0440\u0430\u0431\u043e\u0442\u0430\u0445 (rPPG, vibraimage, voice biomarkers, HRV analysis, VoiceBio), \u043d\u043e \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442\u044b \u043d\u043e\u0441\u044f\u0442 \u0440\u0430\u0437\u0432\u043b\u0435\u043a\u0430\u0442\u0435\u043b\u044c\u043d\u044b\u0439 \u0445\u0430\u0440\u0430\u043a\u0442\u0435\u0440 \u0438 \u043d\u0435 \u044f\u0432\u043b\u044f\u044e\u0442\u0441\u044f \u043c\u0435\u0434\u0438\u0446\u0438\u043d\u0441\u043a\u0438\u043c \u0434\u0438\u0430\u0433\u043d\u043e\u0437\u043e\u043c.'
  }));

  panel.appendChild(inner);
  overlay.appendChild(panel);
  return overlay;
}

/** Format elapsed time as M:SS */
function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `T+${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/** Start the scanning session */
async function startScanning() {
  showScreen('scanning');
  scanStartTime = Date.now();

  const video = document.getElementById('scan-video');
  const auraCanvas = document.getElementById('scan-aura-canvas');
  const offscreen = document.getElementById('scan-offscreen');
  const statusEl = document.getElementById('scan-status');
  const panelDiv = document.getElementById('scan-panel');
  const hudDataTL = document.getElementById('hud-data-tl');
  const hudDataTR = document.getElementById('hud-data-tr');
  const pulseBar = document.getElementById('pulse-bar');

  // Initialize processors
  rppg = new RPPGProcessor();
  vibraimageProc = new VibraimageProcessor();
  frameCount = 0;
  lastBiofield = null;
  smoothedBiofield = null;
  lastHR = null;

  // Start camera
  try {
    stream = await startCamera(video);
  } catch (err) {
    statusEl.textContent = '\u041a\u0430\u043c\u0435\u0440\u0430 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0430';
    return;
  }

  // Start voice analyzer
  voiceAnalyzer = new VoiceAnalyzer();
  try {
    await voiceAnalyzer.start();
  } catch (err) {
    voiceAnalyzer = null;
  }

  // Set up aura renderer
  auraRenderer = new AuraRenderer(auraCanvas);

  // Set up AWABAND panel
  awabandPanel = new AwabandPanel(panelDiv);

  // Resize canvases to viewport size (not full window)
  const viewport = document.querySelector('.scan-viewport');
  const onResize = () => {
    const rect = viewport.getBoundingClientRect();
    auraRenderer.resize(rect.width, rect.height);
    offscreen.width = video.videoWidth || 640;
    offscreen.height = video.videoHeight || 480;
  };
  onResize();
  video.addEventListener('loadedmetadata', onResize, { once: true });

  const offCtx = offscreen.getContext('2d');

  // Smoothed HR for flow calculation
  let hrSmoothed = null;

  // Animation loop
  function loop() {
    animFrameId = requestAnimationFrame(loop);

    // Draw video frame to offscreen canvas
    if (video.readyState >= 2) {
      offCtx.drawImage(video, 0, 0, offscreen.width, offscreen.height);

      // Extract forehead ROI and feed to rPPG
      const roi = getForeheadROI(offscreen.width, offscreen.height);
      const { r, g, b } = extractROIPixels(offCtx, roi);
      rppg.addFrame(r, g, b);

      // Feed vibraimage processor (face region — wider than forehead ROI)
      const faceROI = {
        x: Math.round(offscreen.width * 0.2),
        y: Math.round(offscreen.height * 0.1),
        w: Math.round(offscreen.width * 0.6),
        h: Math.round(offscreen.height * 0.7)
      };
      vibraimageProc.processFrame(offCtx, faceROI);
    }

    frameCount++;

    // Detect face position every ~10 frames for aura tracking
    if (frameCount % 10 === 0 && video.readyState >= 2) {
      auraRenderer.detectFaceFromCanvas(offCtx, offscreen.width, offscreen.height);
    }

    // Update elapsed time HUD every 30 frames
    if (frameCount % 30 === 0 && hudDataTR) {
      hudDataTR.textContent = formatElapsed(Date.now() - scanStartTime);
    }

    // Every ~15 frames (~500ms at 30fps): calculate vitals and update visuals
    if (frameCount % 15 === 0) {
      const hr = rppg.getHeartRate();
      const pulseSignal = rppg.getPulseSignal();
      const fullness = rppg.bufferFullness;

      let hrv = null;
      let sdnn = null;
      let pnn50 = null;
      let lfhf = null;
      let stressIndex = null;
      let breathingRate = null;
      let coherence = null;

      if (pulseSignal) {
        const hrvResult = calculateHRV(pulseSignal, 30);
        if (hrvResult) {
          hrv = hrvResult.rmssd;
          sdnn = hrvResult.sdnn;
          pnn50 = hrvResult.pnn50;
          breathingRate = calculateBreathingRate(hrvResult.ibis);
          coherence = calculateCoherence(hrvResult.ibis);
          lfhf = calculateLFHF(hrvResult.ibis);
          stressIndex = calculateBaevskySI(hrvResult.ibis);
        }
      }

      // Smooth HR
      if (hr !== null) {
        hrSmoothed = hrSmoothed !== null
          ? hrSmoothed * 0.7 + hr * 0.3
          : hr;
      }

      // Voice metrics
      const voiceMetrics = voiceAnalyzer
        ? voiceAnalyzer.getMetrics()
        : { pitch: null, jitter: null, shimmer: null, hnr: null, rms: null, spectralCentroid: null, formants: null, voiceBioCenter: null };

      // Update VoiceBio active center in aura renderer
      if (auraRenderer && voiceMetrics.voiceBioCenter !== null) {
        auraRenderer.setVoiceBioCenter(voiceMetrics.voiceBioCenter);
      }

      // Vibraimage metrics
      const vibraimageMetrics = vibraimageProc.getMetrics();

      // Map to biofield
      const vitals = { hr, hrv, sdnn, pnn50, lfhf, stressIndex, breathingRate, coherence, hrSmoothed };
      const rawBiofield = mapToBiofield(vitals, voiceMetrics, vibraimageMetrics);
      smoothedBiofield = smoothBiofield(rawBiofield, smoothedBiofield);
      lastBiofield = smoothedBiofield;
      lastHR = hr;

      // Update status
      if (fullness < 0.25) {
        statusEl.textContent = '\u041a\u0430\u043b\u0438\u0431\u0440\u043e\u0432\u043a\u0430...';
      } else if (hr !== null) {
        statusEl.textContent = `HR: ${hr} bpm`;
      } else {
        statusEl.textContent = `\u0417\u0430\u0445\u0432\u0430\u0442 \u0441\u0438\u0433\u043d\u0430\u043b\u0430... ${Math.round(fullness * 100)}%`;
      }

      // Update HUD data readouts
      if (hudDataTL) {
        const sig = Math.round(fullness * 100);
        hudDataTL.textContent = `SIG: ${sig}%${hr ? ` \u00b7 ${hr} BPM` : ''}`;
      }

      // Update pulse indicator
      if (pulseBar && hr) {
        const beatDuration = 60 / hr;
        pulseBar.style.setProperty('--beat-duration', `${beatDuration}s`);
        if (!pulseBar.classList.contains('beating')) {
          pulseBar.classList.add('beating');
        }
      }

      // Update panel
      awabandPanel.update(lastBiofield);
    }

    // Render aura every frame for smooth animation
    if (lastBiofield) {
      auraRenderer.render(lastBiofield, lastHR);
    }
  }

  animFrameId = requestAnimationFrame(loop);
}

/** Stop scanning and show results (or go back to splash) */
function stopScanning(goBack = false) {
  if (animFrameId !== null) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }

  if (stream) {
    stopCamera(stream);
    stream = null;
  }

  if (voiceAnalyzer) {
    voiceAnalyzer.stop();
    voiceAnalyzer = null;
  }

  const resultCanvas = document.getElementById('result-canvas');
  const resultPanel = document.getElementById('result-panel');

  if (lastBiofield && resultCanvas) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    resultCanvas.width = w;
    resultCanvas.height = h;

    const ctx = resultCanvas.getContext('2d');
    ctx.fillStyle = '#060910';
    ctx.fillRect(0, 0, w, h);

    const snapshotAura = new AuraRenderer(resultCanvas);
    snapshotAura.resize(w, h);
    snapshotAura.render(lastBiofield, null);
  }

  if (goBack) {
    showScreen('splash');
    return;
  }

  if (lastBiofield && resultPanel) {
    const panel = new AwabandPanel(resultPanel);
    panel.update(lastBiofield);
  }

  showScreen('result');
}

/** Save aura snapshot as PNG */
function saveSnapshot() {
  const canvas = document.getElementById('result-canvas');
  if (!canvas) return;

  const link = document.createElement('a');
  link.download = 'awaband-scan.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
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
