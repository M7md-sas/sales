/**
 * Archive — every day, filterable by month, newest first.
 *
 * Unreviewed days are visually distinct from approved ones (guide 4.3): the
 * archive is where a forgotten review queue would otherwise hide as a gap.
 */
import { el, $ } from '../../core/dom.js';
import { T } from '../../core/strings.js';
import {
  shortDate, weekdayName, money, todayRiyadh, monthEnd, monthLabel,
} from '../../core/format.js';
import { listRange } from '../../data/entries.js';
import { go } from '../router.js';
import { loadFailed } from '../../ui/load-failed.js';

export const title = T.archive;
export const showBack = false;

/** Remembered across visits so returning from a day keeps your place. */
let selectedMonth = todayRiyadh().slice(0, 7);

export async function render(root) {
  root.innerHTML = '';
  root.append(filterBar(), el('div', { id: 'archive-list', class: 'stack' }));
  await load();
}

function filterBar() {
  const select = el('select', { class: 'select', id: 'month-filter' },
    monthOptions().map(({ value, label }) =>
      el('option', { value, selected: value === selectedMonth }, label)));

  select.addEventListener('change', async () => {
    selectedMonth = select.value;
    await load();
  });

  return el('div', { class: 'filters', style: 'margin-bottom:var(--s-4)' }, [
    el('label', { class: 'field' }, [
      el('span', { class: 'field__label', text: T.filterMonth }),
      select,
    ]),
  ]);
}

/** [4.2] The last five years — the backlog import reaches that far back. */
function monthOptions() {
  const today = todayRiyadh();
  const [year, month] = today.split('-').map(Number);
  return Array.from({ length: 60 }, (_, i) => {
    const date = new Date(Date.UTC(year, month - 1 - i, 1));
    const value = date.toISOString().slice(0, 7);
    return { value, label: monthLabel(`${value}-01`) };
  });
}

async function load() {
  const list = $('#archive-list');
  list.innerHTML = '<div class="empty"><span class="spinner spinner--lg" ' +
                   'style="color:var(--accent);margin:0 auto"></span></div>';

  const from = `${selectedMonth}-01`;
  let rows;
  try {
    rows = await listRange({ from, to: monthEnd(from) });
  } catch {
    list.innerHTML = '';
    list.append(loadFailed(T.loadFailed, load));
    return;
  }

  list.innerHTML = '';
  if (!rows.length) {
    list.append(el('div', { class: 'empty' }, [
      el('p', { class: 'empty__title', text: T.noDataYet }),
    ]));
    return;
  }

  list.append(monthSummary(rows), el('div', { class: 'list' }, rows.map(dayRow)));
}

function monthSummary(rows) {
  const approved = rows.filter((r) => r.status === 'approved');
  const total = approved.reduce((sum, r) => sum + Number(r.total || 0), 0);
  const waiting = rows.length - approved.length;

  return el('div', { class: 'card' }, [
    el('div', { class: 'row row-between' }, [
      el('div', [
        el('div', { class: 'card__title', text: T.total }),
        el('div', { class: 'figure-md', html: money(total) }),
      ]),
      el('div', { style: 'text-align:end' }, [
        el('div', { class: 'card__title', text: T.daysRecorded }),
        el('div', { class: 'figure-md num', text: String(approved.length) }),
      ]),
    ]),
    waiting > 0
      ? el('p', { class: 'xs', style: 'color:var(--warn);margin-top:var(--s-3)',
                  text: T.waitingCount(waiting) })
      : null,
  ].filter(Boolean));
}

function dayRow(day) {
  const badge = {
    approved: ['approved', T.statusApproved],
    needs_review: ['review', T.statusNeedsReview],
    pending_extraction: ['pending', T.statusPending],
  }[day.status];

  const row = el('button', { class: 'list__item day-row', type: 'button' }, [
    el('div', { class: 'grow' }, [
      el('div', { class: 'day-row__date',
                  text: `${weekdayName(day.entry_date)} ${shortDate(day.entry_date)}` }),
      el('div', { class: 'day-row__meta',
                  text: day.source === 'owner_import' ? T.sourceImport : T.sourceWorker }),
    ]),
    el('span', { class: `badge badge--${badge[0]}`, text: badge[1] }),
    el('div', { class: 'day-row__total',
                html: day.status === 'approved' ? money(day.total) : '—' }),
  ]);

  // An unreviewed day goes straight to its review card — the useful action.
  row.addEventListener('click', () => go(
    day.status === 'approved' ? `/day/${day.entry_date}` : `/review/${day.entry_date}`
  ));
  return row;
}
