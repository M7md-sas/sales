/**
 * Day detail — an approved day, with the photograph, the confirmed figures,
 * the model's original reading beside them, and the change history.
 *
 * The side-by-side comparison is the point (guide 6.1): "comparing
 * extracted_cash to cash_total across every row tells you immediately
 * whether it is worth tuning the prompt or switching models."
 */
import { el } from '../../core/dom.js';
import { T } from '../../core/strings.js';
import { longDate, money, amount, count, dateTime } from '../../core/format.js';
import { getDay, auditFor } from '../../data/entries.js';
import { photoBlock } from '../../ui/photo.js';
import { go } from '../router.js';

export const title = (params) => longDate(params.date);
export const showBack = true;

export async function render(root, params) {
  const day = await getDay(params.date);
  if (!day) {
    root.innerHTML = `<div class="empty"><p class="empty__title">${T.noDataYet}</p></div>`;
    return;
  }

  const history = await auditFor(params.date);

  root.innerHTML = '';
  root.append(el('div', { class: 'stack-lg' }, [
    figuresCard(day),
    comparisonCard(day),
    el('div', { class: 'card card--flush' }, [photoBlock(day.photo_path)]),
    metaCard(day),
    historyCard(history),
    el('button', {
      class: 'btn btn--ghost btn--block', type: 'button', text: T.editFigures,
      onclick: () => go(`/review/${day.entry_date}`),
    }),
  ].filter(Boolean)));
}

function figuresCard(day) {
  return el('div', { class: 'card' }, [
    el('div', { class: 'row row-between', style: 'align-items:baseline' }, [
      el('div', { class: 'card__title', text: T.total }),
      el('span', {
        class: `badge badge--${day.status === 'approved' ? 'approved' : 'review'}`,
        text: day.status === 'approved' ? T.statusApproved : T.statusNeedsReview,
      }),
    ]),
    el('div', { class: 'figure-lg', html: money(day.total), style: 'margin:var(--s-2) 0 var(--s-5)' }),
    el('div', { class: 'stats' }, [
      stat(T.cash, money(day.cash_total)),
      stat(T.mada, money(day.mada_total)),
      stat(T.customers, `<span class="num">${count(day.customer_count)}</span>`),
      stat(T.perCustomer, day.customer_count > 0
        ? money(Number(day.total) / Number(day.customer_count)) : '—'),
    ]),
  ]);
}

function stat(label, valueHtml) {
  return el('div', { class: 'stat' }, [
    el('div', { class: 'stat__label', text: label }),
    el('div', { class: 'stat__value', html: valueHtml }),
  ]);
}

/**
 * Confirmed figures against the model's untouched answer. A differing cell
 * is marked — over months these marks are the record of how the extraction
 * is actually performing.
 */
function comparisonCard(day) {
  if (day.extracted_cash === null && day.extracted_mada === null && !day.extraction_error) {
    return null;
  }

  const rows = [
    [T.cash, day.cash_total, day.extracted_cash, amount],
    [T.mada, day.mada_total, day.extracted_mada, amount],
    [T.customers, day.customer_count, day.extracted_customers, count],
  ];

  return el('div', { class: 'card' }, [
    el('div', { class: 'card__title', text: 'مقارنة مع قراءة النظام' }),
    el('table', { class: 'compare-table', style: 'margin-top:var(--s-3)' }, [
      el('thead', [el('tr', [
        el('th', { text: '' }),
        el('th', { style: 'text-align:end', text: T.confirmedFigures }),
        el('th', { style: 'text-align:end', text: T.modelReading }),
      ])]),
      el('tbody', rows.map(([label, confirmed, extracted, fmt]) => {
        const differs = extracted !== null && Number(confirmed) !== Number(extracted);
        return el('tr', [
          el('td', { text: label }),
          el('td', { style: 'text-align:end' }, [el('span', { class: 'num', text: fmt(confirmed) })]),
          el('td', { class: differs ? 'cell-diff' : null, style: 'text-align:end' },
            [el('span', { class: 'num', text: fmt(extracted) })]),
        ]);
      })),
    ]),
    day.extraction_error
      ? el('p', { class: 'xs', style: 'color:var(--danger);margin-top:var(--s-3)',
                  text: T.extractionFailed })
      : null,
  ].filter(Boolean));
}

function metaCard(day) {
  return el('div', { class: 'card' }, [
    el('dl', { class: 'kv' }, [
      el('dt', { text: T.submittedAt }), el('dd', { text: dateTime(day.submitted_at) }),
      el('dt', { text: T.reviewedAt }),  el('dd', { text: dateTime(day.reviewed_at) }),
      el('dt', { text: T.revision }),    el('dd', { class: 'num', text: String(day.revision) }),
      el('dt', { text: 'المصدر' }),
      el('dd', { text: day.source === 'owner_import' ? T.sourceImport : T.sourceWorker }),
      ...(day.extraction_confidence !== null
        ? [el('dt', { text: 'ثقة القراءة' }),
           el('dd', { class: 'num', text: `${Math.round(day.extraction_confidence * 100)}%` })]
        : []),
      ...(day.notes ? [el('dt', { text: T.notes }), el('dd', { text: day.notes })] : []),
    ]),
  ]);
}

function historyCard(history) {
  if (!history.length) return null;

  const label = {
    create: 'أول إرسال',
    replace: 'إعادة إرسال',
    approve: 'اعتماد',
    correct: 'تصحيح بعد الاعتماد',
    owner_import: 'استيراد',
    retry_extraction: 'إعادة قراءة',
    move: 'نقل تاريخ',
  };

  return el('div', { class: 'card' }, [
    el('div', { class: 'card__title', text: 'السجل' }),
    el('div', { class: 'stack-sm', style: 'margin-top:var(--s-3)' },
      history.map((row) => el('div', { class: 'row row-between small' }, [
        el('span', { text: label[row.action] || row.action }),
        el('span', { class: 'muted xs', text: dateTime(row.at) }),
      ]))),
  ]);
}
