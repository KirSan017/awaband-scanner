// dashboard/public/scanner/vitals.js

/**
 * Detect peaks in pulse signal → inter-beat intervals → HRV (RMSSD)
 * @param {number[]} pulseSignal - pulse signal from RPPGProcessor.getPulseSignal()
 * @param {number} fps - frames per second (typically 30)
 * @returns {{ rmssd: number, ibis: number[] } | null}
 */
export function calculateHRV(pulseSignal, fps) {
  // Find peaks (local maxima with 2-sample window)
  const peaks = [];
  for (let i = 2; i < pulseSignal.length - 2; i++) {
    if (pulseSignal[i] > pulseSignal[i-1] &&
        pulseSignal[i] > pulseSignal[i+1] &&
        pulseSignal[i] > pulseSignal[i-2] &&
        pulseSignal[i] > pulseSignal[i+2]) {
      peaks.push(i);
    }
  }

  if (peaks.length < 3) return null;

  // Inter-beat intervals in ms
  const ibis = [];
  for (let i = 1; i < peaks.length; i++) {
    const ibi = ((peaks[i] - peaks[i-1]) / fps) * 1000;
    // Filter: IBI must be 333-1500 ms (40-180 BPM)
    if (ibi >= 333 && ibi <= 1500) {
      ibis.push(ibi);
    }
  }

  if (ibis.length < 2) return null;

  // RMSSD — standard HRV metric (root mean square of successive differences)
  let sumSquaredDiffs = 0;
  for (let i = 1; i < ibis.length; i++) {
    sumSquaredDiffs += (ibis[i] - ibis[i-1]) ** 2;
  }
  const rmssd = Math.sqrt(sumSquaredDiffs / (ibis.length - 1));

  return { rmssd, ibis };
}

/**
 * Breathing rate from HRV signal (respiratory sinus arrhythmia).
 * Counts zero-crossings in IBI series to estimate breath cycles.
 * @param {number[]} ibis - inter-beat intervals in ms
 * @returns {number | null} breaths per minute (8-25 range)
 */
export function calculateBreathingRate(ibis) {
  if (ibis.length < 8) return null;

  const meanIBI = ibis.reduce((a, b) => a + b) / ibis.length;

  // Count oscillations in IBI values (zero-crossings around mean)
  let crossings = 0;
  for (let i = 1; i < ibis.length; i++) {
    if ((ibis[i] > meanIBI) !== (ibis[i-1] > meanIBI)) {
      crossings++;
    }
  }

  const durationSec = ibis.reduce((a, b) => a + b) / 1000;
  // Each breath cycle = 2 crossings
  const breathsPerMin = (crossings / 2) / durationSec * 60;

  // Sanity: 8-25 breaths/min
  if (breathsPerMin < 8 || breathsPerMin > 25) return null;
  return Math.round(breathsPerMin);
}

/**
 * Heart coherence: ratio of peak power around 0.1Hz to total power in HRV spectrum.
 * Based on HeartMath methodology — high coherence = dominant ~0.1 Hz rhythm.
 * @param {number[]} ibis - inter-beat intervals in ms
 * @returns {number | null} coherence score 0-100
 */
export function calculateCoherence(ibis) {
  if (ibis.length < 10) return null;

  const N = ibis.length;
  const mean = ibis.reduce((a, b) => a + b) / N;
  const centered = ibis.map(v => v - mean);

  // DFT on IBI series
  const sampleRate = 1000 / mean;
  let totalPower = 0;
  let peakPower = 0;

  for (let k = 1; k < N / 2; k++) {
    let real = 0, imag = 0;
    for (let n = 0; n < N; n++) {
      const angle = (2 * Math.PI * k * n) / N;
      real += centered[n] * Math.cos(angle);
      imag -= centered[n] * Math.sin(angle);
    }
    const power = real * real + imag * imag;
    const freq = k * sampleRate / N;

    totalPower += power;
    // Coherence band: 0.04 - 0.26 Hz (LF range)
    if (freq >= 0.04 && freq <= 0.26) {
      peakPower = Math.max(peakPower, power);
    }
  }

  if (totalPower === 0) return null;
  // Normalize to 0-100
  return Math.min(100, Math.round((peakPower / totalPower) * 300));
}
