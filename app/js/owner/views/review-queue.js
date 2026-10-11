/**
 * Review queue — days waiting for the owner, newest first.
 *
 * If it is empty the owner must be able to see that in one glance and stop
 * wondering (guide 4.3). If it is not, the fastest thing on screen should be
 * the way into the first card.
 */
import { el } from '../../core/dom.js';
import { T } from '../../core/strings.js';
import { shortDate, weekdayName, money } from '../../core/format.js';
import { reviewQueue, pendingExtraction, readingProblem } from '../../data/entries.js';
import { CONFIG } from '../../config.js';
import { photoUrls } from '../../data/photos.js';
import { thumb } from '../../ui/photo.js';

export const title = T.reviewQueue;
export const showBack = false;

export async function render(root) {
  const [waiting, reading] = await Promise.all([reviewQueue(), pendingExtraction()]);

  root.innerHTML = '';

  if (!waiting.length && !reading.length) {
    root.append(emptyState());
    return;
  }

  const urls = await photoUrls(waiting.map((d) => d.photo_path));

  if (waiting.length) {
    root.append(
      el('div', { class: 'review-progress' }, [
        el('span', { text: T.waitingCount(waiting.length) }),
        el('a', { class: 'btn btn--quiet small', href: `#/review/${waiting[0].entry_date}`,
                  text: `${T.startReview} ←` }),
      ]),
      el('div', { class: 'list' }, waiting.map((day) => queueRow(day, urls))),
    );
  }

  // Photos that arrived but whose reading has not come back yet. Shown so a
  // stuck pipeline is visible rather than silent — Appendix C, "rows stuck at
  // pending_extraction forever".
  if (reading.length) {
    root.append(
      el('h2', { class: 'card__title', style: 'margin:var(--s-6) 0 var(--s-3)',
                 text: T.stillReading }),
      el('div', { class: 'list' }, reading.map(pendingRow)),
    );
  }
}

function queueRow(day, urls) {
  const flagged = day.extraction_error ||
    (day.extraction_confidence !== null && Number(day.extraction_confidence) <= CONFIG.LOW_CONFIDENCE);

  return el('a', {
    class: `list__item day-row${flagged ? ' list__item--flag' : ''}`,
    href: `#/review/${day.entry_date}`,
  }, [
    thumb(day.photo_path, urls),
    el('div', { class: 'grow' }, [
      el('div', { class: 'day-row__date', text: `${weekdayName(day.entry_date)} ${shortDate(day.entry_date)}` }),
      el('div', { class: 'day-row__meta', html: rowHint(day) }),
    ]),
    // Nothing read yet: a dash, not a misleading 0.00.
    el('div', { class: 'day-row__total',
                html: day.cash_total === null && day.mada_total === null ? '—' : money(day.total) }),
  ]);
}

function rowHint(day) {
  const { failed, warning } = readingProblem(day);
  if (failed) {
    return `<span style="color:var(--danger)">${T.extractionShort[failed] || T.extractionFailed}</span>`;
  }
  if (warning || (day.extraction_confidence !== null &&
                  Number(day.extraction_confidence) <= CONFIG.LOW_CONFIDENCE)) {
    return `<span style="color:var(--warn)">${T.lowConfidence}</span>`;
  }
  return `${T.cash} ${Number(day.cash_total || 0).toFixed(2)} · ${T.mada} ${Number(day.mada_total || 0).toFixed(2)}`;
}

/**
 * [4.2] A link now, not a dead row: a reading that never finishes has to be
 * reachable from where it is shown, so the owner can read it again or type
 * the figures himself (DEVIATIONS.md #10).
 */
function pendingRow(day) {
  const since = Date.parse(day.updated_at || day.submitted_at || '');
  const stuck = Number.isFinite(since) && Date.now() - since > CONFIG.STUCK_READING_MS;

  return el('a', { class: `list__item${stuck ? ' list__item--flag' : ''}`,
                   href: `#/review/${day.entry_date}` }, [
    stuck ? el('span', { style: 'color:var(--warn);flex:none;font-size:18px', html: '&#9888;' })
          : el('span', { class: 'spinner', style: 'color:var(--accent);flex:none' }),
    el('div', { class: 'grow' }, [
      el('div', { class: 'day-row__date',
                  text: `${weekdayName(day.entry_date)} ${shortDate(day.entry_date)}` }),
      el('div', { class: 'day-row__meta', text: stuck ? T.stuckReading : T.stillReadingHint }),
    ]),
    el('span', { class: 'badge badge--pending', text: stuck ? T.retryReading : T.statusPending }),
  ]);
}

function emptyState() {
  return el('div', { class: 'empty' }, [
    el('div', { class: 'empty__icon' }, [iconTick()]),
    el('p', { class: 'empty__title', text: T.reviewEmpty }),
    el('p', { class: 'small', text: T.reviewEmptyHint }),
  ]);
}

function iconTick() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '30');
  svg.setAttribute('height', '30');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = '<polyline points="20 6 9 17 4 12"/>';
  return svg;
}
