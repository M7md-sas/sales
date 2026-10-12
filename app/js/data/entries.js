/**
 * Owner-side reads and writes against daily_entries.
 *
 * All of these fail closed for the worker: he has no RLS policy on the table,
 * so a select returns [] and an RPC returns forbidden. That is the mechanism,
 * not this file — nothing here is a security control.
 *
 * [4.2] A read that fails now THROWS (LoadError) instead of returning an
 * empty list. The router turns it into a "couldn't load — try again" screen.
 * Returning [] made a dropped connection look exactly like "nothing waiting",
 * which is the one answer the review queue must never give falsely
 * (DEVIATIONS.md #21).
 *
 * [4.2] Writes go only through RPCs — the table grants are read-only now
 * (DEVIATIONS.md #13).
 */
import { supabase } from '../core/supabase.js';
import { attempt, must } from '../core/errors.js';

const COLUMNS = `
  id, entry_date, cash_total, mada_total, total, customer_count,
  debt_total, repaid_total,
  extracted_cash, extracted_mada, extracted_customers,
  extracted_debt, extracted_repaid,
  extraction_confidence, extraction_error,
  photo_path, notes, status, source, revision,
  submitted_at, reviewed_at, updated_at
`;

/** PostgREST answers at most this many rows per request (Supabase default). */
const PAGE = 1000;

/** Days waiting for the owner, newest first. Guide 9.6. */
export async function reviewQueue() {
  return must(await attempt(
    supabase.from('daily_entries')
      .select(COLUMNS)
      .eq('status', 'needs_review')
      .order('entry_date', { ascending: false })
  ), []);
}

/** Photos that arrived but whose extraction has not come back yet. */
export async function pendingExtraction() {
  return must(await attempt(
    supabase.from('daily_entries')
      .select(COLUMNS)
      .eq('status', 'pending_extraction')
      .order('entry_date', { ascending: false })
  ), []);
}

/**
 * Badge count for the review tab — Section 12 wants this impossible to miss.
 *
 * Silently showing "nothing waiting" is the one wrong answer here: it is
 * indistinguishable from a cleared queue, and a cleared queue is what stops
 * the owner from looking. [4.2] So a failure returns null, and the badge
 * shows "!" rather than disappearing.
 *
 * @returns {Promise<number|null>}
 */
export async function reviewCount() {
  const result = await attempt(
    supabase.from('daily_entries')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'needs_review')
  );
  if (result.ok && typeof result.count === 'number') return result.count;
  try {
    return (await reviewQueue()).length;
  } catch {
    return null;
  }
}

/** The most recent approved day — what the Today screen shows. */
export async function latestApproved() {
  return must(await attempt(
    supabase.from('daily_entries')
      .select(COLUMNS)
      .eq('status', 'approved')
      .order('entry_date', { ascending: false })
      .limit(1)
      .maybeSingle()
  ), null);
}

export async function getDay(entryDate) {
  return must(await attempt(
    supabase.from('daily_entries').select(COLUMNS).eq('entry_date', entryDate).maybeSingle()
  ), null);
}

/**
 * A date range, newest first. Used by the archive, the monthly chart and
 * both exports.
 *
 * [4.2] Paged: the API returns at most 1000 rows per request, and an export
 * of a long range used to stop at the newest 1000 days with its total quietly
 * understated (DEVIATIONS.md #24).
 *
 * @param {{from: string, to: string, approvedOnly?: boolean}} opts
 */
export async function listRange({ from, to, approvedOnly = false }) {
  const rows = [];
  for (let start = 0; ; start += PAGE) {
    let query = supabase.from('daily_entries')
      .select(COLUMNS)
      .gte('entry_date', from)
      .lte('entry_date', to)
      .order('entry_date', { ascending: false })
      .range(start, start + PAGE - 1);
    if (approvedOnly) query = query.eq('status', 'approved');

    const page = must(await attempt(query), []);
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

/**
 * Approve a day with whatever is currently in the review card's three fields.
 * Editing before approving IS the correction — there is no reject flow.
 * Guide 4.3, 8.
 *
 * [4.2] `revision` is the version of the day the card was showing. If the
 * worker re-sent the day meanwhile, the server answers 'stale' instead of
 * pairing these figures with a photo the owner never saw (DEVIATIONS.md #11).
 */
export async function approveDay({ entryDate, cash, mada, customers, debt = 0, repaid = 0, revision = null }) {
  return attempt(supabase.rpc('approve_day', {
    p_entry_date: entryDate,
    p_cash: Number(cash),
    p_mada: Number(mada),
    p_customer_count: customers === '' || customers === null ? null : Number(customers),
    p_revision: revision,
    p_debt: Number(debt) || 0,
    p_repaid: Number(repaid) || 0,
  }));
}

/**
 * Re-open and correct a day that was already approved. Runs through
 * approve_day again so the audit log records the correction, with the
 * figures it replaced.
 */
export async function correctDay(args) {
  return approveDay(args);
}

/** [4.2] Send a day back through the reading step. */
export async function retryExtraction(entryDate) {
  return attempt(supabase.rpc('retry_extraction', { p_entry_date: entryDate }));
}

/** [4.2] Move an unapproved day to an empty date. */
export async function moveDay(from, to) {
  return attempt(supabase.rpc('move_day', { p_from: from, p_to: to }));
}

/** Change history for the day-detail screen. Owner-readable only. */
export async function auditFor(entryDate) {
  return must(await attempt(
    supabase.from('audit_log')
      .select('id, at, action, detail')
      .eq('entry_date', entryDate)
      .order('at', { ascending: false })
  ), []);
}

/**
 * [4.2] Splits extraction_error into a hard failure and a soft warning.
 * The Edge Function writes 'extraction_failed:<code>' when it could not read
 * the photo and 'warning:<tags>' when it read it but something did not add up.
 *
 * [4.3] `dateTaken` is the date written on the page when the day could not be
 * moved there because that date already has a photo (DEVIATIONS.md #29).
 *
 * @returns {{failed: string|null, warning: boolean, dateTaken: string|null}}
 */
export function readingProblem(day) {
  const text = String(day?.extraction_error || '');
  if (!text) return { failed: null, warning: false, dateTaken: null };
  if (text.startsWith('warning:')) {
    const tags = text.slice('warning:'.length).split(',');
    const taken = tags.find((t) => t.startsWith('date_taken_'));
    return {
      failed: null,
      // A taken date alone is not a doubt about the figures.
      warning: tags.some((t) => !t.startsWith('date_taken_')),
      dateTaken: taken ? taken.slice('date_taken_'.length) : null,
    };
  }
  const code = text.replace(/^extraction_failed:\s*/, '').split(/[:\s]/)[0] || 'unknown';
  return { failed: code, warning: false, dateTaken: null };
}
