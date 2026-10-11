/** The "more" tab: everything that is not a daily habit. */
import { el } from '../../core/dom.js';
import { T } from '../../core/strings.js';
import { go } from '../router.js';
import { signOut } from '../../core/auth.js';

export const title = T.navMore;
export const showBack = false;

const ITEMS = [
  ['/import',   T.bulkImport, iconUpload],
  ['/export',   T.exportTitle, iconDownload],
  ['/settings', T.settings, iconGear],
];

export async function render(root) {
  root.innerHTML = '';
  root.append(
    el('div', { class: 'menu' }, ITEMS.map(([path, label, icon]) =>
      el('button', { class: 'menu__item', type: 'button', onclick: () => go(path) }, [
        el('span', { html: icon() }),
        el('span', { class: 'grow', text: label }),
        el('span', { class: 'menu__chev', text: '‹' }),
      ]))),
    el('button', {
      class: 'btn btn--quiet btn--block', type: 'button', text: T.signOut,
      style: 'margin-top:var(--s-8);color:var(--danger)',
      onclick: async () => { await signOut(); location.reload(); },
    }),
  );
}

const svg = (paths) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"
  aria-hidden="true">${paths}</svg>`;

function iconUpload() {
  return svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
             '<polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>');
}
function iconDownload() {
  return svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
             '<polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>');
}
function iconGear() {
  return svg('<circle cx="12" cy="12" r="3"/>' +
             '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06' +
             'a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09' +
             'A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83' +
             'l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09' +
             'A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83' +
             'l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09' +
             'a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83' +
             'l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09' +
             'a1.65 1.65 0 0 0-1.51 1z"/>');
}
