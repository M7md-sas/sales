/**
 * Sign-in and the role guard.
 *
 * There are exactly two accounts, and each app knows which one it is for.
 * The user types a password; the app supplies the matching e-mail address.
 * Those addresses end in .local and can never receive mail — they exist so
 * that authentication is Supabase's tested implementation rather than a
 * home-made one (build guide, Section 5.3).
 *
 * [4.2] Six digits became a password of 8+ characters with a letter, a digit
 * and a symbol — the client's decision (DEVIATIONS.md #18).
 */
import { supabase } from './supabase.js';
import { CONFIG } from '../config.js';
import { isOffline } from './errors.js';
import { normalisePassword } from './password.js';

const EMAIL_FOR = {
  owner: CONFIG.OWNER_EMAIL,
  worker: CONFIG.WORKER_EMAIL,
};

/**
 * [4.2] Says WHY a sign-in failed. Every failure used to read "wrong code",
 * so a weak signal sent the worker to the owner to reset a password that was
 * never wrong (DEVIATIONS.md #20).
 *
 * @param {'owner'|'worker'} role
 * @returns {Promise<{ok: boolean, reason?: 'wrong'|'offline'|'rate_limited'|'server'}>}
 */
export async function signIn(role, password) {
  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: EMAIL_FOR[role],
      password: normalisePassword(password),
    });
    if (!error) return { ok: true };
    return { ok: false, reason: classify(error) };
  } catch (error) {
    return { ok: false, reason: isOffline(error) ? 'offline' : 'server' };
  }
}

function classify(error) {
  const status = Number(error?.status);
  const code = String(error?.code || '');
  if (code === 'invalid_credentials' || status === 400) return 'wrong';
  if (status === 429 || code.includes('rate_limit')) return 'rate_limited';
  if (isOffline(error) || status === 0 || error?.name === 'AuthRetryableFetchError') return 'offline';
  return 'server';
}

export async function signOut() {
  try {
    await supabase.auth.signOut();
  } catch {
    // Offline: the local session is still cleared by the library.
  }
}

export async function getSession() {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session ?? null;
  } catch {
    return null;
  }
}

/**
 * The signed-in user's profile row. Under RLS a user can read only their own,
 * which is exactly what we need to tell owner from worker.
 *
 * @returns {Promise<{profile: object|null, unreachable: boolean}>}
 */
export async function getProfile() {
  const session = await getSession();
  if (!session) return { profile: null, unreachable: false };
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name, role, active')
      .eq('id', session.user.id)
      .maybeSingle();
    if (error) return { profile: null, unreachable: true };
    return { profile: data ?? null, unreachable: false };
  } catch {
    return { profile: null, unreachable: true };
  }
}

/**
 * Guard for the owner dashboard.
 *
 * A worker who types the owner app's URL is not a security hole — RLS gives
 * him nothing either way — but he should land on the sign-in screen rather
 * than an empty dashboard that looks broken.
 *
 * [4.2] A network failure is no longer treated as "not the owner": it used to
 * sign the owner out on every bad connection, and then tell him his code was
 * wrong (DEVIATIONS.md #20).
 *
 * @returns {Promise<'ok'|'denied'|'unreachable'>}
 */
export async function requireOwner() {
  const { profile, unreachable } = await getProfile();
  if (unreachable) return 'unreachable';
  if (!profile || profile.role !== 'owner' || !profile.active) {
    await signOut();
    return 'denied';
  }
  return 'ok';
}

/** Fires on sign-in, sign-out and token refresh. */
export function onAuthChange(handler) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => handler(event, session));
  return () => data.subscription.unsubscribe();
}

/** [4.2] The owner changes his own password from Settings. */
export async function changeOwnPassword(password) {
  try {
    const { error } = await supabase.auth.updateUser({ password: normalisePassword(password) });
    if (!error) return { ok: true };
    if (String(error.code || '').includes('weak_password')) return { ok: false, code: 'weak_password' };
    if (String(error.code || '') === 'same_password') return { ok: false, code: 'same_password' };
    return { ok: false, code: isOffline(error) ? 'offline' : 'server_error' };
  } catch (error) {
    return { ok: false, code: isOffline(error) ? 'offline' : 'server_error' };
  }
}
