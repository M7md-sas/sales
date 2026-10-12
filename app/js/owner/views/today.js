/**
 * Today — the most recent approved day, and the two comparisons that
 * replaced the daily target.
 *
 * The target went because "a single day swings too much on its own — three
 * customers one day, thirty the next — to make a daily bar meaningful."
 * So: a 7-day rolling average and the same weekday's average, both labelled
 * as comparisons rather than goals (guide 4.3).
 */
import { el } from '../../core/dom.js';
import { T } from '../../core/strings.js';
import { longDate, money, count, amount, deltaVs, todayRiyadh } from '../../core/format.js';
import { latestApproved, reviewCount } from '../../data/entries.js';
import { trendFor } from '../../data/reports.js';

export const title = T.navToday;
export const showBack = false;

export async function render(root) {
  const day = await latestApproved();

  if (!day) {
    root.innerHTML = '';
    root.append(
      el('div', { class: 'empty' }, [
        el('p', { class: 'empty__title', text: T.noDataYet }),
        el('p', { class: 'small', text: T.reviewEmptyHint }),
      ]),
    );
    return;
  }

  const [trend, waiting] = await Promise.all([
    trendFor(day.entry_date),
    reviewCount(),
  ]);

  root.innerHTML = '';
  root.append(el('div', { class: 'stack-lg' }, [
    waiting > 0 ? waitingNote(waiting) : null,
    hero(day),
    comparisons(day, trend),
    el('p', { class: 'xs muted center', text: T.comparisonNote }),
  ].filter(Boolean)));
}

/**
 * If days are sitting unreviewed, everything on this screen is understated.
 * Say so here rather than letting the owner read a low total as a bad week.
 */
function waitingNote(waiting) {
  return el('a', { class: 'banner', href: '#/review', style: 'border-radius:var(--r-md)' }, [
    el('span', { class: 'grow', text: T.waitingCount(waiting) }),
    el('span', { text: '←' }),
  ]);
}

function hero(day) {
  const stale = day.entry_date !== todayRiyadh();

  return el('div', { class: 'hero' }, [
    el('div', { class: 'hero__label', text: stale ? longDate(day.entry_date) : T.todayTotal }),
    el('div', { class: 'hero__total', html: money(day.total) }),
    el('dl', { class: 'hero__split' }, [
      cell(T.cash, money(day.cash_total)),
      cell(T.mada, money(day.mada_total)),
      cell(T.customers, `<span class="num">${count(day.customer_count)}</span>`),
      cell(T.debt, money(day.debt_total ?? 0)),
      cell(T.repaid, money(day.repaid_total ?? 0)),
    ]),
  ]);
}

function cell(label, valueHtml) {
  return el('div', { class: 'hero__cell' }, [
    el('dt', { text: label }),
    el('dd', { html: valueHtml }),
  ]);
}

function comparisons(day, trend) {
  return el('div', { class: 'compare' }, [
    compareCell(T.avg7, trend.avg_last_7_days, day.total),
    compareCell(T.avgWeekday, trend.avg_same_weekday_last_8, day.total),
  ]);
}

function compareCell(label, baseline, todayTotal) {
  const delta = deltaVs(todayTotal, baseline);

  return el('div', { class: 'compare__cell' }, [
    el('div', { class: 'compare__label', text: label }),
    el('div', { class: 'compare__value', html: baseline === null ? '—' : money(baseline) }),
    delta === null ? null : el('div', {
      class: `delta delta--${delta >= 0 ? 'up' : 'down'}`,
      html: `${delta >= 0 ? '▲' : '▼'} <span class="num">${amount(Math.abs(delta) * 100)}%</span>`,
    }),
  ].filter(Boolean));
}
