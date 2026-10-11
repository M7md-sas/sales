/**
 * Hash router.
 *
 * Hash-based on purpose: the apps are hosted as plain static files, and a
 * path-based router would need a rewrite rule on every host we might use.
 * '#/day/2026-08-07' works identically on GitHub Pages, Netlify and a folder
 * opened from disk.
 */

const routes = [];
let current = null;

/**
 * @param {string} pattern e.g. '/day/:date'
 * @param {{title: string|Function, render: Function}} view
 */
export function route(pattern, view) {
  const keys = [];
  const regex = new RegExp('^' + pattern.replace(/:([^/]+)/g, (_, key) => {
    keys.push(key);
    return '([^/]+)';
  }) + '$');
  routes.push({ regex, keys, view, pattern });
}

export function match(hash) {
  const path = (hash || '#/').replace(/^#/, '') || '/';
  for (const entry of routes) {
    const found = path.match(entry.regex);
    if (found) {
      const params = Object.fromEntries(entry.keys.map((k, i) => [k, decodeURIComponent(found[i + 1])]));
      return { ...entry, params };
    }
  }
  return null;
}

export function go(path, { replace = false } = {}) {
  const hash = `#${path}`;
  if (location.hash === hash) return start();          // same route: re-render
  if (replace) location.replace(hash);
  else location.hash = hash;
}

export function back(fallback = '/review') {
  if (history.length > 1) history.back();
  else go(fallback, { replace: true });
}

let onNavigate = () => {};
export function onRoute(handler) { onNavigate = handler; }

export async function start() {
  const found = match(location.hash);
  if (!found) return go('/review', { replace: true });

  // Let the outgoing view cancel timers, abort uploads, release object URLs.
  if (current?.cleanup) { try { current.cleanup(); } catch { /* ignore */ } }
  current = found;
  await onNavigate(found);
}

export function setCleanup(fn) {
  if (current) current.cleanup = fn;
}

export function currentPath() {
  return (location.hash || '#/').replace(/^#/, '') || '/';
}

window.addEventListener('hashchange', start);
