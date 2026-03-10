// AWABAND Scanner — Biofield Analysis Interface
// Awaterra 2225 Universe

import { startCamera, stopCamera, getForeheadROI, extractROIPixels } from './camera.js';
import { RPPGProcessor } from './rppg.js';
import { calculateHRV, calculateBreathingRate, calculateCoherence } from './vitals.js';
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
let auraRenderer = null;
let awabandPanel = null;
let lastBiofield = null;
let smoothedBiofield = null;
let lastHR = null;
let frameCount = 0;

const EMA_ALPHA = 0.15; // smoothing factor: lower = smoother (0.1-0.3 good range)

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

  // Orb
  screen.appendChild(el('div', 'splash-orb'));

  // Brand
  const brand = el('div', 'splash-brand');
  brand.innerHTML = 'AWA<span>BAND</span>';
  screen.appendChild(brand);

  // Version
  screen.appendChild(el('div', 'splash-version', { text: 'Biofield Scanner v2225.7' }));

  // Start button
  const btn = el('button', 'splash-btn');
  btn.appendChild(el('span', 'splash-btn-icon'));
  btn.appendChild(document.createTextNode('Начать сканирование'));
  btn.addEventListener('click', () => startScanning());
  screen.appendChild(btn);

  // Footer
  screen.appendChild(el('div', 'splash-footer', { text: 'AWATERRA DYNAMICS // MED-TECH DIVISION' }));

  return screen;
}

/** Build scanning screen */
function buildScanning() {
  const screen = el('div', 'screen');
  screen.id = 'scanning';

  // Video element (camera feed)
  const video = el('video', 'scan-video', { playsinline: '', autoplay: '' });
  video.id = 'scan-video';
  video.muted = true;
  screen.appendChild(video);

  // Aura overlay canvas
  const auraCanvas = el('canvas', 'scan-aura-canvas');
  auraCanvas.id = 'scan-aura-canvas';
  screen.appendChild(auraCanvas);

  // Hidden offscreen canvas for pixel extraction
  const offscreen = el('canvas', '');
  offscreen.id = 'scan-offscreen';
  offscreen.style.display = 'none';
  screen.appendChild(offscreen);

  // Status indicator
  const status = el('div', 'scan-status', { text: 'Калибровка...' });
  status.id = 'scan-status';
  screen.appendChild(status);

  // Stop button
  const stopBtn = el('button', 'scan-stop-btn', { html: '&#9632;' });
  stopBtn.addEventListener('click', () => stopScanning());
  screen.appendChild(stopBtn);

  // AWABAND panel container
  const panelDiv = el('div', '');
  panelDiv.id = 'scan-panel';
  screen.appendChild(panelDiv);

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

  const newScanBtn = el('button', 'result-btn', { text: 'Новое сканирование' });
  newScanBtn.addEventListener('click', () => showScreen('splash'));

  const saveBtn = el('button', 'result-btn result-btn-primary', { text: 'Сохранить' });
  saveBtn.addEventListener('click', () => saveSnapshot());

  actions.appendChild(newScanBtn);
  actions.appendChild(saveBtn);
  screen.appendChild(actions);

  return screen;
}

/** Start the scanning session */
async function startScanning() {
  showScreen('scanning');

  const video = document.getElementById('scan-video');
  const auraCanvas = document.getElementById('scan-aura-canvas');
  const offscreen = document.getElementById('scan-offscreen');
  const statusEl = document.getElementById('scan-status');
  const panelDiv = document.getElementById('scan-panel');

  // Initialize rPPG processor
  rppg = new RPPGProcessor();
  frameCount = 0;
  lastBiofield = null;
  smoothedBiofield = null;
  lastHR = null;

  // Start camera
  try {
    stream = await startCamera(video);
  } catch (err) {
    statusEl.textContent = 'Камера недоступна';
    return;
  }

  // Start voice analyzer
  voiceAnalyzer = new VoiceAnalyzer();
  try {
    await voiceAnalyzer.start();
  } catch (err) {
    // Voice is optional — continue without it
    voiceAnalyzer = null;
  }

  // Set up aura renderer
  auraRenderer = new AuraRenderer(auraCanvas);

  // Set up AWABAND panel
  awabandPanel = new AwabandPanel(panelDiv);

  // Resize canvases once video dimensions are known
  const onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    auraRenderer.resize(w, h);
    offscreen.width = video.videoWidth || 640;
    offscreen.height = video.videoHeight || 480;
  };
  onResize();
  // Also resize when video metadata loads (actual resolution)
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
    }

    frameCount++;

    // Detect face position every ~10 frames for aura tracking
    if (frameCount % 10 === 0 && video.readyState >= 2) {
      auraRenderer.detectFaceFromCanvas(offCtx, offscreen.width, offscreen.height);
    }

    // Every ~15 frames (~500ms at 30fps): calculate vitals and update visuals
    if (frameCount % 15 === 0) {
      const hr = rppg.getHeartRate();
      const pulseSignal = rppg.getPulseSignal();
      const fullness = rppg.bufferFullness;

      let hrv = null;
      let breathingRate = null;
      let coherence = null;

      if (pulseSignal) {
        const hrvResult = calculateHRV(pulseSignal, 30);
        if (hrvResult) {
          hrv = hrvResult.rmssd;
          breathingRate = calculateBreathingRate(hrvResult.ibis);
          coherence = calculateCoherence(hrvResult.ibis);
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
        : { pitch: null, jitter: null, shimmer: null, hnr: null, rms: null, spectralCentroid: null };

      // Map to biofield
      const vitals = { hr, hrv, breathingRate, coherence, hrSmoothed };
      const rawBiofield = mapToBiofield(vitals, voiceMetrics);
      smoothedBiofield = smoothBiofield(rawBiofield, smoothedBiofield);
      lastBiofield = smoothedBiofield;
      lastHR = hr;

      // Update status
      if (fullness < 0.25) {
        statusEl.textContent = 'Калибровка...';
      } else if (hr !== null) {
        statusEl.textContent = `HR: ${hr} bpm`;
      } else {
        statusEl.textContent = `Захват сигнала... ${Math.round(fullness * 100)}%`;
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

/** Stop scanning and show results */
function stopScanning() {
  // Cancel animation loop
  if (animFrameId !== null) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }

  // Stop camera
  if (stream) {
    stopCamera(stream);
    stream = null;
  }

  // Stop voice
  if (voiceAnalyzer) {
    voiceAnalyzer.stop();
    voiceAnalyzer = null;
  }

  // Render final aura snapshot to result canvas
  const resultCanvas = document.getElementById('result-canvas');
  const resultPanel = document.getElementById('result-panel');

  if (lastBiofield && resultCanvas) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    resultCanvas.width = w;
    resultCanvas.height = h;

    // Draw dark background
    const ctx = resultCanvas.getContext('2d');
    ctx.fillStyle = '#080b14';
    ctx.fillRect(0, 0, w, h);

    // Render aura onto result canvas
    const snapshotAura = new AuraRenderer(resultCanvas);
    snapshotAura.resize(w, h);
    snapshotAura.render(lastBiofield, null);
  }

  // Build result panel with final values
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
