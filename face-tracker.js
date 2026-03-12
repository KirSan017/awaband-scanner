export class FaceTracker {
  constructor() {
    this.detector = null;
    this.mode = 'fallback';
    this._pending = false;
    this._lastBox = null;

    if ('FaceDetector' in window) {
      try {
        this.detector = new window.FaceDetector({
          fastMode: true,
          maxDetectedFaces: 1,
        });
        this.mode = 'native-face-detector';
      } catch {
        this.detector = null;
        this.mode = 'fallback';
      }
    }
  }

  isAvailable() {
    return Boolean(this.detector);
  }

  async detect(source) {
    if (!this.detector) return null;
    if (this._pending) return this._lastBox;

    this._pending = true;
    try {
      const faces = await this.detector.detect(source);
      const face = faces[0];
      this._lastBox = face?.boundingBox
        ? {
            x: face.boundingBox.x,
            y: face.boundingBox.y,
            width: face.boundingBox.width,
            height: face.boundingBox.height,
          }
        : null;
      return this._lastBox;
    } catch {
      this._lastBox = null;
      return null;
    } finally {
      this._pending = false;
    }
  }
}
