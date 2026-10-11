/**
 * The offline queue — the only thing the worker app is allowed to remember.
 *
 * "DO NOT CACHE ANYTHING BEYOND THE PENDING UPLOAD" (guide 9.5). A photo
 * waiting to go out may persist. Anything about a photo that already went out
 * may not: no thumbnail history, no "last sent" timestamp. A timestamp is a
 * figure in disguise — it tells the worker which days landed, and that is one
 * inference away from knowing which days did not.
 *
 * This is also why the server accepts the previous 7 days (rule 2): a photo
 * queued on Thursday and flushed on Saturday keeps Thursday's date.
 *
 * [4.2] The one exception: the date of a photo the server refused for good is
 * kept until the worker dismisses the notice. It is a day that did NOT go,
 * and dropping it silently was the one outcome this app must never have
 * (DEVIATIONS.md #23).
 */
import { CONFIG } from '../config.js';
import { blobToDataUrl, dataUrlToBlob } from './capture.js';
import { submitPhoto } from '../data/submit.js';
import { withTimeout } from '../core/errors.js';

const KEY = 'pending_photos';
const DROPPED_KEY = 'unsent_days';

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** [4.2] Returns whether the list really was stored. */
function write(list) {
  // An empty queue removes the key rather than storing "[]". Acceptance test
  // 11.1 asks that nothing about a sent submission remain on the phone, and
  // "nothing" is easier to demonstrate than "an empty array".
  try {
    if (!list.length) {
      localStorage.removeItem(KEY);
      return true;
    }
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    // Quota exceeded or storage blocked (private mode). Reported, not
    // swallowed: the caller keeps the photo on screen instead of claiming
    // it was saved.
    return false;
  }
}

export function pendingCount() {
  return read().length;
}

export function isFull() {
  return read().length >= CONFIG.OFFLINE_QUEUE_LIMIT;
}

/**
 * Park a photo for later.
 * @returns {Promise<'queued'|'full'|'failed'>}
 */
export async function enqueue({ date, blob, notes = null }) {
  const list = read();
  if (list.length >= CONFIG.OFFLINE_QUEUE_LIMIT) return 'full';
  list.push({
    id: `${date}-${Date.now()}`,
    date,
    notes,
    photo: await blobToDataUrl(blob),
  });
  return write(list) ? 'queued' : 'failed';
}

let flushing = null;

/**
 * Try to send everything parked. Called on load, when the network comes back,
 * and when the app is brought to the front.
 *
 * [4.2] Only one flush runs at a time — two used to upload and submit the
 * same photo twice (DEVIATIONS.md #23). A refused item is no longer dropped
 * without a trace; its date goes to the "could not be sent" notice.
 *
 * @returns {Promise<{sent: number, remaining: number, signedOut: boolean}>}
 */
export function flush() {
  if (!flushing) {
    flushing = run().finally(() => { flushing = null; });
  }
  return flushing;
}

async function run() {
  if (!navigator.onLine) return { sent: 0, remaining: pendingCount(), signedOut: false };

  let sent = 0;
  let signedOut = false;
  for (const item of read()) {
    let result;
    try {
      const blob = await dataUrlToBlob(item.photo);
      result = await withTimeout(
        submitPhoto({ date: item.date, blob, notes: item.notes }),
        CONFIG.SEND_TIMEOUT_MS,
      );
    } catch {
      result = { ok: false, code: 'offline' };
    }

    const permanent = !result.ok &&
      ['locked', 'bad_date', 'photo_required', 'too_many', 'forbidden', 'photo_too_large']
        .includes(result.code);

    if (result.ok) {
      remove(item.id);
      sent++;
    } else if (permanent) {
      remove(item.id);
      remember(item.date);
    } else {
      // Network, server or session trouble — keep this one and the rest.
      signedOut = result.code === 'not_signed_in';
      break;
    }
  }

  return { sent, remaining: pendingCount(), signedOut };
}

function remove(id) {
  write(read().filter((item) => item.id !== id));
}

function remember(date) {
  const days = droppedDays();
  if (!days.includes(date)) days.push(date);
  try { localStorage.setItem(DROPPED_KEY, JSON.stringify(days)); } catch { /* ignore */ }
}

/** Dates of photos the server refused for good, until the worker dismisses them. */
export function droppedDays() {
  try {
    const list = JSON.parse(localStorage.getItem(DROPPED_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function clearDropped() {
  try { localStorage.removeItem(DROPPED_KEY); } catch { /* ignore */ }
}

/** Wipe everything. Used on sign-out so nothing survives a change of hands. */
export function clear() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(DROPPED_KEY);
  } catch { /* ignore */ }
}
