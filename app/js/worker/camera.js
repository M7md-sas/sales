/**
 * The in-app camera — the notebook is photographed inside the app itself,
 * with a live view and one shutter button, instead of handing over to the
 * phone's camera or file picker.
 *
 * Rear camera, the highest resolution the phone offers up to ~4K; the frame
 * is compressed afterwards by capture.js exactly like any other photo. The
 * torch button appears only on phones whose camera supports it (most
 * Android; not iPhone Safari).
 *
 * If the browser has no camera API, the page is not on HTTPS, or permission
 * is refused, start() says so and the caller falls back to the system camera
 * through <input type="file" capture>.
 */

let stream = null;
let torchOn = false;

/** True when this browser can show a live camera at all. */
export function cameraSupported() {
  return Boolean(navigator.mediaDevices?.getUserMedia) && window.isSecureContext;
}

/**
 * Open the rear camera into a <video>.
 * @returns {Promise<{ok: true, torch: boolean} | {ok: false, reason: 'denied'|'unavailable'}>}
 */
export async function startCamera(video) {
  stopCamera();
  if (!cameraSupported()) return { ok: false, reason: 'unavailable' };

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 3840 },
        height: { ideal: 2160 },
      },
    });
  } catch (error) {
    stream = null;
    const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
    return { ok: false, reason: denied ? 'denied' : 'unavailable' };
  }

  video.srcObject = stream;
  video.setAttribute('playsinline', '');   // iPhone: stay inline, not full-screen
  video.muted = true;
  try { await video.play(); } catch { /* autoplay is allowed for muted video */ }

  const track = stream.getVideoTracks()[0];
  const caps = typeof track?.getCapabilities === 'function' ? track.getCapabilities() : {};
  torchOn = false;
  return { ok: true, torch: Boolean(caps.torch) };
}

/** Turn the flash light on or off. Returns the new state. */
export async function toggleTorch() {
  const track = stream?.getVideoTracks()[0];
  if (!track) return false;
  try {
    await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
    torchOn = !torchOn;
  } catch { /* unsupported after all */ }
  return torchOn;
}

/**
 * Take the current frame as a full-resolution JPEG.
 * @returns {Promise<Blob>}
 */
export async function snap(video) {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) throw new Error('camera_not_ready');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(video, 0, 0, width, height);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  canvas.width = canvas.height = 0;   // release the memory now, not at GC
  if (!blob) throw new Error('snap_failed');
  return blob;
}

/** Release the camera (the green camera dot goes off). */
export function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  torchOn = false;
}
