/**
 * The one Supabase client, shared by both apps.
 *
 * Nothing outside js/data/ should import this. Views ask the data layer
 * for what they need; the data layer is the only place that knows the
 * shape of a table or the name of an RPC.
 *
 * [4.2] The library is a pinned copy in app/vendor/, loaded by a plain
 * <script> tag before this module (see both index.html files). It used to be
 * imported from esm.sh at an unpinned "@2": the service worker never caches
 * another site, so in a dead spot the whole worker app failed to start —
 * exactly when the offline queue is needed — and any new release could change
 * behaviour with nobody deploying anything (DEVIATIONS.md #19).
 */
import { CONFIG } from '../config.js';

const lib = globalThis.supabase;
if (!lib?.createClient) {
  throw new Error('vendor/supabase-*.js did not load — check the <script> tag in index.html');
}

if (CONFIG.DEMO) {
  console.info('DEMO MODE — talking to tools/mock_supabase.py, not a real project.');
} else if (CONFIG.SUPABASE_URL.includes('YOUR-PROJECT-REF')) {
  console.error(
    'app/js/config.js still holds placeholder values. ' +
    'Fill in SUPABASE_URL and SUPABASE_ANON_KEY — see docs/الإعداد-خطوة-بخطوة.md\n' +
    'To look around with sample data instead, run start-demo.bat and open ?demo'
  );
}

/**
 * [4.2] Each app keeps its own session. They share one origin, so with one
 * shared key an owner who once signed in on the shop phone left the owner
 * dashboard open to whoever picked that phone up next (DEVIATIONS.md #14).
 */
export const APP = location.pathname.includes('/owner/') ? 'owner' : 'worker';
export const STORAGE_KEY = `shop-sales-${APP}-auth`;

export const supabase = lib.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,      // the worker signs in about once a month
    autoRefreshToken: true,
    detectSessionInUrl: false, // no OAuth redirects in this build
    storageKey: STORAGE_KEY,
  },
});

/** True when a session was saved on this phone, even if it could not be refreshed. */
export function hasStoredSession() {
  try {
    return Boolean(localStorage.getItem(STORAGE_KEY));
  } catch {
    return false;
  }
}
