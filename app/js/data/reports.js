/**
 * Aggregates. Both RPCs count approved days only — an unreviewed day is not
 * yet a fact about the business (rule 6).
 */
import { supabase } from '../core/supabase.js';
import { attempt } from '../core/errors.js';

/** Per-month totals for one year. Guide 8. */
export async function monthlyTotals(year) {
  const result = await attempt(supabase.rpc('get_monthly', { p_year: Number(year) }));
  return result.ok ? result.data ?? [] : [];
}

/**
 * The two comparisons that replaced the daily target: a 7-day rolling
 * average and the same weekday's average over its last 8 occurrences.
 * Guide 8, and the reasoning in "what changed in this version".
 */
export async function trendFor(entryDate) {
  const result = await attempt(supabase.rpc('get_trend', { p_entry_date: entryDate }));
  if (!result.ok) return { avg_last_7_days: null, avg_same_weekday_last_8: null };
  return result.data ?? { avg_last_7_days: null, avg_same_weekday_last_8: null };
}

/**
 * Month statistics the dashboard shows that get_monthly does not return:
 * best day, worst day, average per customer. Computed from rows the owner
 * can already read, so it needs no extra server function.
 */
export function summarise(rows) {
  const approved = rows.filter((r) => r.status === 'approved');
  if (!approved.length) {
    return { days: 0, cash: 0, mada: 0, debt: 0, repaid: 0, total: 0, customers: 0,
             perDay: null, perCustomer: null, best: null, worst: null };
  }

  const sum = (key) => approved.reduce((acc, r) => acc + Number(r[key] || 0), 0);
  const total = sum('total');
  const customers = sum('customer_count');

  const sorted = [...approved].sort((a, b) => Number(b.total) - Number(a.total));

  return {
    days: approved.length,
    cash: sum('cash_total'),
    mada: sum('mada_total'),
    debt: sum('debt_total'),
    repaid: sum('repaid_total'),
    total,
    customers,
    perDay: total / approved.length,
    perCustomer: customers > 0 ? total / customers : null,
    best: sorted[0],
    worst: sorted[sorted.length - 1],
  };
}
