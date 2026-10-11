// ============================================================
//  set-worker-code — lets the owner change the worker's password.
//
//  The build guide lists "manage the worker's code" among the owner's
//  abilities (Section 4.3) but never says how, and it cannot be done from
//  the browser: changing another user's password is an admin operation that
//  needs the service_role key, which must never reach a phone.
//
//  So the owner's app sends its own access token here; this function
//  verifies the token really belongs to an active owner, and only then uses
//  the admin API. See DEVIATIONS.md #5.
//
//  [4.2] The six digits became a password: at least 8 characters with a
//  letter, a digit and a symbol (the client's decision, DEVIATIONS.md #18).
//  A changed password now also ends the old worker's sessions.
//
//  Deploy:  supabase functions deploy set-worker-code
// ============================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// A client with no stored session, used only to test whether a proposed
// worker password is the same as the owner's own.
const probe = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_ANON_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

/** Same rule as app/js/core/password.js — keep the two in step. */
function passwordProblem(value: string): string | null {
  if (value.length < 8) return 'too_short';
  if (value.length > 72) return 'too_long';            // bcrypt's limit
  if (!/\p{L}/u.test(value)) return 'needs_letter';
  if (!/\d/.test(value)) return 'needs_digit';
  if (!/[^\p{L}\d\s]/u.test(value)) return 'needs_symbol';
  if (/^(.)\1+$/u.test(value)) return 'too_simple';
  return null;
}

/** Arabic-Indic and Persian digits to Western, so both keyboards give one password. */
function normalise(value: string) {
  return value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .trim();
}

Deno.serve(async (req) => {
  // The dashboard calls this from the browser with an Authorization header,
  // which makes it a preflighted request.
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method !== 'POST') return json({ ok: false, code: 'method' }, 405);

  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json({ ok: false, code: 'not_signed_in' }, 401);

  // Who is actually calling. Never trust a role claimed in the body.
  const { data: caller, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !caller?.user) return json({ ok: false, code: 'not_signed_in' }, 401);

  const { data: profile } = await admin
    .from('profiles')
    .select('role, active')
    .eq('id', caller.user.id)
    .maybeSingle();

  if (profile?.role !== 'owner' || !profile.active) {
    return json({ ok: false, code: 'forbidden' }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const password = normalise(String(body?.new_code ?? ''));
  const problem = passwordProblem(password);
  if (problem) return json({ ok: false, code: 'weak_password', reason: problem }, 400);

  // [4.2] The worker must never end up holding the owner's password.
  if (caller.user.email) {
    const { data: same } = await probe.auth.signInWithPassword({
      email: caller.user.email, password,
    });
    if (same?.session) {
      await probe.auth.signOut().catch(() => {});
      return json({ ok: false, code: 'same_as_owner' }, 400);
    }
  }

  const { data: workerId, error: lookupError } = await admin.rpc('worker_user_id');
  if (lookupError || !workerId) return json({ ok: false, code: 'no_worker' }, 404);

  const { error: updateError } = await admin.auth.admin.updateUserById(workerId, { password });
  if (updateError) return json({ ok: false, code: 'server_error' }, 500);

  // [4.2] A new password is usually a new worker, or a leaked one. Either way
  // the phone that was signed in must not stay signed in.
  const { error: endError } = await admin.rpc('end_user_sessions', { p_user: workerId });
  if (endError) console.error('set-worker-code: end_user_sessions failed', endError.message);

  // The change is an event worth being able to date later.
  const { error: auditError } = await admin.from('audit_log').insert({
    actor: caller.user.id,
    action: 'worker_code_changed',
  });
  if (auditError) console.error('set-worker-code: audit insert failed', auditError.message);

  return json({ ok: true, sessions_ended: !endError });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
    },
  });
}
