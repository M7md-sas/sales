/**
 * Service worker for both apps.
 *
 * It caches the shell — HTML, CSS, JS, icons — so the worker's app opens
 * instantly and still opens at all in a dead spot, which is the whole point
 * of the offline queue behind it.
 *
 * It caches NOTHING from Supabase. Not a response, not a photo, not a
 * failed request. Guide 9.5 is explicit that the only thing allowed to
 * persist on the worker's phone is a photo still waiting to go out, and a
 * service worker that quietly kept an API response would break that promise
 * without anyone noticing.
 *
 * Strategy: network first for everything we serve ourselves, cache only as
 * the offline fallback.
 *
 * Cache-first would be faster, and it is what most examples show — but it
 * means a deployed fix does not reach either phone until someone remembers
 * to bump the cache name, and when that is forgotten the symptom is an app
 * running last month's code with no error anywhere to explain it. These are
 * fifteen small files opened a few times a day; the round trip costs nothing
 * that matters, and being wrong silently costs a great deal.
 */
// [4.2] Bump this whenever the SHELL list changes. Every file is network-first
// anyway, so a forgotten bump costs an extra download, never stale code.
const CACHE = 'shop-sales-v5';

// [4.2] Every script the two apps load, including the pinned library copy.
// Before, no JS at all was pre-cached and the library came from another site
// the service worker never stores — so the worker app could not open in a
// dead spot, the one place it has to (DEVIATIONS.md #19).
// Adding a file under js/ or vendor/? Add it here too.
const SHELL = [
  './',
  './index.html',
  './owner/',
  './owner/index.html',
  './css/tokens.css',
  './css/base.css',
  './css/components.css',
  './css/worker.css',
  './css/owner.css',
  './manifest.json',
  './owner/manifest.json',
  './icons/192.png',
  './icons/512.png',
  './js/config.js',
  './js/core/auth.js',
  './js/core/dom.js',
  './js/core/errors.js',
  './js/core/format.js',
  './js/core/password.js',
  './js/core/strings.js',
  './js/core/supabase.js',
  './js/data/entries.js',
  './js/data/expenses.js',
  './js/data/imports.js',
  './js/data/photos.js',
  './js/data/reports.js',
  './js/data/settings.js',
  './js/data/storage.js',
  './js/data/submit.js',
  './js/owner/export/excel.js',
  './js/owner/export/print.js',
  './js/owner/main.js',
  './js/owner/photo-date.js',
  './js/owner/router.js',
  './js/owner/views/archive.js',
  './js/owner/views/capture-today.js',
  './js/owner/views/day.js',
  './js/owner/views/export.js',
  './js/owner/views/import.js',
  './js/owner/views/monthly.js',
  './js/owner/views/more.js',
  './js/owner/views/review-card.js',
  './js/owner/views/review-queue.js',
  './js/owner/views/settings.js',
  './js/owner/views/today.js',
  './js/ui/load-failed.js',
  './js/ui/photo.js',
  './js/ui/signin.js',
  './js/ui/toast.js',
  './js/worker/camera.js',
  './js/worker/capture.js',
  './js/worker/main.js',
  './js/worker/queue.js',
  './vendor/supabase-2.117.2.js',
  './vendor/xlsx-0.18.5.mini.min.js',
];

/** [4.2] On a weak signal, give the network this long before using the cache. */
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // addAll fails the whole install if one entry 404s; individual puts
      // let a missing icon stay a missing icon rather than break the app.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Anything that is not our own static file goes straight to the network
  // and is never stored: Supabase, storage, the font CDN, the Gemini side of
  // the world. No cache entry, no stale figure, nothing to find later.
  if (url.origin !== self.location.origin) return;

  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  const cached = () => caches.match(request, { ignoreSearch: true }).then((hit) => (
    // Offline: serve what we have. A navigation with nothing cached for
    // it still gets the worker's shell, which is the screen that has to
    // open in a dead spot.
    hit || (request.mode === 'navigate' ? caches.match('./index.html') : undefined)
  ));

  const network = fetch(request).then((response) => {
    if (response.ok && response.type === 'basic') {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy));
    }
    return response;
  });

  // [4.2] A network that neither answers nor fails (one bar of signal) used
  // to hold the app on a blank screen until the browser gave up. After a few
  // seconds the cached copy is used, and the network copy still refreshes
  // the cache when it arrives.
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS));
  const first = await Promise.race([network.catch(() => null), timeout]);
  if (first) return first;

  const hit = await cached();
  if (hit) return hit;
  return network.catch(() => cached()).then((r) => r || Response.error());
}
