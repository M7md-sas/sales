/**
 * Server result codes → Arabic messages.
 *
 * Every RPC in the schema answers with { ok, code }. Codes are the contract;
 * the Arabic wording is presentation and lives here alone, so changing a
 * message never means touching app logic.
 *
 * Section 8 of the build guide lists the codes each function can return.
 */
import { T } from './strings.js';

const MESSAGES = {
  // submit_photo
  saved:          T.sent,
  bad_date:       T.badDate,
  photo_required: T.photoRequired,
  locked:         T.alreadyApproved,
  not_signed_in:  T.signInPrompt,
  too_many:       T.tooManyResends,

  // approve_day / owner_import_day / retry_extraction / move_day / get_*
  forbidden:      'ما عندك صلاحية لهذا الإجراء',
  bad_amount:     'المبلغ غير صحيح',
  not_found:      'ما لقينا هذا اليوم',
  stale:          T.staleCard,
  date_taken:     T.dateTaken,
  no_photo:       T.noPhoto,

  // passwords
  weak_password:  T.passwordRule,
  same_as_owner:  T.passwordSameAsOwner,
  same_password:  T.passwordSame,

  // client-side
  photo_too_large: T.photoTooLarge,
  upload_failed:   T.uploadFailed,
  server_error:    T.unknownError,
  offline:         T.networkError,
  unreachable:     T.unreachable,
  queue_full:      T.queueFull,
  timeout:         T.networkError,
};

export function messageFor(code) {
  return MESSAGES[code] || T.unknownError;
}

/** True when the failure is "no network" rather than "server said no". */
export function isOffline(error) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  const text = String(error?.message || error || '').toLowerCase();
  return text.includes('failed to fetch') ||
         text.includes('networkerror') ||
         text.includes('network request failed') ||
         text.includes('load failed') ||
         text.includes('timeout') ||
         text.includes('aborted');
}

/**
 * [4.2] True when the request was refused because the session is gone or
 * expired — the cure is signing in again, not retrying (DEVIATIONS.md #20).
 */
export function isAuthError(error) {
  const status = Number(error?.status ?? error?.statusCode);
  const text = String(error?.message || error?.error || '').toLowerCase();
  return status === 401 ||
         text.includes('jwt') ||
         text.includes('invalid token') ||
         text.includes('not authenticated') ||
         text.includes('refresh token');
}

/**
 * Uniform wrapper so callers never have to guess whether they got a thrown
 * error, a Supabase { error } envelope, or an RPC { ok:false, code } object.
 */
export async function attempt(promise) {
  try {
    const { data, error, count } = await promise;
    if (error) {
      return { ok: false, code: codeFor(error), error };
    }
    // RPCs answer with their own { ok, code } — pass it straight through.
    if (data && typeof data === 'object' && !Array.isArray(data) && 'ok' in data) return data;
    return { ok: true, data, count };
  } catch (error) {
    return { ok: false, code: codeFor(error), error };
  }
}

function codeFor(error) {
  if (isOffline(error)) return 'offline';
  if (isAuthError(error)) return 'not_signed_in';
  return 'server_error';
}

/**
 * [4.2] A read that failed. Thrown by the data layer so a view can show
 * "couldn't load — try again" instead of an empty list. An empty list on a
 * failed request used to read as "nothing waiting", the one answer the
 * review queue must never give falsely (DEVIATIONS.md #21).
 */
export class LoadError extends Error {
  constructor(code = 'server_error') {
    super(code);
    this.code = code;
  }
}

/** Unwrap a read: data on success, LoadError on failure. */
export function must(result, fallback = null) {
  if (!result.ok) throw new LoadError(result.code === 'offline' ? 'offline' : 'unreachable');
  return result.data ?? fallback;
}

/** Reject after `ms` with a timeout error. */
export function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
