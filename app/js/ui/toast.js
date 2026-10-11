/** Transient messages. Never used to carry a figure in the worker app. */
import { el, $ } from '../core/dom.js';

function host() {
  let node = $('.toast-host');
  if (!node) {
    node = el('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    document.body.append(node);
  }
  return node;
}

/** @param {'info'|'ok'|'error'} kind */
export function toast(message, kind = 'info', ms = 3200) {
  const node = el('div', { class: `toast toast--${kind}`, text: message });
  host().append(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transition = 'opacity .2s';
    setTimeout(() => node.remove(), 220);
  }, ms);
}
