/**
 * The worker's entire data layer. One function, one direction.
 *
 * submit_photo() is the only door the worker account has into the database,
 * and it answers with { ok, code } — never a figure, never a hint that a row
 * already existed. Nothing else in this file, deliberately: if a future
 * change needs to read something back here, that change is wrong.
 *
 * Build guide: Sections 3.1, 8, 9.4.
 */
import { supabase } from '../core/supabase.js';
import { attempt, isOffline, isAuthError } from '../core/errors.js';
import { uploadPhoto, dailyPath } from './storage.js';
import { CONFIG } from '../config.js';
import { todayRiyadh } from '../core/format.js';

/**
 * Upload the photo, then register it for its business day.
 *
 * [4.2] `date` is null for a live send: the server decides the day from its
 * own clock. Only a photo that waited in the offline queue carries the day it
 * was taken on the phone (DEVIATIONS.md #9).
 *
 * @param {{date: string|null, blob: Blob, notes?: string}} submission
 * @returns {Promise<{ok: boolean, code: string}>}
 */
export async function submitPhoto({ date, blob, notes = null }) {
  if (!blob) return { ok: false, code: 'photo_required' };
  if (blob.size > CONFIG.PHOTO.MAX_BYTES) return { ok: false, code: 'photo_too_large' };

  // The name only has to be unique and match the storage policy's shape;
  // the day itself is decided by submit_photo.
  const path = dailyPath(date || todayRiyadh());
  const upload = await uploadPhoto(blob, path);
  if (!upload.ok) {
    // [4.2] Why the upload failed decides what happens to the photo: no
    // network → it waits in the queue; no session → sign in again, photo
    // kept; anything else → it still waits, never silently lost.
    if (isAuthError(upload.error)) return { ok: false, code: 'not_signed_in' };
    if (isOffline(upload.error)) return { ok: false, code: 'offline' };
    return { ok: false, code: 'upload_failed' };
  }

  // The row is created server-side; the reply carries no figures either way.
  const result = await attempt(supabase.rpc('submit_photo', {
    p_entry_date: date || null,
    p_photo_path: path,
    p_notes: notes || null,
  }));

  return result.ok ? { ok: true, code: 'saved' } : { ok: false, code: result.code || 'server_error' };
}
