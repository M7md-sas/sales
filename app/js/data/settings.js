/**
 * The settings table, plus the one thing settings cannot do from the browser:
 * change the worker's sign-in code.
 */
import { supabase } from '../core/supabase.js';
import { attempt } from '../core/errors.js';
import { CONFIG } from '../config.js';
import { passwordProblem, normalisePassword } from '../core/password.js';

const DEFAULTS = {
  monthly_target: '3000',   // placeholder from the schema — open point 6
  shop_name: 'المحل',
  currency: 'SAR',
  timezone: 'Asia/Riyadh',
};

let cached = null;

export async function loadSettings({ force = false } = {}) {
  if (cached && !force) return cached;
  const result = await attempt(supabase.from('settings').select('key, value'));
  const rows = result.ok ? result.data ?? [] : [];
  cached = { ...DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
  return cached;
}

export async function saveSetting(key, value) {
  const result = await attempt(
    supabase.from('settings').upsert({ key, value: String(value) }, { onConflict: 'key' })
  );
  if (result.ok && cached) cached[key] = String(value);
  return result;
}

export function monthlyTarget(settings) {
  const n = Number(settings?.monthly_target);
  return Number.isFinite(n) && n > 0 ? n : Number(DEFAULTS.monthly_target);
}

/**
 * Change the worker's password.
 *
 * This cannot be done with the anon key: updating another user's password is
 * an admin operation and needs the service_role key, which must never reach a
 * phone. It therefore goes through the set-worker-code Edge Function, which
 * re-checks that the caller really is the owner before acting.
 *
 * See DEVIATIONS.md — the build guide asks for this feature in Section 4.3
 * but does not say how it is meant to work. [4.2] It is a password now, not
 * six digits (DEVIATIONS.md #18), and the old worker's sessions end with it.
 */
export async function setWorkerCode(password) {
  if (passwordProblem(password)) return { ok: false, code: 'weak_password' };

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ok: false, code: 'not_signed_in' };

  try {
    const response = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/set-worker-code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: CONFIG.SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ new_code: normalisePassword(password) }),
    });
    const body = await response.json().catch(() => ({}));
    return response.ok && body.ok ? { ok: true } : { ok: false, code: body.code || 'server_error' };
  } catch {
    return { ok: false, code: 'offline' };
  }
}

/** [4.2] Photo storage used against the free tier's 1 GB. */
export async function storageUsage() {
  const result = await attempt(supabase.rpc('storage_usage'));
  return result.ok ? { bytes: Number(result.bytes) || 0, files: Number(result.files) || 0 } : null;
}
