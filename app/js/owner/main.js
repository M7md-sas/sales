/**
 * Owner dashboard — shell, sign-in guard and route table.
 *
 * Views live in ./views and know nothing about each other; they receive a
 * root element and their route params, render into it, and are done. Adding
 * a screen is: write the view, add one line to ROUTES, add a tab if it needs
 * one. Nothing else in this file changes.
 */
import { $, on, show, setText, showScreen } from '../core/dom.js';
import { T } from '../core/strings.js';
import { signIn, requireOwner, getSession, onAuthChange } from '../core/auth.js';
import { hasStoredSession } from '../core/supabase.js';
import { LoadError } from '../core/errors.js';
import { loadSettings } from '../data/settings.js';
import { reviewCount } from '../data/entries.js';
import { mountSignIn } from '../ui/signin.js';
import { loadFailed } from '../ui/load-failed.js';
import { route, start, onRoute, back, setCleanup } from './router.js';

import * as reviewQueue from './views/review-queue.js';
import * as reviewCard from './views/review-card.js';
import * as today from './views/today.js';
import * as archive from './views/archive.js';
import * as dayDetail from './views/day.js';
import * as monthly from './views/monthly.js';
import * as bulkImport from './views/import.js';
import * as exportView from './views/export.js';
import * as settingsView from './views/settings.js';
import * as more from './views/more.js';

/* -------------------------------------------------------------- routes */

const ROUTES = [
  ['/review',        reviewQueue, 'review'],
  ['/review/:date',  reviewCard,  'review'],
  ['/today',         today,       'today'],
  ['/archive',       archive,     'archive'],
  ['/day/:date',     dayDetail,   'archive'],
  ['/monthly',       monthly,     'monthly'],
  ['/import',        bulkImport,  'more'],
  ['/export',        exportView,  'more'],
  ['/settings',      settingsView,'more'],
  ['/more',          more,        'more'],
];

for (const [pattern, view, tab] of ROUTES) route(pattern, { ...view, tab });

/* ---------------------------------------------------------------- shell */

const els = {
  view: $('#view'),
  title: $('#view-title'),
  back: $('#btn-back'),
  refresh: $('#btn-refresh'),
  badge: $('#review-badge'),
};

/** Shared context handed to every view. */
export const ctx = {
  settings: null,
  refreshBadge,
};

let entered = false;

async function boot() {
  on(els.back, 'click', () => back());
  on(els.refresh, 'click', reload);

  if (!(await getSession()) && !hasStoredSession()) {
    showSignIn();
    return;
  }

  // [4.2] "Can't reach the server" is not "you are not the owner". It used to
  // sign the owner out on every bad connection — and then tell him his code
  // was wrong (DEVIATIONS.md #20).
  const verdict = await requireOwner();
  if (verdict === 'ok') enterDashboard();
  else if (verdict === 'unreachable') showUnreachable();
  else showSignIn();
}

function showSignIn(notice = '') {
  mountSignIn({
    mount: $('#signin-mount'),
    shopName: T.appNameOwner,
    notice,
    onSubmit: async (password) => {
      const result = await signIn('owner', password);
      if (!result.ok) return result;
      const verdict = await requireOwner();
      if (verdict === 'unreachable') return { ok: false, reason: 'offline' };
      if (verdict !== 'ok') return { ok: false, reason: 'wrong' };
      enterDashboard();
      return { ok: true };
    },
  });
  showScreen('screen-signin');
}

/** Signed in, but the server could not be reached to confirm it. */
function showUnreachable() {
  const mount = $('#signin-mount');
  mount.innerHTML = '';
  mount.className = 'signin-screen';
  mount.append(loadFailed(T.unreachable, () => location.reload()));
  showScreen('screen-signin');
}

async function enterDashboard() {
  if (entered) return;
  entered = true;
  showScreen('screen-dash');
  ctx.settings = await loadSettings();

  onRoute(renderRoute);
  // Setting the hash fires 'hashchange', which renders by itself; rendering
  // here as well drew the queue twice.
  if (!location.hash) location.replace('#/review');
  else await start();
  refreshBadge();

  // [4.2] Session ended elsewhere (password changed, token revoked).
  onAuthChange((event) => {
    if (event === 'SIGNED_OUT') location.reload();
  });
}

async function renderRoute(found) {
  const { view, params, tab } = found;

  setText(els.title, typeof view.title === 'function' ? view.title(params) : view.title);
  show(els.back, Boolean(view.showBack));
  markTab(tab);

  // [4.2] Each render gets its own container. A render still waiting on the
  // network when the next one starts finishes into a detached node instead of
  // appending a second copy of its list to the screen.
  const host = document.createElement('div');
  host.innerHTML = '<div class="empty"><span class="spinner spinner--lg" ' +
                   'style="color:var(--accent);margin:0 auto"></span></div>';
  els.view.replaceChildren(host);

  try {
    const cleanup = await view.render(host, params, ctx);
    if (typeof cleanup === 'function') setCleanup(cleanup);
  } catch (error) {
    console.error('[view]', found.pattern, error);
    host.innerHTML = '';
    // [4.2] A failed load gets its own screen with a retry, never an empty
    // list that reads as "nothing here".
    host.append(loadFailed(
      error instanceof LoadError ? T.loadFailed : T.unknownError,
      () => start(),
    ));
  }

  els.view.focus({ preventScroll: true });
}

function markTab(tab) {
  document.querySelectorAll('.tabbar__tab').forEach((node) => {
    node.classList.toggle('is-active', node.dataset.tab === tab);
  });
}

async function reload() {
  els.refresh.classList.add('is-spinning');
  ctx.settings = await loadSettings({ force: true });
  await start();
  await refreshBadge();
  els.refresh.classList.remove('is-spinning');
}

/**
 * The waiting count. Section 12: if the owner stops checking, the archive
 * quietly understates the shop — so this number has to be loud.
 * [4.2] When the count cannot be fetched the badge shows "!" instead of
 * vanishing — a missing badge reads as "all clear".
 */
async function refreshBadge() {
  const waiting = await reviewCount();
  if (waiting === null) {
    setText(els.badge, '!');
    show(els.badge, true);
    return null;
  }
  setText(els.badge, String(waiting));
  show(els.badge, waiting > 0);
  return waiting;
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('../sw.js', { scope: '../' })
      .catch(() => { /* offline shell is optional */ });
  });
}

boot();
