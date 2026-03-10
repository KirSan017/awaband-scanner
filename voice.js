// dashboard/public/scanner/voice.js

/**
 * VoiceAnalyzer — captures microphone audio and extracts voice biomarkers
 * using Web Audio API in real-time.
 *
 * Extracted metrics:
 *  - **Pitch (F0)** — fundamental frequency via autocorrelation (Hz)
 *  - **Jitter** — cycle-to-cycle pitch period variation (%)
 *  - **Shimmer** — cycle-to-cycle amplitude variation (%)
 *  - **HNR** — harmonics-to-noise ratio (dB)
 *  - **RMS** — root-mean-square loudness
 *  - **Spectral Centroid** — perceptual "brightness" of sound (Hz)
 */
export class VoiceAnalyzer {
  constructor() {
    /** @type {AudioContext|null} */
    this.audioCtx = null;
    /** @type {AnalyserNode|null} */
    this.analyser = null;
    /** @type {MediaStreamAudioSourceNode|null} */
    this.source = null;
    /** @type {MediaStream|null} */
    this.stream = null;
  }

  /**
   * Request microphone access and initialise the audio pipeline.
   * @returns {Promise<void>}
   */
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true }
    });
    this.audioCtx = new AudioContext();
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.source = this.audioCtx.createMediaStreamSource(this.stream);
    this.source.connect(this.analyser);
  }

  /**
   * Stop recording, release microphone and close audio context.
   */
  stop() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.audioCtx?.close();
    this.audioCtx = null;
    this.analyser = null;
    this.source = null;
    this.stream = null;
  }

  /**
   * Get current voice metrics from the latest analyser snapshot.
   * @returns {{ pitch: number|null, jitter: number|null, shimmer: number|null, hnr: number|null, rms: number|null, spectralCentroid: number|null, formants: number[]|null, voiceBioCenter: number|null }}
   */
  getMetrics() {
    if (!this.analyser || !this.audioCtx) {
      return { pitch: null, jitter: null, shimmer: null, hnr: null, rms: null, spectralCentroid: null, formants: null, voiceBioCenter: null };
    }

    const bufferLength = this.analyser.fftSize;
    const timeData = new Float32Array(bufferLength);
    this.analyser.getFloatTimeDomainData(timeData);

    const freqData = new Float32Array(this.analyser.frequencyBinCount);
    this.analyser.getFloatFrequencyData(freqData);

    const sampleRate = this.audioCtx.sampleRate;

    const rms = Math.sqrt(timeData.reduce((s, v) => s + v * v, 0) / bufferLength);
    const pitch = rms > 0.01 ? this._detectPitch(timeData, sampleRate) : null;
    const jitter = pitch ? this._calculateJitter(timeData, sampleRate, pitch) : null;
    const shimmer = rms > 0.01 ? this._calculateShimmer(timeData, sampleRate, pitch) : null;
    const hnr = rms > 0.01 ? this._calculateHNR(timeData, pitch, sampleRate) : null;
    const spectralCentroid = this._calculateSpectralCentroid(freqData, sampleRate);
    const formants = rms > 0.01 ? this._detectFormants(freqData, sampleRate) : null;
    const voiceBioCenter = pitch ? this._mapVoiceBioCenter(pitch, spectralCentroid) : null;

    return { pitch, jitter, shimmer, hnr, rms, spectralCentroid, formants, voiceBioCenter };
  }

  /**
   * Autocorrelation-based pitch detection.
   * Scans lag range corresponding to 60–500 Hz.
   * @param {Float32Array} buffer — time-domain samples
   * @param {number} sampleRate
   * @returns {number|null} detected pitch in Hz, or null if signal is too weak
   * @private
   */
  _detectPitch(buffer, sampleRate) {
    const minPeriod = Math.floor(sampleRate / 500); // max 500 Hz
    const maxPeriod = Math.floor(sampleRate / 60);  // min 60 Hz

    let bestCorrelation = 0;
    let bestPeriod = 0;

    for (let period = minPeriod; period < maxPeriod && period < buffer.length / 2; period++) {
      let correlation = 0;
      for (let i = 0; i < buffer.length - period; i++) {
        correlation += buffer[i] * buffer[i + period];
      }
      correlation /= (buffer.length - period);

      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestPeriod = period;
      }
    }

    if (bestCorrelation < 0.01) return null;
    return Math.round(sampleRate / bestPeriod);
  }

  /**
   * Jitter — cycle-to-cycle variation of pitch period.
   * Measured via zero-crossing intervals filtered around the expected period.
   * @param {Float32Array} buffer — time-domain samples
   * @param {number} sampleRate
   * @param {number} pitch — detected fundamental frequency (Hz)
   * @returns {number|null} jitter in %, or null if insufficient periods
   * @private
   */
  _calculateJitter(buffer, sampleRate, pitch) {
    const period = Math.round(sampleRate / pitch);
    const periods = [];

    // Find zero crossings to measure actual periods
    let lastCross = -1;
    for (let i = 1; i < buffer.length; i++) {
      if (buffer[i - 1] <= 0 && buffer[i] > 0) {
        if (lastCross >= 0) {
          const p = i - lastCross;
          if (p > period * 0.5 && p < period * 2) periods.push(p);
        }
        lastCross = i;
      }
    }

    if (periods.length < 3) return null;

    const meanP = periods.reduce((a, b) => a + b) / periods.length;
    let jitterSum = 0;
    for (let i = 1; i < periods.length; i++) {
      jitterSum += Math.abs(periods[i] - periods[i - 1]);
    }
    return (jitterSum / (periods.length - 1)) / meanP * 100;
  }

  /**
   * Shimmer — cycle-to-cycle variation of peak amplitude.
   * Each cycle's amplitude is the max absolute sample within one pitch period.
   * @param {Float32Array} buffer — time-domain samples
   * @param {number} sampleRate
   * @param {number|null} pitch — detected fundamental frequency (Hz)
   * @returns {number|null} shimmer in %, or null if insufficient data
   * @private
   */
  _calculateShimmer(buffer, sampleRate, pitch) {
    if (!pitch) return null;
    const period = Math.round(sampleRate / pitch);
    const amplitudes = [];

    for (let start = 0; start + period < buffer.length; start += period) {
      let max = 0;
      for (let i = start; i < start + period; i++) {
        max = Math.max(max, Math.abs(buffer[i]));
      }
      amplitudes.push(max);
    }

    if (amplitudes.length < 3) return null;

    const meanAmp = amplitudes.reduce((a, b) => a + b) / amplitudes.length;
    if (meanAmp === 0) return null;

    let shimmerSum = 0;
    for (let i = 1; i < amplitudes.length; i++) {
      shimmerSum += Math.abs(amplitudes[i] - amplitudes[i - 1]);
    }
    return (shimmerSum / (amplitudes.length - 1)) / meanAmp * 100;
  }

  /**
   * HNR — harmonics-to-noise ratio (simplified).
   * Harmonic component is estimated by averaging aligned pitch periods;
   * noise is the residual (original minus harmonic).
   * @param {Float32Array} buffer — time-domain samples
   * @param {number|null} pitch — detected fundamental frequency (Hz)
   * @param {number} sampleRate
   * @returns {number|null} HNR in dB, or null if pitch is unknown
   * @private
   */
  _calculateHNR(buffer, pitch, sampleRate) {
    if (!pitch) return null;
    const period = Math.round(sampleRate / pitch);
    const numPeriods = Math.floor(buffer.length / period);
    if (numPeriods < 2) return null;

    // Average waveform (harmonic component)
    const avgWave = new Float32Array(period);
    for (let p = 0; p < numPeriods; p++) {
      for (let i = 0; i < period; i++) {
        avgWave[i] += buffer[p * period + i] / numPeriods;
      }
    }

    // Noise = original - harmonic
    let harmonicEnergy = 0, noiseEnergy = 0;
    for (let p = 0; p < numPeriods; p++) {
      for (let i = 0; i < period; i++) {
        const idx = p * period + i;
        harmonicEnergy += avgWave[i] ** 2;
        noiseEnergy += (buffer[idx] - avgWave[i]) ** 2;
      }
    }

    if (noiseEnergy === 0) return 30; // perfectly clean
    return Math.round(10 * Math.log10(harmonicEnergy / noiseEnergy));
  }

  /**
   * Spectral centroid — perceptual "brightness" of the sound.
   * Weighted average of frequency bins by their linear magnitude.
   * @param {Float32Array} freqData — frequency-domain data in dB
   * @param {number} sampleRate
   * @returns {number|null} centroid frequency in Hz
   * @private
   */
  _calculateSpectralCentroid(freqData, sampleRate) {
    let weightedSum = 0, totalMag = 0;
    const binWidth = sampleRate / (freqData.length * 2);

    for (let i = 0; i < freqData.length; i++) {
      const mag = Math.pow(10, freqData[i] / 20); // dB → linear
      const freq = i * binWidth;
      weightedSum += freq * mag;
      totalMag += mag;
    }

    if (totalMag === 0) return null;
    return Math.round(weightedSum / totalMag);
  }

  /**
   * Formant detection via spectral peak picking.
   * Finds up to 3 formant peaks (F1, F2, F3) in the frequency spectrum
   * by searching for local maxima in smoothed spectral envelope.
   * @param {Float32Array} freqData — frequency-domain data in dB
   * @param {number} sampleRate
   * @returns {number[]|null} array of [F1, F2, F3] in Hz, or null
   * @private
   */
  _detectFormants(freqData, sampleRate) {
    const binWidth = sampleRate / (freqData.length * 2);

    // Convert to linear magnitude and smooth with 5-bin moving average
    const smoothed = [];
    for (let i = 0; i < freqData.length; i++) {
      let sum = 0, count = 0;
      for (let j = Math.max(0, i - 2); j <= Math.min(freqData.length - 1, i + 2); j++) {
        sum += Math.pow(10, freqData[j] / 20);
        count++;
      }
      smoothed.push(sum / count);
    }

    // Find spectral peaks in voice-relevant range (200-4000 Hz)
    const minBin = Math.ceil(200 / binWidth);
    const maxBin = Math.min(smoothed.length - 1, Math.floor(4000 / binWidth));
    const peaks = [];

    for (let i = minBin + 1; i < maxBin; i++) {
      if (smoothed[i] > smoothed[i - 1] && smoothed[i] > smoothed[i + 1]) {
        // Must be significantly above the noise floor
        if (smoothed[i] > 0.001) {
          peaks.push({ freq: Math.round(i * binWidth), mag: smoothed[i] });
        }
      }
    }

    // Sort by magnitude and pick top 3
    peaks.sort((a, b) => b.mag - a.mag);
    const formants = peaks.slice(0, 3).map(p => p.freq).sort((a, b) => a - b);

    if (formants.length < 2) return null;
    // Pad to 3 if needed
    while (formants.length < 3) formants.push(null);
    return formants;
  }

  /**
   * VoiceBio mapping — maps voice fundamental frequency and spectral energy
   * to one of 7 energy centers (0-6, bottom to top).
   *
   * Based on VoiceBio / Sound Health frequency-to-center correspondence:
   *   0: C (128-136 Hz)  — Root / Stability
   *   1: D (144-152 Hz)  — Sacral / Flow
   *   2: E (160-172 Hz)  — Solar / Energy
   *   3: F (172-184 Hz)  — Heart / Resonance
   *   4: G (192-204 Hz)  — Throat / Vibration
   *   5: A (216-228 Hz)  — Third Eye / Clarity
   *   6: B (240-256 Hz)  — Crown / Integrity
   *
   * For higher octaves, pitch is folded down to the base octave.
   * Spectral centroid provides secondary weighting.
   *
   * @param {number} pitch — fundamental frequency in Hz
   * @param {number|null} spectralCentroid — spectral centroid in Hz
   * @returns {number} energy center index 0-6
   * @private
   */
  _mapVoiceBioCenter(pitch, spectralCentroid) {
    // Fold pitch down to base octave (128-256 Hz)
    let f = pitch;
    while (f > 256) f /= 2;
    while (f < 128) f *= 2;

    // Note boundaries in Hz (base octave, equal temperament from C3=128 Hz)
    // C=128, C#=135.6, D=143.7, D#=152.2, E=161.3, F=170.8,
    // F#=181, G=191.8, G#=203.2, A=215.3, A#=228.1, B=241.6, C=256
    const centers = [
      { note: 'C',  center: 131.8, idx: 0 }, // C-C#
      { note: 'D',  center: 147.9, idx: 1 }, // D-D#
      { note: 'E',  center: 166.0, idx: 2 }, // E
      { note: 'F',  center: 175.9, idx: 3 }, // F-F#
      { note: 'G',  center: 197.5, idx: 4 }, // G-G#
      { note: 'A',  center: 221.7, idx: 5 }, // A-A#
      { note: 'B',  center: 248.8, idx: 6 }, // B
    ];

    // Find closest note center
    let bestIdx = 0;
    let bestDist = Infinity;
    for (const c of centers) {
      const dist = Math.abs(f - c.center);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = c.idx;
      }
    }

    return bestIdx;
  }
}
