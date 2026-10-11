/**
 * Uploading a photograph to the private `receipts` bucket.
 *
 * Upload only. Reading a photo back is in data/photos.js, which the worker
 * app never imports — his build genuinely contains no code that can retrieve
 * an image, on top of the storage policy that already refuses him.
 */
import { supabase } from '../core/supabase.js';
import { CONFIG } from '../config.js';

/**
 * @param {Blob} blob compressed JPEG
 * @param {string} path e.g. '2026-08-07_1754562000000.jpg' — never leading '/'
 * @returns {Promise<{ok: boolean, path?: string, error?: any}>}
 */
export async function uploadPhoto(blob, path) {
  const { error } = await supabase.storage
    .from(CONFIG.BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  return error ? { ok: false, error } : { ok: true, path };
}

/** Storage path for a daily submission. Appendix C: no leading slash, ever. */
export function dailyPath(isoDate) {
  return `${isoDate}_${Date.now()}.jpg`;
}

/** Storage path for a historical import. Kept in its own folder for clarity. */
export function backfillPath(isoDate) {
  return `backfill/${isoDate}_${Date.now()}.jpg`;
}
