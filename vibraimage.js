// vibraimage.js — Micro-movement analysis based on inter-frame differences
// Inspired by Viktor Minkin's Vibraimage technology

/**
 * VibraimageProcessor analyzes micro-tremor of the head/face region
 * by computing pixel-level differences between consecutive video frames.
 *
 * Outputs:
 * - amplitude: average magnitude of micro-movements (0-100)
 * - frequency: dominant frequency of micro-tremor oscillation (0-100)
 * - symmetry: left-right balance of micro-movements (0-100, 50=perfect)
 * - entropy: regularity of movement patterns (0-100)
 */
export class VibraimageProcessor {
  constructor() {
    this.prevFrameData = null;
    this.diffHistory = [];       // rolling buffer of frame diff magnitudes
    this.symmetryHistory = [];   // rolling buffer of L/R asymmetry
    this.upperDiffHistory = [];  // rolling buffer of upper-half diff
    this.lowerDiffHistory = [];  // rolling buffer of lower-half diff
    this.maxHistory = 128;       // ~4 seconds at 30fps
    this.frameCount = 0;
  }

  /**
   * Process a new frame from the face ROI region.
   * @param {CanvasRenderingContext2D} ctx - canvas context with current frame
   * @param {{ x: number, y: number, w: number, h: number }} roi - face region
   */
  processFrame(ctx, roi) {
    const imageData = ctx.getImageData(roi.x, roi.y, roi.w, roi.h);
    const data = imageData.data;
    const pixelCount = data.length / 4;

    if (!this.prevFrameData || this.prevFrameData.length !== data.length) {
      this.prevFrameData = new Uint8Array(data);
      this.frameCount++;
      return;
    }

    // Compute inter-frame differences (grayscale luminance delta)
    let totalDiff = 0;
    let leftDiff = 0, rightDiff = 0;
    let leftPixels = 0, rightPixels = 0;
    let upperDiff = 0, lowerDiff = 0;
    let upperPixels = 0, lowerPixels = 0;
    const halfW = Math.floor(roi.w / 2);
    const halfH = Math.floor(roi.h / 2);

    for (let i = 0; i < data.length; i += 4) {
      const pixelIdx = i / 4;
      const x = pixelIdx % roi.w;
      const y = Math.floor(pixelIdx / roi.w);

      // Luminance: 0.299R + 0.587G + 0.114B
      const lumCurr = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
      const lumPrev = this.prevFrameData[i] * 0.299 + this.prevFrameData[i+1] * 0.587 + this.prevFrameData[i+2] * 0.114;
      const diff = Math.abs(lumCurr - lumPrev);

      totalDiff += diff;

      // Left/right split for symmetry analysis
      if (x < halfW) {
        leftDiff += diff;
        leftPixels++;
      } else {
        rightDiff += diff;
        rightPixels++;
      }

      // Upper/lower split for smile detection
      if (y < halfH) {
        upperDiff += diff;
        upperPixels++;
      } else {
        lowerDiff += diff;
        lowerPixels++;
      }
    }

    // Average diff per pixel (0-255 range, typically 0-10 for micro-movements)
    const avgDiff = totalDiff / pixelCount;

    // L/R asymmetry: 0 = symmetric, higher = asymmetric
    const leftAvg = leftPixels > 0 ? leftDiff / leftPixels : 0;
    const rightAvg = rightPixels > 0 ? rightDiff / rightPixels : 0;
    const maxLR = Math.max(leftAvg, rightAvg, 0.001);
    const asymmetry = Math.abs(leftAvg - rightAvg) / maxLR;

    // Upper/lower average diffs
    const upperAvg = upperPixels > 0 ? upperDiff / upperPixels : 0;
    const lowerAvg = lowerPixels > 0 ? lowerDiff / lowerPixels : 0;

    // Store history
    this.diffHistory.push(avgDiff);
    this.symmetryHistory.push(asymmetry);
    this.upperDiffHistory.push(upperAvg);
    this.lowerDiffHistory.push(lowerAvg);
    if (this.diffHistory.length > this.maxHistory) {
      this.diffHistory.shift();
      this.symmetryHistory.shift();
      this.upperDiffHistory.shift();
      this.lowerDiffHistory.shift();
    }

    // Save current frame for next comparison
    this.prevFrameData.set(data);
    this.frameCount++;
  }

  /**
   * Get current vibraimage metrics.
   * @returns {{ amplitude: number, frequency: number, symmetry: number, entropy: number, amplitudeLower: number } | null}
   */
  getMetrics() {
    if (this.diffHistory.length < 30) return null;

    const hist = this.diffHistory;
    const N = hist.length;

    // ── Amplitude: normalized average movement magnitude ──
    const meanDiff = hist.reduce((a, b) => a + b, 0) / N;
    // Typical micro-tremor: 0.5-5.0 avg pixel diff → map to 0-100
    const amplitude = Math.min(100, Math.round((meanDiff / 4) * 100));

    // ── Amplitude Lower: lower-face region movement (for smile detection) ──
    const meanLowerDiff = this.lowerDiffHistory.reduce((a, b) => a + b, 0) / this.lowerDiffHistory.length;
    const amplitudeLower = Math.min(100, Math.round((meanLowerDiff / 4) * 100));

    // ── Frequency: dominant oscillation frequency via zero-crossing rate ──
    const mean = meanDiff;
    let crossings = 0;
    for (let i = 1; i < N; i++) {
      if ((hist[i] > mean) !== (hist[i-1] > mean)) crossings++;
    }
    // ~30fps, crossings/2 = oscillations per buffer, normalize to 0-100
    const oscillationsPerSec = (crossings / 2) / (N / 30);
    // Normal micro-tremor: 2-15 Hz → map to 0-100
    const frequency = Math.min(100, Math.round((oscillationsPerSec / 12) * 100));

    // ── Symmetry: L/R balance (low asymmetry = high symmetry score) ──
    const meanAsym = this.symmetryHistory.reduce((a, b) => a + b, 0) / this.symmetryHistory.length;
    const symmetry = Math.round(Math.max(0, (1 - meanAsym * 2)) * 100);

    // ── Entropy: regularity of movement pattern (Shannon-like) ──
    // Bin the diff values and compute distribution entropy
    const bins = new Array(10).fill(0);
    const maxVal = Math.max(...hist, 0.001);
    for (const v of hist) {
      const bin = Math.min(9, Math.floor((v / maxVal) * 10));
      bins[bin]++;
    }
    let entropySum = 0;
    for (const count of bins) {
      if (count > 0) {
        const p = count / N;
        entropySum -= p * Math.log2(p);
      }
    }
    // Max entropy for 10 bins = log2(10) ≈ 3.32
    // High entropy = irregular/chaotic, low = repetitive/calm
    const entropy = Math.min(100, Math.round((entropySum / 3.32) * 100));

    return { amplitude, frequency, symmetry, entropy, amplitudeLower };
  }

  /** Reset processor state */
  reset() {
    this.prevFrameData = null;
    this.diffHistory = [];
    this.symmetryHistory = [];
    this.upperDiffHistory = [];
    this.lowerDiffHistory = [];
    this.frameCount = 0;
  }
}
