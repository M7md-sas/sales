/**
 * [4.2] The screen for a load that failed. Never an empty list: on a dropped
 * connection an empty list reads as "nothing here", and on the review queue
 * as "nothing waiting" — the one answer that must never be given falsely
 * (DEVIATIONS.md #21).
 */
import { el } from '../core/dom.js';
import { T } from '../core/strings.js';

export function loadFailed(title, retry) {
  return el('div', { class: 'load-failed', role: 'alert' }, [
    el('p', { class: 'load-failed__title', text: title || T.loadFailed }),
    el('p', { class: 'small muted', style: 'margin:var(--s-2) 0 var(--s-5)', text: T.loadFailedHint }),
    el('button', { class: 'btn btn--primary', type: 'button', text: T.retry, onclick: retry }),
  ]);
}
