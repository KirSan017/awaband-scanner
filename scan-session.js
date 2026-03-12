import { startCamera, stopCamera, getForeheadROI, extractROIPixels } from './camera.js';
import { RPPGProcessor } from './rppg.js';
import { calculateHRV, calculateBreathingRate, calculateCoherence, calculateLFHF, calculateBaevskySI } from './vitals.js';
import { VibraimageProcessor } from './vibraimage.js';
import { VoiceAnalyzer } from './voice.js';
import { AuraRenderer } from './aura.js';
import { EmotionDetector } from './emotion-detector.js';
import { PersonSegmentation } from './segmentation.js';
import { AwabandPanel } from './awaband-panel.js';
import { PersonalBaseline } from './calibration.js';
import { FaceTracker } from './face-tracker.js';
import {
  EMPTY_EMOTIONS,
  EMPTY_VIBRAIMAGE_METRICS,
  EMPTY_VOICE_METRICS,
} from './scan-contracts.js';
import {
  deriveQualityFlags,
  deriveSensorStatus,
  deriveStatusMessage,
} from './scan-quality.js';
import {
  buildScanExport,
  computeBiofieldFrame,
} from './scan-runtime.js';

const FACE_LOST_CLEAR_THRESHOLD = 60;
const MAX_EXPORT_TIMELINE_SAMPLES = 600;

export class ScanSession {
  constructor({
    video,
    auraCanvas,
    offscreen,
    panelDiv,
    hudDataTL,
    hudDataTR,
    pulseBar,
    hdButton,
    setStatusText,
    updateSensorStrip,
    updateDiagnostics,
    showToast,
    onScanState,
    simulation = null,
  }) {
    this.video = video;
    this.auraCanvas = auraCanvas;
    this.offscreen = offscreen;
    this.panelDiv = panelDiv;
    this.hudDataTL = hudDataTL;
    this.hudDataTR = hudDataTR;
    this.pulseBar = pulseBar;
    this.hdButton = hdButton;
    this.setStatusText = setStatusText;
    this.updateSensorStrip = updateSensorStrip;
    this.updateDiagnostics = updateDiagnostics;
    this.showToast = showToast;
    this.onScanState = onScanState;
    this.simulation = simulation;

    this.faceTracker = new FaceTracker();
    this.stream = null;
    this.voiceAnalyzer = null;
    this.animFrameId = null;
    this.rppg = null;
    this.vibraimageProc = null;
    this.emotionDetector = null;
    this.segmentation = null;
    this.auraRenderer = null;
    this.awabandPanel = null;
    this.personalBaseline = null;
    this.frameCount = 0;
    this.scanStartTime = null;
    this.prevHR = null;
    this.hrSmoothed = null;
    this.lastBiofield = null;
    this.lastHR = null;
    this.lastVitals = null;
    this.lastVoiceMetrics = null;
    this.lastVibraimageMetrics = null;
    this.lastEmotions = null;
    this.lastSensorStatus = null;
    this.lastQualityFlags = null;
    this.lastScanExport = null;
    this.lastStatusMessage = null;
    this.microphoneDenied = false;
    this.hdModeState = 'off';
    this.sessionStartedAt = null;
    this.sessionTimeline = [];
  }

  async start() {
    this.scanStartTime = Date.now();
    this.frameCount = 0;
    this.prevHR = null;
    this.hrSmoothed = null;
    this.lastBiofield = null;
    this.lastHR = null;
    this.lastVitals = null;
    this.lastVoiceMetrics = { ...EMPTY_VOICE_METRICS };
    this.lastVibraimageMetrics = { ...EMPTY_VIBRAIMAGE_METRICS };
    this.lastEmotions = { ...EMPTY_EMOTIONS };
    this.lastSensorStatus = { camera: 'pending', microphone: 'pending', face: 'searching', pulse: 'warming_up', hdMode: 'off' };
    this.lastQualityFlags = null;
    this.lastScanExport = null;
    this.lastStatusMessage = 'Калибровка...';
    this.microphoneDenied = false;
    this.hdModeState = 'off';
    this.sessionStartedAt = new Date(this.scanStartTime).toISOString();
    this.sessionTimeline = [];

    this.rppg = new RPPGProcessor();
    this.vibraimageProc = new VibraimageProcessor();
    this.emotionDetector = new EmotionDetector();
    this.segmentation = null;
    this.personalBaseline = new PersonalBaseline();
    this.auraRenderer = new AuraRenderer(this.auraCanvas);
    this.awabandPanel = new AwabandPanel(this.panelDiv);

    this.applyHdButtonState('off');
    this.updateSensorStrip(this.lastSensorStatus);
    this.setStatusText('Калибровка...');
    if (this.hudDataTL) {
      this.hudDataTL.textContent = 'SIG: ---';
    }
    if (this.hudDataTR) {
      this.hudDataTR.textContent = 'T+00:00';
    }
    if (this.pulseBar) {
      this.pulseBar.classList.remove('beating');
      this.pulseBar.style.removeProperty('--beat-duration');
    }
    this.updateDiagnostics?.(this.lastQualityFlags);
    this.emitState();

    try {
      this.stream = await startCamera(this.video);
    } catch {
      this.lastSensorStatus = { camera: 'denied', microphone: 'pending', face: 'searching', pulse: 'unavailable', hdMode: this.hdModeState };
      this.lastQualityFlags = deriveQualityFlags(this.lastSensorStatus);
      this.lastStatusMessage = 'Камера недоступна — проверьте разрешения';
      this.updateSensorStrip(this.lastSensorStatus);
      this.setStatusText(this.lastStatusMessage, true);
      this.showToast('Камера недоступна — скан не может продолжиться');
      this.emitState();
      return false;
    }

    this.voiceAnalyzer = new VoiceAnalyzer();
    try {
      await this.voiceAnalyzer.start();
    } catch {
      this.voiceAnalyzer = null;
      this.microphoneDenied = true;
      this.showToast('Микрофон недоступен — голосовой канал отключен');
    }

    const viewport = document.querySelector('.scan-viewport');
    const onResize = () => {
      const rect = viewport.getBoundingClientRect();
      this.auraRenderer.resize(rect.width, rect.height);
      this.offscreen.width = this.video.videoWidth || 640;
      this.offscreen.height = this.video.videoHeight || 480;
    };
    onResize();
    this.video.addEventListener('loadedmetadata', onResize, { once: true });

    const offCtx = this.offscreen.getContext('2d', { willReadFrequently: true });

    const loop = () => {
      this.animFrameId = requestAnimationFrame(loop);

      if (this.video.readyState >= 2) {
        offCtx.drawImage(this.video, 0, 0, this.offscreen.width, this.offscreen.height);

        const faceOK = this.auraRenderer.faceDetected;
        if (faceOK) {
          const facePos = this.auraRenderer.faceDetected
            ? { x: 1 - this.auraRenderer.faceX, y: this.auraRenderer.faceY, scale: this.auraRenderer.faceScale }
            : null;

          const roi = getForeheadROI(this.offscreen.width, this.offscreen.height, facePos);
          const { r, g, b } = extractROIPixels(offCtx, roi);
          this.rppg.addFrame(r, g, b);

          const faceROI = facePos ? {
            x: Math.round(Math.max(0, (facePos.x - 0.3 * (facePos.scale || 1)) * this.offscreen.width)),
            y: Math.round(Math.max(0, (facePos.y - 0.3 * (facePos.scale || 1)) * this.offscreen.height)),
            w: Math.round(Math.min(this.offscreen.width, 0.6 * (facePos.scale || 1) * this.offscreen.width)),
            h: Math.round(Math.min(this.offscreen.height, 0.7 * (facePos.scale || 1) * this.offscreen.height)),
          } : {
            x: Math.round(this.offscreen.width * 0.2),
            y: Math.round(this.offscreen.height * 0.1),
            w: Math.round(this.offscreen.width * 0.6),
            h: Math.round(this.offscreen.height * 0.7),
          };
          this.vibraimageProc.processFrame(offCtx, faceROI);
        }

        if (this.auraRenderer.framesWithoutFace >= FACE_LOST_CLEAR_THRESHOLD) {
          this.rppg.clearBuffer();
          this.vibraimageProc.reset();
          this.emotionDetector.reset();
          this.hrSmoothed = null;
        }
      }

      this.frameCount++;

      if (this.frameCount % 10 === 0 && this.video.readyState >= 2) {
        if (this.faceTracker.isAvailable()) {
          this.faceTracker.detect(this.offscreen).then((box) => {
            if (box) {
              this.auraRenderer.updateFaceFromBox(box, this.offscreen.width, this.offscreen.height);
            } else {
              this.auraRenderer.detectFaceFromCanvas(offCtx, this.offscreen.width, this.offscreen.height);
            }
          });
        } else {
          this.auraRenderer.detectFaceFromCanvas(offCtx, this.offscreen.width, this.offscreen.height);
        }
      }

      if (this.frameCount % 30 === 0 && this.hudDataTR) {
        this.hudDataTR.textContent = formatElapsed(Date.now() - this.scanStartTime);
      }

      if (this.frameCount % 15 === 0) {
        this.processFrameUpdate();
      }

      if (this.segmentation && this.segmentation.isLoaded() && this.video.readyState >= 2 && this.frameCount % 3 === 0) {
        this.segmentation.getMask(this.video).then((maskData) => {
          if (maskData) {
            this.segmentation.applyBackgroundBlur(offCtx, this.video, maskData, 12);
            this.auraRenderer.faceDetected = true;
            this.auraRenderer.framesWithoutFace = 0;
          }
        });
      }

      if (this.lastBiofield) {
        this.auraRenderer.render(this.lastBiofield, this.lastHR);
      }
    };

    this.animFrameId = requestAnimationFrame(loop);
    return true;
  }

  stop() {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    if (this.stream) {
      stopCamera(this.stream);
      this.stream = null;
    }

    if (this.voiceAnalyzer) {
      this.voiceAnalyzer.stop();
      this.voiceAnalyzer = null;
    }

    if (this.lastSensorStatus) {
      this.rebuildScanExport({
        timestamp: new Date().toISOString(),
        bufferFullness: this.rppg?.bufferFullness ?? 0,
        pulseSignal: this.rppg?.getPulseSignal() || null,
      });
    }

    return this.getState();
  }

  async toggleHD() {
    if (!this.hdButton) return;

    if (!this.segmentation) {
      this.segmentation = new PersonSegmentation();
    }

    if (this.segmentation.isLoaded()) {
      this.segmentation = null;
      this.hdModeState = 'off';
      this.applyHdButtonState(this.hdModeState);
      this.pushSensorStatus();
      return;
    }

    if (this.segmentation.isLoading()) return;

    this.hdModeState = 'loading';
    this.applyHdButtonState(this.hdModeState);
    this.pushSensorStatus();

    const ok = await this.segmentation.load();
    if (ok) {
      this.hdModeState = 'active';
      this.applyHdButtonState(this.hdModeState);
    } else {
      this.hdModeState = 'error';
      this.applyHdButtonState(this.hdModeState);
      this.showToast('HD недоступен — загрузка не удалась');
      this.segmentation = null;
    }

    this.pushSensorStatus();
  }

  getState() {
    return {
      biofield: this.lastBiofield,
      vitals: this.lastVitals,
      voiceMetrics: this.lastVoiceMetrics,
      vibraimageMetrics: this.lastVibraimageMetrics,
      emotions: this.lastEmotions,
      statuses: this.lastSensorStatus,
      qualityFlags: this.lastQualityFlags,
      exportData: this.lastScanExport,
      hr: this.lastHR,
      statusMessage: this.lastStatusMessage,
      trackerMode: this.faceTracker.mode,
      simulationMode: this.simulation?.label || 'off',
    };
  }

  processFrameUpdate() {
    let hr = this.rppg.getHeartRate();
    const pulseSignal = this.rppg.getPulseSignal();
    const fullness = this.rppg.bufferFullness;

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

    let hrDelta = null;
    if (hr !== null) {
      if (this.prevHR !== null) {
        hrDelta = Math.abs(hr - this.prevHR);
      }
      this.prevHR = hr;
      this.hrSmoothed = this.hrSmoothed !== null
        ? this.hrSmoothed * 0.7 + hr * 0.3
        : hr;
    }

    let signalQuality = this.rppg.getSignalQuality();
    if (this.simulation?.pulseWeak && fullness >= 0.45) {
      hr = hr ?? 72;
      signalQuality = Math.min(signalQuality ?? 18, 18);
    }

    const voiceMetrics = this.voiceAnalyzer
      ? this.voiceAnalyzer.getMetrics()
      : { ...EMPTY_VOICE_METRICS };

    if (this.auraRenderer && voiceMetrics.voiceBioCenter !== null) {
      this.auraRenderer.setVoiceBioCenter(voiceMetrics.voiceBioCenter);
    }

    const rawVibraimageMetrics = this.vibraimageProc.getMetrics();
    const vibraimageMetrics = rawVibraimageMetrics || { ...EMPTY_VIBRAIMAGE_METRICS };
    const emotions = this.emotionDetector.update(voiceMetrics, rawVibraimageMetrics) || { ...EMPTY_EMOTIONS };
    this.auraRenderer.setEmotions(emotions);

    if (this.personalBaseline && !this.personalBaseline.isFinalized) {
      if (hr !== null) this.personalBaseline.addSample('hr', hr);
      if (hrv !== null) this.personalBaseline.addSample('rmssd', hrv);
      if (vibraimageMetrics?.amplitude != null) this.personalBaseline.addSample('amplitude', vibraimageMetrics.amplitude);
      if (fullness > 0.5) this.personalBaseline.finalize();
    }

    const facePresent = this.auraRenderer.faceDetected;
    const vitals = { hr, hrv, sdnn, pnn50, lfhf, stressIndex, breathingRate, coherence, hrSmoothed: this.hrSmoothed, hrDelta, signalQuality };
    const baselineData = this.personalBaseline?.isFinalized ? this.personalBaseline.getBaseline() : null;
    const updateTimestamp = new Date().toISOString();

    this.lastVitals = vitals;
    this.lastVoiceMetrics = voiceMetrics;
    this.lastVibraimageMetrics = vibraimageMetrics;
    this.lastEmotions = emotions;
    this.lastSensorStatus = deriveSensorStatus({
      cameraReady: Boolean(this.stream),
      microphoneReady: Boolean(this.voiceAnalyzer) && !this.microphoneDenied,
      microphoneDenied: this.microphoneDenied,
      faceDetected: facePresent,
      framesWithoutFace: this.auraRenderer.framesWithoutFace,
      bufferFullness: fullness,
      signalQuality,
      hr,
      hdMode: this.hdModeState,
    });
    this.lastQualityFlags = deriveQualityFlags(this.lastSensorStatus);
    this.lastBiofield = computeBiofieldFrame({
      vitals,
      voiceMetrics,
      vibraimageMetrics,
      emotions,
      baseline: baselineData,
      facePresent,
      previousBiofield: this.lastBiofield,
      qualityFlags: this.lastQualityFlags,
    });
    this.lastQualityFlags = this.lastBiofield?.qualityFlags || this.lastQualityFlags;
    this.lastHR = facePresent ? hr : null;
    this.lastStatusMessage = deriveStatusMessage(this.lastSensorStatus, { hr, bufferFullness: fullness, signalQuality });
    this.appendTimelineSample({
      timestamp: updateTimestamp,
      bufferFullness: fullness,
      statusMessage: this.lastStatusMessage,
    });
    this.rebuildScanExport({
      timestamp: updateTimestamp,
      bufferFullness: fullness,
      pulseSignal,
      baseline: baselineData,
    });

    this.setStatusText(
      this.lastStatusMessage,
      this.lastSensorStatus.face !== 'tracking' || this.lastSensorStatus.camera !== 'ready' || this.lastSensorStatus.pulse === 'weak',
    );
    this.updateSensorStrip(this.lastSensorStatus);

    if (this.hudDataTL) {
      const sigDisplay = fullness >= 1 && signalQuality !== null
        ? `SIG: ${signalQuality}%`
        : `SIG: ${Math.round(fullness * 100)}%`;
      const partialBadge = this.lastQualityFlags?.partial ? ' · PARTIAL' : '';
      this.hudDataTL.textContent = `${sigDisplay}${hr ? ` · ${hr} BPM` : ''}${partialBadge}`;
    }

    if (this.pulseBar && hr) {
      const beatDuration = 60 / hr;
      this.pulseBar.style.setProperty('--beat-duration', `${beatDuration}s`);
      if (!this.pulseBar.classList.contains('beating')) {
        this.pulseBar.classList.add('beating');
      }
    } else if (this.pulseBar) {
      this.pulseBar.classList.remove('beating');
    }

    this.awabandPanel.update(this.lastBiofield);
    this.updateDiagnostics?.(this.lastQualityFlags);
    this.emitState();
  }

  pushSensorStatus() {
    this.lastSensorStatus = this.lastSensorStatus
      ? { ...this.lastSensorStatus, hdMode: this.hdModeState }
      : { camera: 'pending', microphone: 'pending', face: 'searching', pulse: 'warming_up', hdMode: this.hdModeState };
    this.lastQualityFlags = this.lastSensorStatus ? deriveQualityFlags(this.lastSensorStatus) : null;
    this.updateSensorStrip(this.lastSensorStatus);
    this.updateDiagnostics?.(this.lastQualityFlags);
    this.emitState();
  }

  appendTimelineSample({ timestamp, bufferFullness = 0, statusMessage = '' } = {}) {
    if (!this.lastSensorStatus || !this.lastBiofield || !this.lastQualityFlags) return;

    const sample = {
      timestamp,
      elapsedMs: Math.max(0, Date.now() - this.scanStartTime),
      frameCount: this.frameCount,
      bufferFullness: roundForExport(bufferFullness),
      statusMessage,
      statuses: { ...this.lastSensorStatus },
      vitals: sanitizeNumbers(this.lastVitals),
      voiceMetrics: sanitizeNumbers(this.lastVoiceMetrics),
      vibraimageMetrics: sanitizeNumbers(this.lastVibraimageMetrics),
      emotions: sanitizeNumbers(this.lastEmotions),
      biofield: {
        stability: this.lastBiofield.stability,
        flow: this.lastBiofield.flow,
        energy: this.lastBiofield.energy,
        resonance: this.lastBiofield.resonance,
        vibration: this.lastBiofield.vibration,
        clarity: this.lastBiofield.clarity,
        integrity: this.lastBiofield.integrity,
        luminosity: this.lastBiofield.luminosity,
        confidence: sanitizeNumbers(this.lastBiofield.confidence),
      },
      quality: {
        scanState: this.lastQualityFlags.scanState,
        scanConfidence: this.lastQualityFlags.scanConfidence,
        partialReasons: [...(this.lastQualityFlags.partialReasons || [])],
        retainedParameters: [...(this.lastQualityFlags.retainedParameters || [])],
      },
    };

    this.sessionTimeline.push(sample);
    if (this.sessionTimeline.length > MAX_EXPORT_TIMELINE_SAMPLES) {
      this.sessionTimeline.shift();
    }
  }

  rebuildScanExport({
    timestamp,
    bufferFullness = 0,
    pulseSignal = null,
    baseline = null,
  } = {}) {
    this.lastScanExport = buildScanExport({
      timestamp,
      statusMessage: this.lastStatusMessage,
      biofield: sanitizeNumbers(this.lastBiofield),
      vitals: sanitizeNumbers(this.lastVitals),
      voiceMetrics: sanitizeNumbers(this.lastVoiceMetrics),
      vibraimageMetrics: sanitizeNumbers(this.lastVibraimageMetrics),
      emotions: sanitizeNumbers(this.lastEmotions),
      statuses: this.lastSensorStatus,
      runtime: {
        trackerMode: this.faceTracker.mode,
        simulationMode: this.simulation?.label || 'off',
        scanState: this.lastQualityFlags?.scanState || 'unknown',
        scanConfidence: this.lastQualityFlags?.scanConfidence ?? 0,
        partialReasons: [...(this.lastQualityFlags?.partialReasons || [])],
      },
      baseline: sanitizeNumbers(baseline || (this.personalBaseline?.isFinalized ? this.personalBaseline.getBaseline() : null)),
      session: {
        startedAt: this.sessionStartedAt,
        updatedAt: timestamp,
        durationMs: Math.max(0, Date.now() - this.scanStartTime),
        sampleCount: this.sessionTimeline.length,
        timelineLimit: MAX_EXPORT_TIMELINE_SAMPLES,
        captureMode: this.simulation?.active ? 'simulation' : 'real',
        trackerMode: this.faceTracker.mode,
        simulationMode: this.simulation?.label || 'off',
        hdMode: this.hdModeState,
        bufferFullness: roundForExport(bufferFullness),
        userAgent: globalThis.navigator?.userAgent || null,
      },
      timeline: sanitizeNumbers(this.sessionTimeline),
      signals: sanitizeNumbers({
        rppg: this.rppg?.getExportSnapshot(pulseSignal) || null,
        vibraimage: this.vibraimageProc?.getExportSnapshot() || null,
      }),
    });
  }

  applyHdButtonState(state) {
    if (!this.hdButton) return;
    this.hdButton.classList.remove('active', 'loading');
    this.hdButton.textContent = 'HD';
    if (state === 'active') {
      this.hdButton.classList.add('active');
    } else if (state === 'loading') {
      this.hdButton.classList.add('loading');
      this.hdButton.textContent = '';
    }
  }

  emitState() {
    this.onScanState?.(this.getState());
  }
}

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `T+${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function sanitizeNumbers(value) {
  if (typeof value === 'number' && !Number.isInteger(value)) {
    return roundForExport(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeNumbers(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeNumbers(item)]),
    );
  }
  return value;
}

function roundForExport(value) {
  return Math.round(value * 10000) / 10000;
}
