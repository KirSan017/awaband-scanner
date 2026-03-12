// calibration.js — Personal baseline calibration
// Collects samples during first ~15 seconds to establish personal norms

/**
 * PersonalBaseline collects physiological samples during calibration
 * and computes median values for personalized scoring.
 */
export class PersonalBaseline {
  constructor() {
    this.samples = { hr: [], rmssd: [], amplitude: [] };
    this.baseline = null;
    this.isFinalized = false;
  }

  /**
   * Add a sample during calibration phase.
   * @param {'hr'|'rmssd'|'amplitude'} metric
   * @param {number} value
   */
  addSample(metric, value) {
    if (this.isFinalized) return;
    if (this.samples[metric]) {
      this.samples[metric].push(value);
    }
  }

  /**
   * Finalize calibration — compute medians from collected samples.
   * Call when enough data is collected (e.g., buffer fullness > 0.5).
   */
  finalize() {
    if (this.isFinalized) return;
    this.baseline = {
      hrMedian: median(this.samples.hr),
      rmssdMedian: median(this.samples.rmssd),
      amplitudeMedian: median(this.samples.amplitude),
    };
    this.isFinalized = true;
  }

  /**
   * Get baseline values for biofield calculation.
   * @returns {{ hrMedian: number|null, rmssdMedian: number|null, amplitudeMedian: number|null }|null}
   */
  getBaseline() {
    return this.baseline;
  }

  /**
   * Get deviation of current value from personal baseline.
   * @param {number} current
   * @param {'hr'|'rmssd'|'amplitude'} metric
   * @returns {number} deviation as percentage (0 = at baseline, 100 = far from it)
   */
  getDeviation(current, metric) {
    if (!this.baseline) return 0;
    const key = metric + 'Median';
    const base = this.baseline[key];
    if (!base || base === 0) return 0;
    return Math.min(100, Math.round(Math.abs(current - base) / base * 100));
  }
}

/** Compute median of a number array. Returns null if empty. */
function median(arr) {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}
