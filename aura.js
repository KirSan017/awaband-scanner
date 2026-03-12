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
    this.geometryPhase = 0;
    // Face position (normalized 0-1, smoothed)
    this.faceX = 0.5;
    this.faceY = 0.4;
    this.faceScale = 1.0;
    // VoiceBio active center (-1 = none)
    this.activeCenter = -1;
    this.activeCenterSmoothed = -1;
    // Face detection state
    this.faceDetected = false;
    this.framesWithoutFace = 0;
    // Emotion state
    this.emotions = null;
    // Laugh sparkle particles
    this._particles = [];
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

    // Total sampled pixels; face typically covers 10-30% of frame.
    // Threshold ~2% filters out warm-toned backgrounds (walls, wood).
    const totalSampled = Math.floor(width / step) * Math.floor(height / step);
    const minSkinPixels = Math.max(40, Math.round(totalSampled * 0.02));

    if (count > minSkinPixels) {
      this.faceDetected = true;
      this.framesWithoutFace = 0;

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
    } else {
      this.faceDetected = false;
      this.framesWithoutFace++;
    }
  }

  /**
   * Update face state from a bounding box produced by a stronger detector.
   * @param {{ x: number, y: number, width: number, height: number }|null} box
   * @param {number} frameWidth
   * @param {number} frameHeight
   */
  updateFaceFromBox(box, frameWidth, frameHeight) {
    if (!box) {
      this.faceDetected = false;
      this.framesWithoutFace++;
      return;
    }

    this.faceDetected = true;
    this.framesWithoutFace = 0;

    const rawX = 1 - ((box.x + box.width / 2) / frameWidth);
    const rawCentroidY = (box.y + box.height / 2) / frameHeight;
    const faceH = box.height / frameHeight;
    const rawY = rawCentroidY - faceH * 0.35;
    const faceW = box.width / frameWidth;
    const rawScale = Math.max(0.6, Math.min(2.0, faceW * 3.5));

    this.faceX = this.faceX * 0.75 + rawX * 0.25;
    this.faceY = this.faceY * 0.75 + rawY * 0.25;
    this.faceScale = this.faceScale * 0.85 + rawScale * 0.15;
  }

  resize(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  /**
   * Set the active VoiceBio energy center for visual highlighting.
   * @param {number} centerIdx - 0-6 energy center index, or -1 for none
   */
  setVoiceBioCenter(centerIdx) {
    this.activeCenter = centerIdx;
  }

  /**
   * Set current emotion state for visual effects.
   * @param {{ laughing: boolean, smiling: boolean, laughIntensity: number, smileIntensity: number }|null} emotions
   */
  setEmotions(emotions) {
    this.emotions = emotions;
  }

  /**
   * Render aura glow layers, sacred geometry, and VoiceBio highlighting.
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
    this.geometryPhase += 0.008;

    // Smooth VoiceBio center transition
    if (this.activeCenter >= 0) {
      this.activeCenterSmoothed += (this.activeCenter - this.activeCenterSmoothed) * 0.1;
    }

    // Draw 7 glow layers (outer to inner)
    const values = PARAM_KEYS.map(k => params[k]);
    const avgValue = values.reduce((a, b) => a + b, 0) / values.length / 100;

    for (let i = 6; i >= 0; i--) {
      const value = values[i] / 100;
      const baseRadius = (60 + i * 22) * scale;
      const pulse = 1 + Math.sin(this.pulsePhase + i * 0.3) * 0.05 * value;
      const radius = baseRadius * pulse * (0.5 + value * 0.5);

      if (radius < 2) continue;

      // VoiceBio boost: active center glows brighter
      const isActive = this.activeCenter >= 0 && Math.abs(i - this.activeCenterSmoothed) < 1;
      const voiceBioBoost = isActive ? 0.15 : 0;

      // Smile boost: layer 3 (Resonance, green) gets extra alpha + gentle pulsation
      let smileBoost = 0;
      if (i === 3 && this.emotions && this.emotions.smiling) {
        const si = this.emotions.smileIntensity / 100;
        smileBoost = si * 0.15 * (0.8 + 0.2 * Math.sin(this.pulsePhase * 0.5));
      }

      const gradient = ctx.createRadialGradient(
        centerX, centerY, radius * 0.2,
        centerX, centerY, radius
      );

      const color = PARAM_COLORS[i];
      const alpha = 0.08 + value * 0.2 + voiceBioBoost + smileBoost;
      gradient.addColorStop(0, color + '00');
      gradient.addColorStop(0.3, hexToRGBA(color, alpha * 0.3));
      gradient.addColorStop(0.6, hexToRGBA(color, alpha));
      gradient.addColorStop(1, color + '00');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(centerX, centerY, radius * 0.75, radius, 0, 0, Math.PI * 2);
      ctx.fill();

      // VoiceBio ring pulse on active center
      if (isActive) {
        const ringPulse = 0.5 + 0.5 * Math.sin(this.pulsePhase * 2);
        ctx.strokeStyle = hexToRGBA(color, 0.3 * ringPulse);
        ctx.lineWidth = 2 * scale;
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, radius * 0.75, radius, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Sacred geometry overlay — drawn on top of glow layers
    this._drawSacredGeometry(ctx, centerX, centerY, scale, values, avgValue);

    // Emotion visual effects
    this._updateAndDrawParticles(ctx, centerX, centerY, scale);
  }

  /**
   * Draw sacred geometry patterns that react to biofield parameters.
   * Patterns: Flower of Life circles, rotating triangles, spiral arms.
   * @private
   */
  _drawSacredGeometry(ctx, cx, cy, scale, values, avgValue) {
    const t = this.geometryPhase;
    const alpha = avgValue * 0.25; // patterns fade with low overall values

    if (alpha < 0.02) return;

    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    // ── 1. Flower of Life: 6 overlapping circles around center ──
    const smileScale = (this.emotions && this.emotions.smiling)
      ? 1 + (this.emotions.smileIntensity / 100) * 0.15
      : 1;
    const flowerRadius = (50 + values[3] * 0.5) * scale * smileScale; // Resonance drives size, smile enlarges
    const petalAlpha = alpha * 0.4 * (values[3] / 100);

    if (petalAlpha > 0.01) {
      ctx.strokeStyle = hexToRGBA('#ffffff', petalAlpha);
      ctx.lineWidth = 0.8;

      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2 + t * 0.3;
        const px = cx + Math.cos(angle) * flowerRadius * 0.5;
        const py = cy + Math.sin(angle) * flowerRadius * 0.5;
        ctx.beginPath();
        ctx.arc(px, py, flowerRadius * 0.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Center circle
      ctx.beginPath();
      ctx.arc(cx, cy, flowerRadius * 0.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // ── 2. Rotating triangles (Sri Yantra inspired) ──
    const triRadius = (80 + values[6] * 0.4) * scale; // Integrity drives size
    const triAlpha = alpha * 0.3 * (values[6] / 100);

    if (triAlpha > 0.01) {
      // Upward triangle
      ctx.strokeStyle = hexToRGBA('#5ae8b0', triAlpha);
      ctx.lineWidth = 1;
      this._drawTriangle(ctx, cx, cy, triRadius, t * 0.2);

      // Downward triangle (inverted, counter-rotating)
      ctx.strokeStyle = hexToRGBA('#c77dff', triAlpha);
      this._drawTriangle(ctx, cx, cy, triRadius * 0.85, -t * 0.15 + Math.PI);
    }

    // ── 3. Spiral arms — Energy and Flow driven ──
    const spiralIntensity = (values[2] + values[1]) / 200; // Energy + Flow
    const spiralAlpha = alpha * 0.2 * spiralIntensity;

    if (spiralAlpha > 0.01) {
      const arms = 3;
      for (let a = 0; a < arms; a++) {
        const baseAngle = (a / arms) * Math.PI * 2 + t * 0.5;
        ctx.strokeStyle = hexToRGBA(PARAM_COLORS[a + 1], spiralAlpha);
        ctx.lineWidth = 1;
        ctx.beginPath();

        for (let s = 0; s < 60; s++) {
          const ratio = s / 60;
          const r = (20 + ratio * 120) * scale;
          const angle = baseAngle + ratio * Math.PI * 1.5;
          const x = cx + Math.cos(angle) * r * 0.75;
          const y = cy + Math.sin(angle) * r;
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }

    // ── 4. Pulsing dots on vertices — Vibration driven ──
    const dotIntensity = values[4] / 100; // Vibration
    const dotAlpha = alpha * 0.5 * dotIntensity;

    if (dotAlpha > 0.01) {
      const dotCount = 12;
      const dotRadius = (100 + values[4] * 0.3) * scale;
      for (let i = 0; i < dotCount; i++) {
        const angle = (i / dotCount) * Math.PI * 2 + t * 0.4;
        const pulse = 0.6 + 0.4 * Math.sin(this.pulsePhase + i * 0.8);
        const r = 2 * scale * pulse;
        const x = cx + Math.cos(angle) * dotRadius * 0.75;
        const y = cy + Math.sin(angle) * dotRadius;

        ctx.fillStyle = hexToRGBA(PARAM_COLORS[4], dotAlpha * pulse);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  /**
   * Update and draw laugh sparkle particles.
   * Spawns golden particles when laughing, updates physics, draws with alpha fade.
   * @private
   */
  _updateAndDrawParticles(ctx, cx, cy, scale) {
    const now = performance.now();

    // Spawn new particles when laughing
    if (this.emotions && this.emotions.laughing) {
      const intensity = this.emotions.laughIntensity / 100;
      const count = Math.round(2 + intensity * 4); // 2-6 particles per frame
      for (let i = 0; i < count; i++) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.8;
        const speed = (1.5 + Math.random() * 2.5) * scale;
        this._particles.push({
          x: cx + (Math.random() - 0.5) * 30 * scale,
          y: cy - 10 * scale,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1.0,
          decay: 0.015 + Math.random() * 0.02,
          size: (2 + intensity * 3) * scale,
          born: now
        });
      }
    }

    // Update and draw
    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    for (let i = this._particles.length - 1; i >= 0; i--) {
      const p = this._particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy -= 0.02 * scale; // slight upward drift
      p.life -= p.decay;

      if (p.life <= 0) {
        this._particles.splice(i, 1);
        continue;
      }

      const alpha = p.life * 0.8;
      ctx.fillStyle = `rgba(255, 215, 0, ${alpha})`; // #FFD700 gold
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();

      // Glow
      if (alpha > 0.3) {
        ctx.fillStyle = `rgba(255, 215, 0, ${alpha * 0.3})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life * 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();

    // Cap particle count
    if (this._particles.length > 100) {
      this._particles.splice(0, this._particles.length - 100);
    }
  }

  /**
   * Draw an equilateral triangle centered at (cx, cy).
   * @private
   */
  _drawTriangle(ctx, cx, cy, radius, rotation) {
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const angle = rotation + (i / 3) * Math.PI * 2 - Math.PI / 2;
      const x = cx + Math.cos(angle) * radius * 0.75;
      const y = cy + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
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
