/**
 * Excel export — SheetJS in the browser, no server involved (guide 10.1).
 *
 * Approved days only. An unreviewed day is not yet a figure about the
 * business, and a spreadsheet that quietly included one would be wrong in a
 * way nobody would catch months later.
 *
 * The library is imported on demand so the dashboard does not pay for it on
 * every load — most sessions never export anything.
 */
import { T } from '../../core/strings.js';
import { monthLabel } from '../../core/format.js';

export async function exportExcel(rows, { from, to, expenses = [] }) {
  const approved = rows.filter((r) => r.status === 'approved');
  if (!approved.length) return { ok: false, code: 'empty' };

  const XLSX = await loadSheetJS();

  const data = approved
    .slice()
    .sort((a, b) => a.entry_date.localeCompare(b.entry_date))
    .map((d) => ({
      'التاريخ': d.entry_date,
      'نقدي': Number(d.cash_total),
      'شبكة': Number(d.mada_total),
      'الإجمالي': Number(d.total),
      'ديون': Number(d.debt_total || 0),
      'سداد ديون': Number(d.repaid_total || 0),
      'الزبائن': d.customer_count ?? 0,
    }));

  // Totals row, summed from the database's own `total` column.
  data.push({
    'التاريخ': T.total,
    'نقدي': sum(approved, 'cash_total'),
    'شبكة': sum(approved, 'mada_total'),
    'الإجمالي': sum(approved, 'total'),
    'ديون': sum(approved, 'debt_total'),
    'سداد ديون': sum(approved, 'repaid_total'),
    'الزبائن': sum(approved, 'customer_count'),
  });

  // [4.3] Income, expenses and what is left, under the totals (DEVIATIONS.md #32).
  const income = sum(approved, 'total');
  const spent = sum(expenses, 'amount');
  data.push({}, 
    { 'التاريخ': T.income, 'الإجمالي': income },
    { 'التاريخ': T.expenses, 'الإجمالي': spent },
    { 'التاريخ': T.remaining, 'الإجمالي': Number((income - spent).toFixed(2)) });

  const sheet = XLSX.utils.json_to_sheet(data);
  sheet['!cols'] = [{ wch: 12 }, { wch: 11 }, { wch: 11 }, { wch: 12 }, { wch: 11 }, { wch: 11 }, { wch: 9 }];

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'المبيعات');
  if (expenses.length) {
    const list = expenses.map((x) => ({
      [T.expenseMonth]: monthLabel(x.month),
      [T.expenseWhat]: x.description,
      [T.expenseAmount]: Number(x.amount),
    }));
    list.push({ [T.expenseMonth]: T.total, [T.expenseAmount]: spent });
    const expenseSheet = XLSX.utils.json_to_sheet(list);
    expenseSheet['!cols'] = [{ wch: 14 }, { wch: 28 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(book, expenseSheet, T.expenses);
  }
  XLSX.writeFile(book, `sales_${from}_${to}.xlsx`);

  return { ok: true, count: approved.length };
}

/**
 * [4.2] A pinned local copy, loaded on demand with a plain <script> tag. It
 * used to come from esm.sh, which the CSP no longer allows and the offline
 * cache never kept (DEVIATIONS.md #19).
 */
let loading = null;
function loadSheetJS() {
  if (globalThis.XLSX) return Promise.resolve(globalThis.XLSX);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('../../../vendor/xlsx-0.18.5.mini.min.js', import.meta.url).href;
    script.onload = () => resolve(globalThis.XLSX);
    script.onerror = () => { loading = null; reject(new Error('xlsx_failed')); };
    document.head.append(script);
  });
  return loading;
}

function sum(rows, key) {
  return Number(rows.reduce((acc, r) => acc + Number(r[key] || 0), 0).toFixed(2));
}
