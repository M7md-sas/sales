/**
 * Export — a date range out to Excel or to the print sheet.
 * Approved days only, in both formats (guide 10).
 */
import { el, $, busy } from '../../core/dom.js';
import { T } from '../../core/strings.js';
import { todayRiyadh, monthStart, money, count } from '../../core/format.js';
import { listRange } from '../../data/entries.js';
import { listExpensesBetween } from '../../data/expenses.js';
import { exportExcel } from '../export/excel.js';
import { printRange } from '../export/print.js';
import { toast } from '../../ui/toast.js';
import { messageFor } from '../../core/errors.js';

export const title = T.exportTitle;
export const showBack = true;

export async function render(root, _params, ctx) {
  const today = todayRiyadh();

  root.innerHTML = '';
  root.append(el('div', { class: 'stack-lg' }, [
    el('div', { class: 'card stack' }, [
      el('div', { class: 'filters' }, [
        dateField('from', T.exportFrom, monthStart(today)),
        dateField('to', T.exportTo, today),
      ]),
      el('p', { class: 'xs muted', text: T.exportNote }),
      el('p', { class: 'xs muted', text: T.exportExpensesNote }),
      el('div', { id: 'export-preview' }),
    ]),
    el('div', { class: 'stack' }, [
      el('button', {
        class: 'btn btn--primary btn--lg btn--block', id: 'btn-excel', type: 'button',
        text: T.exportExcel,
        onclick: (e) => runExcel(e.currentTarget),
      }),
      el('button', {
        class: 'btn btn--ghost btn--block', id: 'btn-pdf', type: 'button',
        text: T.exportPdf,
        onclick: () => runPrint(ctx),
      }),
    ]),
  ]));

  await preview();
}

function dateField(id, label, value) {
  return el('label', { class: 'field' }, [
    el('span', { class: 'field__label', text: label }),
    el('input', {
      class: 'input', type: 'date', id: `export-${id}`, value, max: todayRiyadh(),
      onchange: preview,
    }),
  ]);
}

function range() {
  return { from: $('#export-from').value, to: $('#export-to').value };
}

/** Show what will be exported before it is exported. */
async function preview() {
  const node = $('#export-preview');
  if (!node) return;

  const { from, to } = range();
  if (!from || !to || from > to) {
    node.innerHTML = `<p class="small" style="color:var(--danger)">${T.exportEmpty}</p>`;
    return;
  }

  node.innerHTML = `<p class="small muted">${T.loading}</p>`;
  let rows;
  try {
    rows = await listRange({ from, to, approvedOnly: true });
  } catch {
    node.innerHTML = `<p class="small" style="color:var(--danger)">${T.loadFailed}</p>`;
    return;
  }
  const total = rows.reduce((sum, r) => sum + Number(r.total || 0), 0);

  node.innerHTML = rows.length
    ? `<div class="row row-between">
         <span class="small">${T.daysRecorded}: <span class="num">${count(rows.length)}</span></span>
         <span class="figure-md">${money(total)}</span>
       </div>`
    : `<p class="small" style="color:var(--warn)">${T.exportEmpty}</p>`;
}

async function runExcel(button) {
  const { from, to } = range();
  const restore = busy(button, T.loading);
  try {
    const [rows, expenses] = await Promise.all([
      listRange({ from, to, approvedOnly: true }),
      listExpensesBetween(from, to),
    ]);
    const result = await exportExcel(rows, { from, to, expenses });
    toast(result.ok ? T.saved : T.exportEmpty, result.ok ? 'ok' : 'error');
  } catch (error) {
    toast(messageFor(error?.code || 'unreachable'), 'error');
  } finally {
    restore();
  }
}

async function runPrint(ctx) {
  const { from, to } = range();
  let rows, expenses;
  try {
    [rows, expenses] = await Promise.all([
      listRange({ from, to, approvedOnly: true }),
      listExpensesBetween(from, to),
    ]);
  } catch (error) {
    toast(messageFor(error?.code || 'unreachable'), 'error');
    return;
  }
  const result = printRange(rows, { from, to, shopName: ctx.settings?.shop_name, expenses });
  if (!result.ok) toast(T.exportEmpty, 'error');
}
