// Camera capture and region-of-interest framing.
//
// Rather than decoding the whole video frame, we crop to the aim box the user
// sees on screen. That cuts the pixels the decoder touches by ~10x and removes
// the distractor text elsewhere on the box (part numbers, addresses), which on
// the sample photos is what made whole-frame decoding slow and flaky.

/** Aim box as a fraction of the displayed video, matching the label's shape. */
export const ROI = { widthFraction: 0.92, aspectRatio: 3.2 };

/**
 * Widths the cropped frame is handed to the decoder at.
 *
 * Resampling thin Code 39 bars aliases at certain scale factors: on the sample
 * labels a crop would decode at one width and fail at the next one up. The scan
 * loop alternates between these across frames, so a barcode that aliases at one
 * scale is caught at the other within ~150ms instead of forcing the user to
 * change distance.
 */
export const DECODE_WIDTHS = [900, 640];

/**
 * Open the rear camera.
 *
 * Requests a high capture resolution: we downscale the crop ourselves, and
 * starting from more pixels keeps the narrow Code 39 bars resolvable.
 * `focusMode: continuous` is an "advanced" constraint — browsers that don't
 * support it ignore it rather than failing.
 */
export async function startCamera(videoEl) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser does not support camera access.');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      advanced: [{ focusMode: 'continuous' }],
    },
  });

  videoEl.srcObject = stream;
  // iOS Safari refuses to play inline without all three of these; without
  // playsinline it hijacks the video into a fullscreen player.
  videoEl.setAttribute('playsinline', '');
  videoEl.setAttribute('muted', '');
  videoEl.muted = true;
  await videoEl.play();

  return stream;
}

export function stopCamera(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

/** Whether the active camera exposes a torch/flashlight. */
export function hasTorch(stream) {
  const track = stream?.getVideoTracks()[0];
  return Boolean(track?.getCapabilities?.().torch);
}

export async function setTorch(stream, on) {
  const track = stream?.getVideoTracks()[0];
  if (!track?.getCapabilities?.().torch) return false;
  await track.applyConstraints({ advanced: [{ torch: on }] });
  return true;
}

/**
 * Crop the aim-box region out of the current video frame.
 *
 * The aim box is defined against the *displayed* video, which is
 * object-fit: cover — so part of the source frame is cropped off screen. We
 * mirror that cover geometry here so the decoded region matches what the user
 * is actually aiming at; otherwise the box would lie.
 *
 * @param {number} decodeWidth width to rasterise the crop at, from DECODE_WIDTHS
 * @returns {ImageData | null} null if the video has no frame yet
 */
export function grabRoi(videoEl, canvas, decodeWidth = DECODE_WIDTHS[0]) {
  const sourceW = videoEl.videoWidth;
  const sourceH = videoEl.videoHeight;
  if (!sourceW || !sourceH) return null;

  const displayW = videoEl.clientWidth;
  const displayH = videoEl.clientHeight;
  if (!displayW || !displayH) return null;

  // object-fit: cover — the larger scale factor wins and the excess is clipped.
  const scale = Math.max(displayW / sourceW, displayH / sourceH);
  const visibleW = displayW / scale; // source pixels actually on screen
  const visibleH = displayH / scale;
  const offsetX = (sourceW - visibleW) / 2;
  const offsetY = (sourceH - visibleH) / 2;

  const roiW = visibleW * ROI.widthFraction;
  const roiH = roiW / ROI.aspectRatio;
  const roiX = offsetX + (visibleW - roiW) / 2;
  const roiY = offsetY + (visibleH - roiH) / 2;

  const outW = Math.min(decodeWidth, Math.round(roiW));
  const outH = Math.max(1, Math.round((outW * roiH) / roiW));
  if (canvas.width !== outW || canvas.height !== outH) {
    canvas.width = outW;
    canvas.height = outH;
  }

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(videoEl, roiX, roiY, roiW, roiH, 0, 0, outW, outH);
  return ctx.getImageData(0, 0, outW, outH);
}
