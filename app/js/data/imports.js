/**
 * Historical import — the path that decides whether a year of notebooks
 * actually makes it into the archive (guide 4.4).
 *
 * Each photo is uploaded and registered with owner_import_day carrying only
 * a path, so it lands as pending_extraction and travels the same Gemini
 * pipeline as a normal daily submission. The owner then clears them through
 * the ordinary review queue instead of a second, parallel one.
 */
import { supabase } from '../core/supabase.js';
import { attempt, must } from '../core/errors.js';
import { uploadPhoto, backfillPath } from './storage.js';
import { CONFIG } from '../config.js';
import { sleep } from '../core/dom.js';

/**
 * One historical day.
 * Passing figures marks it approved immediately; passing only a photo sends
 * it to extraction. Guide 8.
 */
export async function importDay({ entryDate, path = null, cash = null, mada = null,
                                  customers = null, notes = null }) {
  return attempt(supabase.rpc('owner_import_day', {
    p_entry_date: entryDate,
    p_photo_path: path,
    p_cash: cash === null || cash === '' ? null : Number(cash),
    p_mada: mada === null || mada === '' ? null : Number(mada),
    p_customer_count: customers === null || customers === '' ? null : Number(customers),
    p_notes: notes,
  }));
}

/**
 * Upload and register a batch, paced for the free Gemini tier.
 *
 * Firing a hundred photos at once produces a wave of extraction_error rows
 * instead of an archive (guide 9.9, Appendix C "429 errors during bulk
 * import"). So: small batches, a pause between them, and progress reported
 * after every single photo so the owner can watch it work rather than wonder
 * if it hung.
 *
 * [4.2] Each photo is compressed just before its own upload (compressing all
 * of them first held hundreds of decoded images in memory at once), and the
 * progress report carries that photo's outcome, so the screen can mark the
 * failures and offer to retry exactly those (DEVIATIONS.md #22).
 *
 * @param {Array<{file: Blob, date: string, id: string}>} items
 * @param {(progress: {done: number, total: number, ok: number, failed: number,
 *                     current: object|null, outcome: object|null, waiting: boolean}) => void} onProgress
 * @param {{signal?: AbortSignal, prepare?: (file: Blob) => Promise<Blob>}} opts
 */
export async function importBatch(items, onProgress = () => {}, { signal, prepare } = {}) {
  const { BATCH_SIZE, BATCH_DELAY_MS } = CONFIG.BULK_IMPORT;
  const results = [];
  let ok = 0;
  let failed = 0;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    if (signal?.aborted) break;
    const batch = items.slice(i, i + BATCH_SIZE);

    for (const item of batch) {
      if (signal?.aborted) break;

      const outcome = await importOne(item, prepare);
      results.push(outcome);
      outcome.ok ? ok++ : failed++;

      onProgress({
        done: results.length, total: items.length, ok, failed,
        current: item, outcome, waiting: false,
      });
    }

    const hasMore = i + BATCH_SIZE < items.length;
    if (hasMore && !signal?.aborted) {
      onProgress({ done: results.length, total: items.length, ok, failed,
                   current: null, outcome: null, waiting: true });
      await sleep(BATCH_DELAY_MS);
    }
  }

  return { results, ok, failed };
}

async function importOne(item, prepare) {
  try {
    const file = prepare ? await prepare(item.file) : item.file;
    const path = backfillPath(item.date);
    const upload = await uploadPhoto(file, path);
    if (!upload.ok) return { id: item.id, date: item.date, ok: false, code: 'upload_failed' };

    const registered = await importDay({ entryDate: item.date, path });
    return registered.ok
      ? { id: item.id, date: item.date, ok: true }
      : { id: item.id, date: item.date, ok: false, code: registered.code || 'server_error' };
  } catch (error) {
    return { id: item.id, date: item.date, ok: false, code: 'server_error', error };
  }
}

/**
 * Which of these dates already have a row, and in what state, so the owner
 * is warned before he overwrites two months of work with a duplicate batch.
 *
 * [4.2] Asked in chunks — hundreds of dates in one URL can exceed its length
 * limit, and the failure used to make every warning disappear. A failure now
 * throws instead of returning "no clashes".
 *
 * @returns {Promise<Map<string, string>>} date → status
 */
export async function existingDates(dates) {
  const found = new Map();
  const unique = [...new Set(dates)];
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const rows = must(await attempt(
      supabase.from('daily_entries').select('entry_date, status').in('entry_date', chunk)
    ), []);
    rows.forEach((r) => found.set(r.entry_date, r.status));
  }
  return found;
}
