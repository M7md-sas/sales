/**
 * Turning a 6 MB camera photo into something Gemini can still read.
 *
 * 1600 px on the long edge at quality 0.7 lands around 200–300 KB (guide 9.4).
 * Before changing either number, re-run acceptance test 11.2 against a real
 * notebook page: this setting affects extraction accuracy, not just upload
 * speed, and a smaller file that the model misreads costs far more than the
 * kilobytes it saves.
 */
import { CONFIG } from '../config.js';

/**
 * @param {File|Blob} file straight from the camera input
 * @returns {Promise<Blob>} JPEG
 */
export async function compressImage(file) {
  const bitmap = await toBitmap(file);
  const { MAX_EDGE, QUALITY } = CONFIG.PHOTO;

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  const ctx = canvas.getContext('2d');
  // White underneath: a JPEG has no alpha, and an unfilled canvas turns black.
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  if (bitmap.close) bitmap.close();

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', QUALITY));
  if (!blob) throw new Error('compression_failed');
  return blob;
}

/**
 * createImageBitmap with imageOrientation honours the EXIF rotation flag, so
 * a page shot in portrait does not reach the model on its side. Older Safari
 * ignores the option, hence the <img> fallback — which the browser has
 * already rotated for us by the time it decodes.
 */
async function toBitmap(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch { /* fall through */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode_failed')); };
    img.src = url;
  });
}

/** Data URL ⇄ Blob, for holding a photo in the offline queue. */
export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(dataUrl) {
  return (await fetch(dataUrl)).blob();
}
