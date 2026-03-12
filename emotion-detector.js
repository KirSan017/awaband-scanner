// emotion-detector.js — Laugh & smile detection from voice + vibraimage
// Zero external dependencies — uses existing VoiceAnalyzer and VibraimageProcessor data

/**
 * EmotionDetector analyzes voice metrics (from VoiceAnalyzer) and vibraimage metrics
 * (from VibraimageProcessor) to detect laughing and smiling states.
 *
 * Laugh detection — via voice:
 *   Rapid RMS bursts (>0.05) at 100-400ms intervals
 *   High HNR (>15 dB) — laughter is harmonic
 *   Pitch above normal and variable
 *
 * Smile detection — via vibraimage:
 *   Increased symmetry (facial muscles work symmetrically)
 *   Slight amplitude increase in lower face ROI (cheeks lift)
 *   Sustained pattern >1 sec to filter false positives
 */
export class EmotionDetector {
  constructor() {
    // RMS burst history for laugh detection (last 3 sec at ~2 calls/sec from 15-frame interval)
    this.rmsHistory = [];
    this.maxRmsHistory = 90; // ~3 sec at 30 calls/sec (every frame interval)

    // Timestamps of RMS bursts for pattern matching
    this.burstTimestamps = [];

    // Smile detection state
    this.smileAccumulator = 0; // frames matching smile pattern
    this.smileThreshold = 30;  // ~1 sec at 30fps worth of updates

    // Output state (smoothed)
    this.laughing = false;
    this.smiling = false;
    this.laughIntensity = 0;
    this.smileIntensity = 0;

    // Smoothing
    this._laughSmoothed = 0;
    this._smileSmoothed = 0;
  }

  /**
   * Update emotion detection with latest metrics.
   * Call every processing cycle (~15 frames).
   *
   * @param {{ rms: number|null, hnr: number|null, pitch: number|null }} voiceMetrics
   * @param {{ amplitude: number|null, symmetry: number|null, amplitudeLower: number|null }|null} vibraimageMetrics
   * @returns {{ laughing: boolean, smiling: boolean, laughIntensity: number, smileIntensity: number }}
   */
  update(voiceMetrics, vibraimageMetrics) {
    const now = performance.now();

    // ── Laugh detection (voice-based) ──
    this._updateLaughDetection(voiceMetrics, now);

    // ── Smile detection (vibraimage-based) ──
    this._updateSmileDetection(vibraimageMetrics);

    return {
      laughing: this.laughing,
      smiling: this.smiling,
      laughIntensity: this.laughIntensity,
      smileIntensity: this.smileIntensity
    };
  }

  /**
   * Detect laughter from voice RMS burst patterns.
   * Laughter = rapid RMS spikes at 100-400ms intervals + high HNR + elevated pitch.
   * @private
   */
  _updateLaughDetection(voice, now) {
    const rms = voice.rms ?? 0;
    const hnr = voice.hnr ?? 0;
    const pitch = voice.pitch ?? 0;

    // Track RMS history
    this.rmsHistory.push({ rms, time: now });
    if (this.rmsHistory.length > this.maxRmsHistory) {
      this.rmsHistory.shift();
    }

    // Detect RMS bursts (above threshold)
    const burstThreshold = 0.05;
    if (rms > burstThreshold) {
      // Only add burst if enough time since last (debounce 80ms)
      const lastBurst = this.burstTimestamps[this.burstTimestamps.length - 1] || 0;
      if (now - lastBurst > 80) {
        this.burstTimestamps.push(now);
      }
    }

    // Clean old burst timestamps (keep last 3 sec)
    const cutoff = now - 3000;
    while (this.burstTimestamps.length > 0 && this.burstTimestamps[0] < cutoff) {
      this.burstTimestamps.shift();
    }

    // Count bursts with inter-burst intervals in laugh range (100-400ms)
    let laughBursts = 0;
    for (let i = 1; i < this.burstTimestamps.length; i++) {
      const interval = this.burstTimestamps[i] - this.burstTimestamps[i - 1];
      if (interval >= 100 && interval <= 400) {
        laughBursts++;
      }
    }

    // Laugh score: needs 3+ rapid bursts + high HNR + elevated pitch
    const burstScore = Math.min(1, laughBursts / 4); // 4 bursts = max
    const hnrBonus = hnr > 15 ? Math.min(1, (hnr - 15) / 10) : 0;
    const pitchBonus = pitch > 200 ? Math.min(1, (pitch - 200) / 100) : 0;

    const rawLaugh = burstScore * 0.5 + hnrBonus * 0.3 + pitchBonus * 0.2;

    // Smooth and threshold
    this._laughSmoothed = this._laughSmoothed * 0.7 + rawLaugh * 0.3;
    this.laughing = this._laughSmoothed > 0.25;
    this.laughIntensity = Math.min(100, Math.round(this._laughSmoothed * 100));
  }

  /**
   * Detect smile from vibraimage symmetry + lower-face amplitude.
   * Smile = high symmetry (muscles symmetric) + elevated lower-face amplitude (cheeks lift).
   * @private
   */
  _updateSmileDetection(vibraMetrics) {
    if (!vibraMetrics) {
      this._smileSmoothed *= 0.9;
      this.smiling = false;
      this.smileIntensity = Math.round(this._smileSmoothed * 100);
      return;
    }

    const symmetry = vibraMetrics.symmetry ?? 50;
    const amplitudeLower = vibraMetrics.amplitudeLower ?? vibraMetrics.amplitude ?? 0;
    const amplitude = vibraMetrics.amplitude ?? 0;

    // Smile indicators:
    // 1. High symmetry (>65) — facial muscles work symmetrically during smile
    const symScore = symmetry > 65 ? Math.min(1, (symmetry - 65) / 25) : 0;

    // 2. Lower face amplitude higher than overall (cheeks lifting)
    // Use amplitudeLower if available, otherwise use amplitude with reduced weight
    const lowerBoost = amplitudeLower > amplitude * 1.1 ? Math.min(1, (amplitudeLower - amplitude) / 20) : 0;

    // 3. Moderate overall amplitude (not too still, not too jittery)
    const ampOk = amplitude > 15 && amplitude < 60 ? 0.5 : 0;

    const rawSmile = symScore * 0.5 + lowerBoost * 0.25 + ampOk * 0.25;

    // Accumulate sustained pattern (need >1 sec)
    if (rawSmile > 0.2) {
      this.smileAccumulator = Math.min(this.smileThreshold + 10, this.smileAccumulator + 1);
    } else {
      this.smileAccumulator = Math.max(0, this.smileAccumulator - 2);
    }

    const sustained = this.smileAccumulator >= this.smileThreshold ? 1 : 0;
    const effectiveSmile = rawSmile * (0.5 + sustained * 0.5);

    // Smooth
    this._smileSmoothed = this._smileSmoothed * 0.8 + effectiveSmile * 0.2;
    this.smiling = this._smileSmoothed > 0.2;
    this.smileIntensity = Math.min(100, Math.round(this._smileSmoothed * 100));
  }

  /** Reset state */
  reset() {
    this.rmsHistory = [];
    this.burstTimestamps = [];
    this.smileAccumulator = 0;
    this.laughing = false;
    this.smiling = false;
    this.laughIntensity = 0;
    this.smileIntensity = 0;
    this._laughSmoothed = 0;
    this._smileSmoothed = 0;
  }
}
