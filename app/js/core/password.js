/**
 * The password rule for both accounts — the client's decision in place of the
 * original six digits (DEVIATIONS.md #18): at least 8 characters, with a
 * letter, a digit and a symbol.
 *
 * The same rule is enforced server-side in
 * supabase/functions/set-worker-code/index.ts — keep the two in step.
 */

/** Arabic-Indic and Persian digits to Western, so both keyboards give one password. */
export function normaliseDigits(value) {
  return String(value ?? '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
}

/** The password as it is sent to Supabase. */
export function normalisePassword(value) {
  return normaliseDigits(value).trim();
}

/**
 * @returns {null | 'too_short' | 'too_long' | 'needs_letter' | 'needs_digit' | 'needs_symbol' | 'too_simple'}
 */
export function passwordProblem(raw) {
  const value = normalisePassword(raw);
  if (value.length < 8) return 'too_short';
  if (value.length > 72) return 'too_long';
  if (!/\p{L}/u.test(value)) return 'needs_letter';
  if (!/\d/.test(value)) return 'needs_digit';
  if (!/[^\p{L}\d\s]/u.test(value)) return 'needs_symbol';
  if (/^(.)\1+$/u.test(value)) return 'too_simple';
  return null;
}
