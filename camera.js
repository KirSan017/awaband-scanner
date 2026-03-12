/**
 * Camera capture and forehead ROI extraction for rPPG signal processing.
 *
 * Provides utilities to start/stop the front-facing camera and extract
 * average RGB values from the forehead region of interest.
 */

/**
 * Starts the front-facing camera and attaches it to a <video> element.
 * @param {HTMLVideoElement} video
 * @returns {Promise<MediaStream>}
 */
export async function startCamera(video) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false
  });
  video.srcObject = stream;
  await video.play();
  return stream;
}

/**
 * Stops all tracks of a given media stream.
 * @param {MediaStream} stream
 */
export function stopCamera(stream) {
  stream.getTracks().forEach(t => t.stop());
}

/**
 * Returns a ROI rectangle targeting the forehead area.
 * If facePos is provided (from aura.js face detection), ROI follows the face.
 * Otherwise falls back to fixed center third.
 *
 * @param {number} videoWidth
 * @param {number} videoHeight
 * @param {{ x: number, y: number, scale: number }|null} facePos - normalized face position (0-1), x already mirror-corrected
 * @returns {{ x: number, y: number, w: number, h: number }}
 */
export function getForeheadROI(videoWidth, videoHeight, facePos = null) {
  if (facePos) {
    const scale = facePos.scale || 1;
    const roiW = Math.round(videoWidth * 0.25 * scale);
    const roiH = Math.round(videoHeight * 0.12 * scale);
    // Forehead: slightly above face center
    const cx = Math.round(facePos.x * videoWidth);
    const cy = Math.round((facePos.y - 0.15 * scale) * videoHeight);
    const x = Math.max(0, Math.min(videoWidth - roiW, cx - Math.round(roiW / 2)));
    const y = Math.max(0, Math.min(videoHeight - roiH, cy - Math.round(roiH / 2)));
    return { x, y, w: roiW, h: roiH };
  }

  // Fallback: fixed center third
  const w = Math.round(videoWidth / 3);
  const h = Math.round(videoHeight * 0.15);
  const x = Math.round(videoWidth / 3);
  const y = Math.round(videoHeight * 0.15);
  return { x, y, w, h };
}

/**
 * Extracts average RGB values from a canvas region defined by the ROI.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ x: number, y: number, w: number, h: number }} roi
 * @returns {{ r: number, g: number, b: number }}
 */
export function extractROIPixels(ctx, roi) {
  const imageData = ctx.getImageData(roi.x, roi.y, roi.w, roi.h);
  const data = imageData.data;
  let rSum = 0, gSum = 0, bSum = 0;
  const pixelCount = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    rSum += data[i];
    gSum += data[i + 1];
    bSum += data[i + 2];
  }
  return {
    r: rSum / pixelCount,
    g: gSum / pixelCount,
    b: bSum / pixelCount
  };
}
