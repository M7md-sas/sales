/**
 * [4.3] Monthly expenses — rent renewals, the worker's salary, electricity
 * (DEVIATIONS.md #32). Entered against a month, never a day. The owner reads
 * the table; every write goes through a function that also writes the audit
 * log.
 */
import { supabase } from '../core/supabase.js';
import { attempt, must } from '../core/errors.js';

/** @param {string} month 'YYYY-MM' */
export async function listExpenses(month) {
  return must(await attempt(
    supabase.from('monthly_expenses')
      .select('id, month, description, amount, created_at')
      .eq('month', `${month}-01`)
      .order('created_at', { ascending: true })
  ), []);
}

/**
 * Every expense of every month the range touches, oldest first — for the
 * exports. An expense belongs to a whole month, so a range that starts or
 * ends mid-month still carries that month's expenses in full.
 *
 * @param {string} from 'YYYY-MM-DD'
 * @param {string} to   'YYYY-MM-DD'
 */
export async function listExpensesBetween(from, to) {
  return must(await attempt(
    supabase.from('monthly_expenses')
      .select('id, month, description, amount, created_at')
      .gte('month', `${from.slice(0, 7)}-01`)
      .lte('month', to)
      .order('month', { ascending: true })
      .order('created_at', { ascending: true })
  ), []);
}

/** @param {{month: string, description: string, amount: number}} expense — month 'YYYY-MM' */
export async function addExpense({ month, description, amount }) {
  return attempt(supabase.rpc('add_expense', {
    p_month: `${month}-01`,
    p_description: description,
    p_amount: Number(amount),
  }));
}

export async function deleteExpense(id) {
  return attempt(supabase.rpc('delete_expense', { p_id: id }));
}
