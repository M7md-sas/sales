/**
 * Monthly report — totals, splits, best and worst day, progress against the
 * monthly target, and a bar per day.
 *
 * The monthly target is the only target left in the product; the daily one
 * was removed because a single day is too noisy to judge. Approved days only.
 */
import { el, $, busy } from '../../core/dom.js';
import { T } from '../../core/strings.js';
import {
  money, count, amount, monthLabel, monthEnd, shortDate, todayRiyadh,
} from '../../core/format.js';
import { listRange } from '../../data/entries.js';
import { monthlyTotals, summarise } from '../../data/reports.js';
import { monthlyTarget } from '../../data/settings.js';
import { listExpenses, addExpense, deleteExpense } from '../../data/expenses.js';
import { normaliseDigits } from '../../core/password.js';
import { messageFor } from '../../core/errors.js';
import { toast } from '../../ui/toast.js';
import { go } from '../router.js';
import { loadFailed } from '../../ui/load-failed.js';

export const title = T.navMonthly;
export const showBack = false;

let selectedMonth = todayRiyadh().slice(0, 7);

export async function render(root, _params, ctx) {
  root.innerHTML = '';
  root.append(picker(ctx), el('div', { id: 'monthly-body', class: 'stack-lg' }));
  await load(ctx);
}

function picker(ctx) {
  const select = el('select', { class: 'select', id: 'monthly-picker' },
    options().map(({ value, label }) =>
      el('option', { value, selected: value === selectedMonth }, label)));

  select.addEventListener('change', async () => {
    selectedMonth = select.value;
    await load(ctx);
  });

  return el('label', { class: 'field', style: 'margin-bottom:var(--s-5)' }, [
    el('span', { class: 'field__label', text: T.filterMonth }),
    select,
  ]);
}

function options() {
  const [year, month] = todayRiyadh().split('-').map(Number);
  // [4.2] Five years, not two: the backlog import can reach that far back.
  return Array.from({ length: 60 }, (_, i) => {
    const value = new Date(Date.UTC(year, month - 1 - i, 1)).toISOString().slice(0, 7);
    return { value, label: monthLabel(`${value}-01`) };
  });
}

async function load(ctx) {
  const body = $('#monthly-body');
  body.innerHTML = '<div class="empty"><span class="spinner spinner--lg" ' +
                   'style="color:var(--accent);margin:0 auto"></span></div>';

  const from = `${selectedMonth}-01`;
  const to = monthEnd(from);
  let rows, months, expenses;
  try {
    [rows, months, expenses] = await Promise.all([
      listRange({ from, to, approvedOnly: true }),
      monthlyTotals(selectedMonth.slice(0, 4)),
      listExpenses(selectedMonth),
    ]);
  } catch {
    body.innerHTML = '';
    body.append(loadFailed(T.loadFailed, () => load(ctx)));
    return;
  }

  const stats = summarise(rows);
  const target = monthlyTarget(ctx.settings);

  body.innerHTML = '';
  // [4.3] Income, expenses and what is left come first, and show even in a
  // month with no approved day yet — an expense can arrive before the sales.
  body.append(financeCard(stats.total, expenses), expensesCard(expenses, ctx));
  if (!stats.days) {
    body.append(el('div', { class: 'empty' }, [
      el('p', { class: 'empty__title', text: T.noDataYet }),
    ]));
    return;
  }

  body.append(
    targetCard(stats.total, target),
    statsGrid(stats),
    chartCard(rows, from, to),
    extremes(stats),
    yearTable(months),
  );
}

/** [4.3] What came in, what went out, and what is left (DEVIATIONS.md #32). */
function financeCard(income, expenses) {
  const spent = expenses.reduce((sum, x) => sum + Number(x.amount || 0), 0);
  const left = income - spent;
  return el('div', { class: 'stats' }, [
    box(T.income, money(income)),
    box(T.expenses, money(spent)),
    el('div', { class: 'stat', style: 'grid-column:1 / -1' }, [
      el('div', { class: 'stat__label', text: T.remaining }),
      el('div', {
        class: 'stat__value figure-md',
        style: left < 0 ? 'color:var(--danger)' : '',
        html: money(left),
      }),
    ]),
  ]);
}

/**
 * [4.3] The month's expenses and the form to add one: what it is, which
 * month, how much. No day — these are monthly by nature.
 */
function expensesCard(expenses, ctx) {
  const what = el('input', {
    class: 'input', type: 'text', maxlength: '200', autocomplete: 'off',
    placeholder: T.expenseWhatHint,
  });
  const month = el('select', { class: 'select' },
    options().map(({ value, label }) => el('option', { value, selected: value === selectedMonth }, label)));
  const howMuch = el('input', {
    class: 'input input--amount', type: 'text', inputmode: 'decimal', autocomplete: 'off',
    maxlength: '10',
    oninput: (e) => {
      // Arabic digits on an Arabic keypad, as in the review card.
      let v = normaliseDigits(e.target.value).replace(/[٫,]/g, '.').replace(/[^\d.]/g, '');
      const [whole, ...rest] = v.split('.');
      v = rest.length ? `${whole}.${rest.join('').slice(0, 2)}` : whole;
      if (v !== e.target.value) e.target.value = v;
    },
  });
  const add = el('button', { class: 'btn btn--primary btn--block', type: 'button', text: T.expenseAdd });

  add.addEventListener('click', async () => {
    const description = what.value.trim();
    const value = Number(howMuch.value);
    if (!description) { toast(T.expenseMissing, 'error'); return; }
    if (!howMuch.value || !Number.isFinite(value) || value <= 0 || value > 999999.99) {
      toast(messageFor('bad_amount'), 'error');
      return;
    }
    const restore = busy(add, T.loading);
    const result = await addExpense({ month: month.value, description, amount: value });
    restore();
    if (!result.ok) { toast(messageFor(result.code), 'error'); return; }
    toast(T.expenseAdded, 'ok');
    // Show the month the expense went into, so it is visibly there.
    selectedMonth = month.value;
    const picker = $('#monthly-picker');
    if (picker) picker.value = selectedMonth;
    await load(ctx);
  });

  const list = expenses.length
    ? el('div', { class: 'list' }, expenses.map((x) => el('div', { class: 'list__item' }, [
        el('div', { class: 'grow', text: x.description }),
        el('div', { class: 'day-row__total', html: money(x.amount) }),
        el('button', {
          class: 'btn btn--quiet small', type: 'button', text: '✕',
          style: 'color:var(--danger)', 'aria-label': T.expenseDeleteConfirm(x.description),
          onclick: async () => {
            if (!window.confirm(T.expenseDeleteConfirm(x.description))) return;
            const result = await deleteExpense(x.id);
            if (!result.ok) { toast(messageFor(result.code), 'error'); return; }
            toast(T.expenseDeleted, 'ok');
            await load(ctx);
          },
        }),
      ])))
    : el('p', { class: 'small muted', text: T.expensesNone });

  return el('div', { class: 'card stack' }, [
    el('div', { class: 'card__title', text: `${T.expenses} — ${monthLabel(`${selectedMonth}-01`)}` }),
    list,
    el('label', { class: 'field' }, [el('span', { class: 'field__label', text: T.expenseWhat }), what]),
    el('div', { class: 'review-fields__pair' }, [
      el('label', { class: 'field' }, [el('span', { class: 'field__label', text: T.expenseMonth }), month]),
      el('label', { class: 'field' }, [
        el('span', { class: 'field__label', text: `${T.expenseAmount} (${T.currency})` }), howMuch,
      ]),
    ]),
    add,
  ]);
}

function targetCard(total, target) {
  const ratio = target > 0 ? Math.min(total / target, 1) : 0;
  const reached = total >= target;

  return el('div', { class: 'card' }, [
    el('div', { class: 'target__row' }, [
      el('div', [
        el('div', { class: 'card__title', text: T.total }),
        el('div', { class: 'figure-lg', html: money(total) }),
      ]),
      el('div', { style: 'text-align:end' }, [
        el('div', { class: 'card__title', text: T.monthlyTarget }),
        el('div', { class: 'small num', text: amount(target) }),
      ]),
    ]),
    el('div', { class: 'progress' }, [
      el('div', {
        class: `progress__bar${reached ? ' progress__bar--ok' : ''}`,
        style: `width:${(ratio * 100).toFixed(1)}%`,
      }),
    ]),
    el('p', {
      class: 'xs muted', style: 'margin-top:var(--s-2)',
      html: `<span class="num">${Math.round(ratio * 100)}%</span> ${T.ofMonth}`,
    }),
  ]);
}

function statsGrid(stats) {
  return el('div', { class: 'stats' }, [
    box(T.cash, money(stats.cash)),
    box(T.mada, money(stats.mada)),
    box(T.debt, money(stats.debt)),
    box(T.repaid, money(stats.repaid)),
    box(T.customers, `<span class="num">${count(stats.customers)}</span>`),
    box(T.daysRecorded, `<span class="num">${count(stats.days)}</span>`),
    box(T.perDay, money(stats.perDay)),
    box(T.perCustomer, stats.perCustomer === null ? '—' : money(stats.perCustomer)),
  ]);
}

function box(label, valueHtml) {
  return el('div', { class: 'stat' }, [
    el('div', { class: 'stat__label', text: label }),
    el('div', { class: 'stat__value', html: valueHtml }),
  ]);
}

/**
 * One bar per calendar day, including the days with no approved entry —
 * a gap in the month should look like a gap, not be quietly skipped.
 */
function chartCard(rows, from, to) {
  const byDate = Object.fromEntries(rows.map((r) => [r.entry_date, Number(r.total)]));
  const lastDay = Number(to.slice(-2));
  const peak = Math.max(...Object.values(byDate), 1);

  const bars = Array.from({ length: lastDay }, (_, i) => {
    const date = `${from.slice(0, 8)}${String(i + 1).padStart(2, '0')}`;
    const value = byDate[date];
    return el('div', {
      class: `chart__bar${value ? '' : ' chart__bar--empty'}`,
      style: `height:${value ? Math.max((value / peak) * 100, 4) : 4}%`,
      title: `${shortDate(date)} — ${value ? amount(value) : '—'}`,
    });
  });

  return el('div', { class: 'card' }, [
    el('div', { class: 'card__title', text: `${T.total} — ${monthLabel(from)}` }),
    el('div', { class: 'chart' }, bars),
    el('div', { class: 'chart__axis' }, [
      el('span', { class: 'num', text: '1' }),
      el('span', { class: 'num', text: String(lastDay) }),
    ]),
  ]);
}

function extremes(stats) {
  const row = (label, day, kind) => el('button', {
    class: 'list__item', type: 'button',
    onclick: () => go(`/day/${day.entry_date}`),
  }, [
    el('span', { class: `badge badge--${kind}`, text: label }),
    el('div', { class: 'grow' }, [
      el('div', { class: 'day-row__date', text: shortDate(day.entry_date) }),
    ]),
    el('div', { class: 'day-row__total', html: money(day.total) }),
  ]);

  return el('div', { class: 'list' }, [
    row(T.bestDay, stats.best, 'approved'),
    row(T.worstDay, stats.worst, 'review'),
  ]);
}

/** Every month of the selected year, so a trend is visible without paging. */
function yearTable(months) {
  if (!months.length) return el('span', { class: 'hidden' });

  return el('div', { class: 'card' }, [
    el('div', { class: 'card__title', text: `أشهر ${months[0].month_start.slice(0, 4)}` }),
    el('table', { class: 'compare-table', style: 'margin-top:var(--s-3)' }, [
      el('thead', [el('tr', [
        el('th', { text: T.filterMonth }),
        el('th', { style: 'text-align:end', text: T.daysRecorded }),
        el('th', { style: 'text-align:end', text: T.total }),
      ])]),
      el('tbody', months.map((m) => el('tr', [
        el('td', { text: monthLabel(m.month_start) }),
        // .num is inline-block; on the cell itself it breaks the table grid.
        el('td', { style: 'text-align:end' }, [el('span', { class: 'num', text: count(m.days_recorded) })]),
        el('td', { style: 'text-align:end' }, [el('span', { class: 'num', text: amount(m.grand_total) })]),
      ]))),
    ]),
  ]);
}
