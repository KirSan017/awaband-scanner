// dashboard/public/scanner/aura.js

const PARAM_COLORS = [
  '#ff6b8a', '#ff9f5a', '#ffd06b', '#5ae8b0',
  '#5ac8ff', '#8b8aff', '#c77dff'
];

const PARAM_KEYS = [
  'stability', 'flow', 'energy', 'resonance',
  'vibration', 'clarity', 'integrity'
];

export class AuraRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.pulsePhase = 0;
    // Face position (normalized 0-1, smoothed)
    this.faceX = 0.5;
    this.faceY = 0.4;
    this.faceScale = 1.0;
  }

  /**
   * Detect face centroid from offscreen canvas using skin color detection.
   * Works in all browsers, no external dependencies.
   * @param {CanvasRenderingContext2D} ctx - offscreen canvas context with video frame
   * @param {number} width - canvas width
   * @param {number} height - canvas height
   */
  detectFaceFromCanvas(ctx, width, height) {
    // Sample every 8th pixel for performance
    const step = 8;
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    let sumX = 0, sumY = 0, count = 0;
    let minX = width, maxX = 0, minY = height, maxY = 0;

    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const i = (y * width + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];

        if (isSkinColor(r, g, b)) {
          sumX += x;
          sumY += y;
          count++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (count > 20) { // need enough skin pixels to be confident
      // Centroid normalized to 0-1, mirrored X (camera is mirrored)
      const rawX = 1 - (sumX / count) / width;
      const rawCentroidY = (sumY / count) / height;
      // Shift up: skin centroid is ~nose level, move up by ~40% of face height
      // so aura centers around the whole head (forehead to chin)
      const faceH = (maxY - minY) / height;
      const rawY = rawCentroidY - faceH * 0.35;
      // Face size estimate
      const faceW = (maxX - minX) / width;
      const rawScale = Math.max(0.6, Math.min(2.0, faceW * 3.5));

      // Smooth with EMA
      this.faceX = this.faceX * 0.75 + rawX * 0.25;
      this.faceY = this.faceY * 0.75 + rawY * 0.25;
      this.faceScale = this.faceScale * 0.85 + rawScale * 0.15;
    }
  }

  resize(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  /**
   * Render aura glow layers based on biofield parameters
   * @param {{ stability: number, flow: number, energy: number, resonance: number, vibration: number, clarity: number, integrity: number }} params
   * @param {number|null} heartRate - BPM for pulse sync
   */
  render(params, heartRate) {
    const { width, height } = this.canvas;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, width, height);

    // Center on detected face position
    const centerX = this.faceX * width;
    const centerY = this.faceY * height;
    const scale = this.faceScale;

    // Pulse synchronized with heart rate
    const bps = (heartRate ?? 72) / 60;
    this.pulsePhase += bps * 0.016 * Math.PI * 2;

    // Draw 7 glow layers (outer to inner)
    const values = PARAM_KEYS.map(k => params[k]);

    for (let i = 6; i >= 0; i--) {
      const value = values[i] / 100;
      const baseRadius = (60 + i * 22) * scale;
      const pulse = 1 + Math.sin(this.pulsePhase + i * 0.3) * 0.05 * value;
      const radius = baseRadius * pulse * (0.5 + value * 0.5);

      if (radius < 2) continue;

      const gradient = ctx.createRadialGradient(
        centerX, centerY, radius * 0.2,
        centerX, centerY, radius
      );

      const color = PARAM_COLORS[i];
      const alpha = 0.08 + value * 0.2;
      gradient.addColorStop(0, color + '00');
      gradient.addColorStop(0.3, hexToRGBA(color, alpha * 0.3));
      gradient.addColorStop(0.6, hexToRGBA(color, alpha));
      gradient.addColorStop(1, color + '00');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(centerX, centerY, radius * 0.75, radius, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * Skin color detection using YCbCr color space.
 * Works across different skin tones.
 */
function isSkinColor(r, g, b) {
  // Convert RGB to YCbCr
  const y  =  0.299 * r + 0.587 * g + 0.114 * b;
  const cb = -0.169 * r - 0.331 * g + 0.500 * b + 128;
  const cr =  0.500 * r - 0.419 * g - 0.081 * b + 128;

  // Skin color thresholds in YCbCr space
  // These ranges work for a wide variety of skin tones
  return y > 60 && cb > 77 && cb < 127 && cr > 133 && cr < 173;
}

function hexToRGBA(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
