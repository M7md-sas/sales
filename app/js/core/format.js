/**
 * Formatting. Arabic text, Western digits, always.
 *
 * Two rules from the guide that this file exists to enforce:
 *   - Appendix C: numbers must never render as Arabic-Indic digits (٢٦٠).
 *   - Appendix C: totals must never be summed in JavaScript floating point —
 *     the database owns the `total` column; we only display it.
 */
import { CONFIG } from '../config.js';
import { T, WEEKDAYS, MONTHS } from './strings.js';

/** Latin digits even inside an Arabic locale. */
const NUM = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const NUM_INT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** "1,234.50" — no currency mark. */
export function amount(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? NUM.format(n) : '—';
}

/** "1,234.50 ر.س" as HTML, with the unit in a smaller weight. */
export function money(value) {
  if (value === null || value === undefined || value === '') return '—';
  return `<span class="num">${amount(value)}</span><span class="currency">${T.currency}</span>`;
}

export function count(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? NUM_INT.format(n) : '—';
}

export function percent(value) {
  if (!Number.isFinite(Number(value))) return '—';
  // Isolated left-to-right, or RTL text shows it as "%61".
  return `⁦${Math.round(Number(value) * 100)}%⁩`;
}

/* ------------------------------------------------------------------
   Dates. The business day is Asia/Riyadh — never the phone's zone.
   ------------------------------------------------------------------ */

/** Today in Riyadh as 'YYYY-MM-DD'. en-CA gives ISO order. */
export function todayRiyadh() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CONFIG.TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/** Shift an ISO date string by whole days without touching timezones. */
export function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Parse 'YYYY-MM-DD' as a UTC date — safe for weekday/month lookups. */
function utcOf(isoDate) {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** "الخميس ٧ أغسطس" → with Latin digits: "الخميس 7 أغسطس 2026". */
export function longDate(isoDate) {
  if (!isoDate) return '—';
  const dt = utcOf(isoDate);
  return `${WEEKDAYS[dt.getUTCDay()]} ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

/** "7 أغسطس" — for dense lists. */
export function shortDate(isoDate) {
  if (!isoDate) return '—';
  const dt = utcOf(isoDate);
  return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
}

export function weekdayName(isoDate) {
  return isoDate ? WEEKDAYS[utcOf(isoDate).getUTCDay()] : '';
}

/** "أغسطس 2026" from a month-start date. */
export function monthLabel(isoDate) {
  if (!isoDate) return '—';
  const dt = utcOf(isoDate);
  return `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

/** "7 أغسطس · 21:14" for audit-style timestamps — [4.2] 24-hour clock, the client's choice. */
export function dateTime(timestamp) {
  if (!timestamp) return '—';
  const dt = new Date(timestamp);
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: CONFIG.TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(dt);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: CONFIG.TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(dt);
  return `${shortDate(date)} · ${time}`;
}

/** First day of the month containing isoDate. */
export function monthStart(isoDate) {
  return `${isoDate.slice(0, 7)}-01`;
}

/** Last day of the month containing isoDate. */
export function monthEnd(isoDate) {
  const [y, m] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * Percentage difference against a comparison figure, for the Today screen.
 * Returns null when there is nothing to compare against yet.
 */
export function deltaVs(value, baseline) {
  const v = Number(value), b = Number(baseline);
  if (!Number.isFinite(v) || !Number.isFinite(b) || b === 0) return null;
  return (v - b) / b;
}
