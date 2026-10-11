/**
 * PDF by printing (guide 10.2).
 *
 * Deliberately no PDF library: Arabic in the common JavaScript PDF libraries
 * means embedding a font and shaping letters by hand, and it usually still
 * comes out wrong. The browser already knows how to shape Arabic, and both
 * phones offer "Save as PDF" from the print sheet — so we style a hidden
 * block for print and call window.print().
 *
 * The layout follows the daily tally sheet already supplied to the client.
 */
import { T } from '../../core/strings.js';
import { amount, longDate, shortDate, count } from '../../core/format.js';
import { esc } from '../../core/dom.js';

export function printRange(rows, { from, to, shopName }) {
  const approved = rows
    .filter((r) => r.status === 'approved')
    .sort((a, b) => a.entry_date.localeCompare(b.entry_date));

  if (!approved.length) return { ok: false, code: 'empty' };

  const totals = {
    cash: sum(approved, 'cash_total'),
    mada: sum(approved, 'mada_total'),
    total: sum(approved, 'total'),
    customers: sum(approved, 'customer_count'),
  };

  document.getElementById('print-area').innerHTML = `
    <div class="print-head">
      <h1>${esc(shopName || T.shopFallback)}</h1>
      <p>${T.exportTitle} — ${longDate(from)} … ${longDate(to)}</p>
    </div>
    <table class="print-table">
      <thead>
        <tr>
          <th>التاريخ</th><th>${T.cash}</th><th>${T.mada}</th>
          <th>${T.total}</th><th>${T.customers}</th>
        </tr>
      </thead>
      <tbody>
        ${approved.map((d) => `
          <tr>
            <td>${shortDate(d.entry_date)}</td>
            <td>${amount(d.cash_total)}</td>
            <td>${amount(d.mada_total)}</td>
            <td>${amount(d.total)}</td>
            <td>${count(d.customer_count)}</td>
          </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td>${T.total}</td>
          <td>${amount(totals.cash)}</td>
          <td>${amount(totals.mada)}</td>
          <td>${amount(totals.total)}</td>
          <td>${count(totals.customers)}</td>
        </tr>
      </tfoot>
    </table>
    <p class="print-foot">${T.exportNote} — ${T.daysRecorded}: ${approved.length}</p>
  `;

  window.print();
  return { ok: true, count: approved.length };
}

function sum(rows, key) {
  return rows.reduce((acc, r) => acc + Number(r[key] || 0), 0);
}
