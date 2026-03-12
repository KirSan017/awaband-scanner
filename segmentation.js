// segmentation.js — Lazy-loaded MediaPipe Selfie Segmentation
// Not included in base bundle (~90 KB). Loaded on-demand via HD button.

/**
 * PersonSegmentation provides person/background segmentation using
 * MediaPipe Selfie Segmentation, loaded dynamically from CDN.
 *
 * Usage:
 *   const seg = new PersonSegmentation();
 *   await seg.load();           // dynamic import, shows spinner
 *   const mask = seg.getMask(videoFrame);
 *   const contour = seg.getContour(mask);
 */
export class PersonSegmentation {
  constructor() {
    this._model = null;
    this._loading = false;
    this._loaded = false;
    this._error = null;

    // Offscreen canvas for mask processing
    this._maskCanvas = null;
    this._maskCtx = null;

    // Cached contour points
    this._lastContour = null;
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
   * Dynamically load MediaPipe Selfie Segmentation from CDN.
   * @returns {Promise<boolean>} true if loaded successfully
   */
  async load() {
    if (this._loaded) return true;
    if (this._loading) return false;

    this._loading = true;
    this._error = null;

    try {
      // Dynamic import from CDN — not bundled
      const [
        { SelfieSegmentation },
      ] = await Promise.all([
        import('https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1/selfie_segmentation.js'),
      ]);

      this._model = new SelfieSegmentation({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1/${file}`
      });

      this._model.setOptions({
        modelSelection: 0, // 0 = general, 1 = landscape (faster but less accurate)
        selfieMode: true,
      });

      // Store results callback
      this._latestResults = null;
      this._model.onResults((results) => {
        this._latestResults = results;
      });

      // Initialize the model
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
   * @returns {ImageData|null} mask where 255 = person, 0 = background
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
      this._maskCtx = this._maskCanvas.getContext('2d');
    }

    // Draw mask to canvas and extract ImageData
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
    if (!maskData) return this._lastContour || [];

    const { data, width, height } = maskData;
    const points = [];
    const step = 4; // sample every 4th row for performance

    for (let y = 0; y < height; y += step) {
      let leftEdge = -1;
      let rightEdge = -1;

      // Scan left to right for first person pixel
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        if (data[idx] > 128) {
          leftEdge = x;
          break;
        }
      }

      // Scan right to left for last person pixel
      for (let x = width - 1; x >= 0; x--) {
        const idx = (y * width + x) * 4;
        if (data[idx] > 128) {
          rightEdge = x;
          break;
        }
      }

      if (leftEdge >= 0) {
        points.push({ x: leftEdge / width, y: y / height, side: 'left' });
      }
      if (rightEdge >= 0 && rightEdge !== leftEdge) {
        points.push({ x: rightEdge / width, y: y / height, side: 'right' });
      }
    }

    // Sort: left edge top→bottom, right edge bottom→top (forms closed contour)
    const leftPoints = points.filter(p => p.side === 'left').sort((a, b) => a.y - b.y);
    const rightPoints = points.filter(p => p.side === 'right').sort((a, b) => b.y - a.y);

    this._lastContour = [...leftPoints, ...rightPoints];
    return this._lastContour;
  }

  /**
   * Apply background blur using the segmentation mask.
   * Draws the video with blurred background to the provided canvas.
   * @param {CanvasRenderingContext2D} ctx - target canvas context
   * @param {HTMLVideoElement} video - source video
   * @param {ImageData} maskData - segmentation mask
   * @param {number} blurRadius - blur strength in pixels
   */
  applyBackgroundBlur(ctx, video, maskData, blurRadius = 10) {
    if (!maskData) return;

    const { width, height } = ctx.canvas;

    // Draw blurred video
    ctx.save();
    ctx.filter = `blur(${blurRadius}px)`;
    ctx.drawImage(video, 0, 0, width, height);
    ctx.filter = 'none';

    // Create mask from segmentation data
    if (!this._maskCanvas || this._maskCanvas.width !== width || this._maskCanvas.height !== height) {
      this._maskCanvas = document.createElement('canvas');
      this._maskCanvas.width = width;
      this._maskCanvas.height = height;
      this._maskCtx = this._maskCanvas.getContext('2d');
    }

    // Scale mask to canvas size
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = maskData.width;
    tmpCanvas.height = maskData.height;
    const tmpCtx = tmpCanvas.getContext('2d');
    tmpCtx.putImageData(maskData, 0, 0);

    this._maskCtx.drawImage(tmpCanvas, 0, 0, width, height);

    // Composite: draw sharp person on top of blurred background
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(this._maskCanvas, 0, 0);
    ctx.globalCompositeOperation = 'destination-over';
    ctx.drawImage(video, 0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }
}
