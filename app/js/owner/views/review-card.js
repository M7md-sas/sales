/**
 * THE REVIEW CARD.
 *
 * "The review card — photo beside the three numbers — is the single most
 *  important layout in this project. Get it right and everything else is
 *  easy." (guide 4.1)
 *
 * Two things this screen must do well:
 *   1. A correct day takes one tap. The fields arrive pre-filled from the
 *      model's reading, so the owner is confirming, not typing.
 *   2. Approving advances straight to the next waiting day. That is what
 *      makes fifty backlog days survivable (guide 4.4) — the same card,
 *      no navigation between them.
 *
 * There is no reject button. Editing a field before approving IS the
 * correction, and the model's original answer is kept regardless.
 */
import { el, $, busy } from '../../core/dom.js';
import { T } from '../../core/strings.js';
import { longDate, shortDate, weekdayName, money, amount, percent, todayRiyadh } from '../../core/format.js';
import { normaliseDigits } from '../../core/password.js';
import { CONFIG } from '../../config.js';
import {
  getDay, approveDay, reviewQueue, retryExtraction, moveDay, readingProblem,
} from '../../data/entries.js';
import { trendFor } from '../../data/reports.js';
import { photoBlock } from '../../ui/photo.js';
import { toast } from '../../ui/toast.js';
import { messageFor } from '../../core/errors.js';
import { go } from '../router.js';

export const title = (params) => longDate(params.date);
export const showBack = true;

/** The 7-day average for the day on screen, for the "far from usual" hint. */
let average = null;

export async function render(root, params, ctx) {
  const [day, queue] = await Promise.all([getDay(params.date), reviewQueue()]);

  if (!day) {
    root.innerHTML = `<div class="empty"><p class="empty__title">${T.noDataYet}</p></div>`;
    return;
  }

  // Everything still waiting after this one, so we know where to go next.
  const remaining = queue.filter((d) => d.entry_date !== day.entry_date);

  average = null;
  trendFor(day.entry_date).then((trend) => {
    average = Number(trend?.avg_last_7_days) || null;
    recalcTotal();
  }).catch(() => {});

  root.innerHTML = '';
  root.append(
    progressBar(remaining.length),
    el('div', { class: 'review-card' }, [
      el('div', { class: 'review-card__photo' }, [photoBlock(day.photo_path)]),
      fieldsPanel(day, remaining, ctx),
    ]),
  );
  recalcTotal();

  // Enter approves, so a keyboard owner clears the backlog without reaching
  // for the mouse between days. Returned to the router as this view's cleanup.
  const onKey = (e) => {
    const button = $('#btn-approve');
    if (e.key === 'Enter' && button && !button.disabled &&
        e.target.tagName !== 'BUTTON' && e.target.type !== 'date') {
      button.click();
    }
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}

function progressBar(remaining) {
  return el('div', { class: 'review-progress' }, [
    el('span', { text: remaining > 0 ? T.approvedCountdown(remaining) : T.reviewLastOne }),
  ]);
}

function fieldsPanel(day, remaining, ctx) {
  const panel = el('div', { class: 'card stack' });

  panel.append(
    el('div', { class: 'review-card__head' }, [
      // The full date is already in the top bar; here the short form fits on one line.
      el('div', { class: 'review-card__date', text: `${weekdayName(day.entry_date)} ${shortDate(day.entry_date)}` }),
      el('span', {
        class: `badge badge--${badgeKind(day.status)}`,
        text: badgeText(day.status),
      }),
    ]),
    confidenceNote(day),
    dateTakenNote(day),
    retryBlock(day),
    fields(day),
    totalRow(),
    el('div', { id: 'f-average', class: 'hidden' }),
    approveButton(day, remaining, ctx),
    modelReading(day),
    moveBlock(day),
  );

  return panel;
}

function badgeKind(status) {
  return { approved: 'approved', needs_review: 'review', pending_extraction: 'pending' }[status] || 'review';
}
function badgeText(status) {
  return { approved: T.statusApproved, needs_review: T.statusNeedsReview,
           pending_extraction: T.statusPending }[status] || T.statusNeedsReview;
}

/**
 * The confidence indicator. Amber when the model was unsure, red when it
 * failed outright — in which case the fields are empty and the owner types
 * from the photo, which is exactly the degradation the pipeline is designed
 * for (guide 7.4, test 11.2).
 *
 * [4.2] A failure now says why — quota, busy service, dead key, retired
 * model — so a permanent outage stands out from one blurry photo
 * (DEVIATIONS.md #17).
 */
function confidenceNote(day) {
  if (day.status === 'pending_extraction') {
    return note('low', `${T.stillReading} ${T.typeInstead}`);
  }
  const { failed, warning } = readingProblem(day);
  if (failed) {
    return note('error', T.extractionWhy[failed] || T.extractionFailed);
  }
  const c = day.extraction_confidence;
  if (warning) {
    return note('low', `${T.readingWarning}${c !== null && c !== undefined ? ` (${percent(c)})` : ''}`);
  }
  if (c !== null && c !== undefined && Number(c) <= CONFIG.LOW_CONFIDENCE) {
    return note('low', `${T.lowConfidence} (${percent(c)})`);
  }
  if (c !== null && c !== undefined) {
    return note('ok', `قراءة واضحة (${percent(c)})`);
  }
  return el('span', { class: 'hidden' });
}

/**
 * [4.3] The page says another date, and that date already has a photo, so
 * the day was left where it was sent (DEVIATIONS.md #29). The move block
 * below the card is the way to settle it once the owner has compared them.
 */
function dateTakenNote(day) {
  const { dateTaken } = readingProblem(day);
  if (!dateTaken || day.status === 'approved') return el('span', { class: 'hidden' });
  return note('low', T.pageDateTaken(longDate(dateTaken)));
}

function note(kind, text) {
  return el('div', { class: `confidence confidence--${kind}` }, [
    el('span', { html: kind === 'ok' ? '&#10003;' : '&#9888;',
                 style: 'font-size:16px;line-height:1.3' }),
    el('span', { class: 'grow', text }),
  ]);
}

/**
 * [4.2] "Read again" — the way out of a failed reading or one that never
 * came back. Shown for a failure, and for a reading pending longer than
 * usual. Approved days are final and never offered it (DEVIATIONS.md #10).
 */
function retryBlock(day) {
  if (day.status === 'approved' || !day.photo_path || day.photo_path === 'none') {
    return el('span', { class: 'hidden' });
  }
  const since = Date.parse(day.updated_at || day.submitted_at || '');
  const stuck = day.status === 'pending_extraction' &&
    Number.isFinite(since) && Date.now() - since > CONFIG.STUCK_READING_MS;
  const failed = day.status === 'needs_review' && readingProblem(day).failed;
  if (!stuck && !failed) return el('span', { class: 'hidden' });

  const button = el('button', {
    class: 'btn btn--ghost btn--block', type: 'button', text: T.retryReading,
  });
  button.addEventListener('click', async () => {
    const restore = busy(button, T.loading);
    const result = await retryExtraction(day.entry_date);
    restore();
    if (!result.ok) {
      toast(messageFor(result.code), 'error');
      return;
    }
    toast(T.retryQueued, 'ok');
    go('/review');
  });
  return button;
}

/**
 * Pre-filled from cash_total / mada_total / customer_count — the working
 * columns record_extraction already populated — and never from extracted_*
 * directly. Guide 9.6: the working columns are what the owner edits, the
 * extracted_* columns are the permanent original.
 *
 * [4.2] Text fields with a decimal keypad instead of type=number: a phone set
 * to Arabic digits types "١٢٥", which a number field silently empties.
 * Digits are converted as they are typed.
 */
function fields(day) {
  return el('div', { class: 'review-fields' }, [
    el('div', { class: 'review-fields__pair' }, [
      amountField('cash', T.cash, day.cash_total, day),
      amountField('mada', T.mada, day.mada_total, day),
    ]),
    // [4.3] Kept apart from the sales total (DEVIATIONS.md #27). Empty = none.
    el('div', { class: 'review-fields__pair' }, [
      amountField('debt', T.debt, day.debt_total, day),
      amountField('repaid', T.repaid, day.repaid_total, day),
    ]),
    el('label', { class: 'field' }, [
      el('span', { class: 'field__label', text: T.customers }),
      el('input', {
        class: 'input input--amount', id: 'f-customers', type: 'text',
        inputmode: 'numeric', autocomplete: 'off', maxlength: '3',
        value: day.customer_count ?? '',
        oninput: (e) => cleanNumber(e.target, false),
      }),
    ]),
  ]);
}

function amountField(id, label, value, day) {
  const flagged = Boolean(day.extraction_error) || day.status === 'pending_extraction' ||
    (day.extraction_confidence !== null && Number(day.extraction_confidence) <= CONFIG.LOW_CONFIDENCE);

  return el('label', { class: 'field' }, [
    el('span', { class: 'field__label', text: `${label} (${T.currency})` }),
    el('input', {
      class: `input input--amount${flagged ? ' input--flagged' : ''}`,
      id: `f-${id}`, type: 'text', inputmode: 'decimal', autocomplete: 'off',
      maxlength: '10',
      value: value ?? '',
      oninput: (e) => { cleanNumber(e.target, true); recalcTotal(); },
    }),
  ]);
}

/** Arabic digits → Western; only digits and one decimal point survive. */
function cleanNumber(input, decimal) {
  let v = normaliseDigits(input.value).replace(/[٫,]/g, '.');
  v = v.replace(decimal ? /[^\d.]/g : /\D/g, '');
  if (decimal) {
    const [whole, ...rest] = v.split('.');
    v = rest.length ? `${whole}.${rest.join('').slice(0, 2)}` : whole;
  }
  if (v !== input.value) input.value = v;
}

function readAmount(id) {
  const raw = $(`#f-${id}`)?.value ?? '';
  if (raw === '') return '';
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

function totalRow() {
  return el('div', { class: 'review-total' }, [
    el('span', { class: 'review-total__label', text: T.total }),
    el('span', { class: 'figure-md', id: 'f-total', html: money(0) }),
  ]);
}

/**
 * Display only — the database owns the stored total (Appendix C).
 * [4.2] Also flags a total far from the last 7 days' average, the one check
 * that catches a misread column the model was confident about
 * (DEVIATIONS.md #16).
 */
function recalcTotal() {
  const cash = Number($('#f-cash')?.value || 0);
  const mada = Number($('#f-mada')?.value || 0);
  // [4.3] A repayment counts in the day's total (DEVIATIONS.md #30).
  const repaid = Number($('#f-repaid')?.value || 0);
  const total = cash + mada + repaid;
  const node = $('#f-total');
  if (node) node.innerHTML = money(total);

  const hint = $('#f-average');
  if (!hint) return;
  const off = average && total > 0 ? Math.round(((total - average) / average) * 100) : 0;
  if (Math.abs(off) >= 50) {
    hint.className = 'confidence confidence--low';
    hint.textContent = T.farFromAverage(off);
  } else {
    hint.className = 'hidden';
  }
}

function approveButton(day, remaining, ctx) {
  const button = el('button', {
    class: 'btn btn--approve btn--lg btn--block',
    id: 'btn-approve',
    type: 'button',
    text: day.status === 'approved' ? T.save : T.approve,
  });

  button.addEventListener('click', async () => {
    const cash = readAmount('cash');
    const mada = readAmount('mada');
    const customers = $('#f-customers').value;
    const debt = readAmount('debt');
    const repaid = readAmount('repaid');

    if (cash === '' || mada === '' || Number.isNaN(cash) || Number.isNaN(mada) ||
        Number.isNaN(debt) || Number.isNaN(repaid) ||
        cash > 999999.99 || mada > 999999.99 || Number(debt) > 999999.99 ||
        Number(repaid) > 999999.99 || Number(customers) > 999) {
      toast(messageFor('bad_amount'), 'error');
      return;
    }

    const restore = busy(button, T.approving);
    const result = await approveDay({
      entryDate: day.entry_date,
      cash, mada, customers,
      debt: debt === '' ? 0 : debt,
      repaid: repaid === '' ? 0 : repaid,
      revision: day.revision,
    });
    restore();

    if (!result.ok) {
      toast(messageFor(result.code), 'error');
      // [4.2] The worker re-sent this day while the card was open: show the
      // new photo instead of approving figures read from the old one.
      if (result.code === 'stale') go(`/review/${day.entry_date}`);
      return;
    }

    toast(T.approved, 'ok');
    ctx.refreshBadge?.();

    // Straight to the next waiting day — the queue behaviour from 4.4.
    if (remaining.length) go(`/review/${remaining[0].entry_date}`);
    else go('/review');
  });

  return button;
}

/**
 * The model's untouched answer, shown next to what the owner is about to
 * confirm. Kept visible so a systematic misreading becomes noticeable to
 * the person best placed to notice it.
 */
function modelReading(day) {
  if (day.extracted_cash === null && day.extracted_mada === null) {
    return el('span', { class: 'hidden' });
  }
  return el('details', { class: 'small muted' }, [
    el('summary', { style: 'cursor:pointer;padding:var(--s-2) 0', text: T.modelReading }),
    el('div', { class: 'kv', style: 'margin-top:var(--s-2)' }, [
      el('dt', { text: T.cash }),  el('dd', { class: 'num', text: amount(day.extracted_cash) }),
      el('dt', { text: T.mada }),  el('dd', { class: 'num', text: amount(day.extracted_mada) }),
      el('dt', { text: T.debt }),  el('dd', { class: 'num', text: amount(day.extracted_debt) }),
      el('dt', { text: T.repaid }), el('dd', { class: 'num', text: amount(day.extracted_repaid) }),
      el('dt', { text: T.customers }), el('dd', { class: 'num', text: day.extracted_customers ?? '—' }),
    ]),
  ]);
}

/**
 * [4.2] A page sent after midnight lands on the next day — the business day
 * closes at 12 (the client's decision). This lets the owner put it back
 * where it belongs, into an empty date only (DEVIATIONS.md #9).
 */
function moveBlock(day) {
  if (day.status === 'approved') return el('span', { class: 'hidden' });

  const input = el('input', { class: 'input', type: 'date', max: todayRiyadh(),
                              value: day.entry_date, 'aria-label': T.moveDay });
  const button = el('button', { class: 'btn btn--ghost', type: 'button', text: T.moveDayButton });

  button.addEventListener('click', async () => {
    const to = input.value;
    if (!to || to === day.entry_date) return;
    const restore = busy(button, T.loading);
    const result = await moveDay(day.entry_date, to);
    restore();
    if (!result.ok) {
      toast(messageFor(result.code), 'error');
      return;
    }
    toast(T.moveDayDone, 'ok');
    go(`/review/${to}`, { replace: true });
  });

  return el('details', { class: 'small muted' }, [
    el('summary', { style: 'cursor:pointer;padding:var(--s-2) 0', text: T.moveDay }),
    el('div', { class: 'row', style: 'gap:var(--s-2);margin-top:var(--s-2)' }, [input, button]),
  ]);
}
