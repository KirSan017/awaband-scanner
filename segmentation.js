// segmentation.js — Lazy-loaded MediaPipe Selfie Segmentation
// Not included in base bundle (~90 KB). Loaded on-demand via HD button.
// Uses <script> tag injection since MediaPipe SDK is UMD, not ESM.

/**
 * Load a script from URL, returning a Promise.
 * @param {string} url
 * @returns {Promise<void>}
 */
function loadScript(url) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.crossOrigin = 'anonymous';
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load: ${url}`));
    document.head.appendChild(s);
  });
}

const MP_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1';

export class PersonSegmentation {
  constructor() {
    this._model = null;
    this._loading = false;
    this._loaded = false;
    this._error = null;
    this._latestResults = null;

    // Offscreen canvases for mask processing
    this._maskCanvas = null;
    this._maskCtx = null;
    this._tmpCanvas = null;
    this._tmpCtx = null;
  }

  /** @returns {boolean} Whether the model is loaded and ready */
  isLoaded() {
    return this._loaded;
  }

  /** @returns {boolean} Whether the model is currently loading */
  isLoading() {
    return this._loading;
  }

  /** @returns {string|null} Error message if loading failed */
  getError() {
    return this._error;
  }

  /**
   * Load MediaPipe Selfie Segmentation from CDN via script tag.
   * @returns {Promise<boolean>} true if loaded successfully
   */
  async load() {
    if (this._loaded) return true;
    if (this._loading) return false;

    this._loading = true;
    this._error = null;

    try {
      // Load the MediaPipe script (exposes window.SelfieSegmentation)
      if (!window.SelfieSegmentation) {
        await loadScript(`${MP_CDN}/selfie_segmentation.js`);
      }

      const SelfieSegmentation = window.SelfieSegmentation;
      if (!SelfieSegmentation) {
        throw new Error('SelfieSegmentation not found after script load');
      }

      this._model = new SelfieSegmentation({
        locateFile: (file) => `${MP_CDN}/${file}`
      });

      this._model.setOptions({
        modelSelection: 0, // 0 = general (more accurate), 1 = landscape (faster)
        selfieMode: true,
      });

      this._model.onResults((results) => {
        this._latestResults = results;
      });

      // Initialize — downloads the .tflite model (~200 KB) + WASM
      await this._model.initialize();

      this._loaded = true;
      this._loading = false;
      return true;
    } catch (err) {
      this._error = err.message || 'Failed to load segmentation model';
      this._loading = false;
      this._loaded = false;
      return false;
    }
  }

  /**
   * Get segmentation mask for a video frame.
   * @param {HTMLVideoElement} video - source video element
   * @returns {Promise<ImageData|null>} mask where 255 = person, 0 = background
   */
  async getMask(video) {
    if (!this._loaded || !this._model) return null;

    try {
      await this._model.send({ image: video });
    } catch {
      return null;
    }

    if (!this._latestResults || !this._latestResults.segmentationMask) return null;

    const mask = this._latestResults.segmentationMask;
    const w = mask.width;
    const h = mask.height;

    // Ensure offscreen canvas
    if (!this._maskCanvas || this._maskCanvas.width !== w || this._maskCanvas.height !== h) {
      this._maskCanvas = document.createElement('canvas');
      this._maskCanvas.width = w;
      this._maskCanvas.height = h;
      this._maskCtx = this._maskCanvas.getContext('2d', { willReadFrequently: true });
    }

    this._maskCtx.drawImage(mask, 0, 0);
    return this._maskCtx.getImageData(0, 0, w, h);
  }

  /**
   * Extract contour points from a binary mask.
   * Returns an array of {x, y} normalized to 0-1.
   * @param {ImageData} maskData - segmentation mask
   * @returns {Array<{x: number, y: number}>} contour points
   */
  getContour(maskData) {
    if (!maskData) return [];

    const { data, width, height } = maskData;
    const points = [];
    const step = 4;

    for (let y = 0; y < height; y += step) {
      let leftEdge = -1;
      let rightEdge = -1;

      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        if (data[idx] > 128) { leftEdge = x; break; }
      }

      for (let x = width - 1; x >= 0; x--) {
        const idx = (y * width + x) * 4;
        if (data[idx] > 128) { rightEdge = x; break; }
      }

      if (leftEdge >= 0) points.push({ x: leftEdge / width, y: y / height, side: 'left' });
      if (rightEdge >= 0 && rightEdge !== leftEdge) points.push({ x: rightEdge / width, y: y / height, side: 'right' });
    }

    const leftPoints = points.filter(p => p.side === 'left').sort((a, b) => a.y - b.y);
    const rightPoints = points.filter(p => p.side === 'right').sort((a, b) => b.y - a.y);
    return [...leftPoints, ...rightPoints];
  }

  /**
   * Apply background blur using the segmentation mask.
   * @param {CanvasRenderingContext2D} ctx - target canvas context
   * @param {HTMLVideoElement} video - source video
   * @param {ImageData} maskData - segmentation mask
   * @param {number} blurRadius - blur strength in pixels
   */
  applyBackgroundBlur(ctx, video, maskData, blurRadius = 10) {
    if (!maskData) return;

    const { width, height } = ctx.canvas;

    // Ensure tmp canvas for mask scaling
    if (!this._tmpCanvas) {
      this._tmpCanvas = document.createElement('canvas');
      this._tmpCtx = this._tmpCanvas.getContext('2d', { willReadFrequently: true });
    }

    // Put mask data into tmp canvas at original size
    this._tmpCanvas.width = maskData.width;
    this._tmpCanvas.height = maskData.height;
    this._tmpCtx.putImageData(maskData, 0, 0);

    // Scale mask to output size
    if (!this._maskCanvas || this._maskCanvas.width !== width || this._maskCanvas.height !== height) {
      this._maskCanvas = document.createElement('canvas');
      this._maskCanvas.width = width;
      this._maskCanvas.height = height;
      this._maskCtx = this._maskCanvas.getContext('2d', { willReadFrequently: true });
    }
    this._maskCtx.drawImage(this._tmpCanvas, 0, 0, width, height);

    // Draw blurred background
    ctx.save();
    ctx.filter = `blur(${blurRadius}px)`;
    ctx.drawImage(video, 0, 0, width, height);
    ctx.filter = 'none';

    // Cut out person shape from blurred layer
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(this._maskCanvas, 0, 0);

    // Draw sharp person underneath
    ctx.globalCompositeOperation = 'destination-over';
    ctx.drawImage(video, 0, 0, width, height);

    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }
}
