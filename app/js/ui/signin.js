/**
 * The sign-in screen, shared by both apps.
 *
 * [4.2] Replaces the six-digit keypad: the client chose a password of at
 * least 8 characters with a letter, a digit and a symbol (DEVIATIONS.md #18).
 * The worker sees this roughly once a month — the session persists — so it is
 * built for someone who has forgotten it exists: one big field, a show/hide
 * switch, one button, and an error that says what actually went wrong.
 *
 * Unlike the keypad, nothing here listens on `document`, so nothing keeps
 * reacting to keys after sign-in (the keypad re-ran sign-in on every digit the
 * owner typed into a review card — DEVIATIONS.md #20).
 */
import { el } from '../core/dom.js';
import { T } from '../core/strings.js';

const REASON_TEXT = {
  wrong: T.signInWrong,
  offline: T.signInOffline,
  rate_limited: T.signInRateLimited,
  server: T.signInServer,
};

/**
 * @param {object} opts
 * @param {HTMLElement} opts.mount
 * @param {string} opts.shopName
 * @param {(password: string) => Promise<{ok: boolean, reason?: string, message?: string}>} opts.onSubmit
 * @param {string} [opts.notice]  shown above the field, e.g. "session expired"
 */
export function mountSignIn({ mount, shopName, onSubmit, notice = '' }) {
  mount.innerHTML = '';
  mount.className = 'signin-screen';

  const input = el('input', {
    class: 'input', type: 'password', id: 'signin-password',
    autocomplete: 'current-password', autocapitalize: 'off', autocorrect: 'off',
    spellcheck: 'false', enterkeyhint: 'go', required: true,
    'aria-label': T.signInPrompt,
  });

  const toggle = el('button', {
    class: 'password-toggle', type: 'button', text: T.showPassword,
    onclick: () => {
      const hidden = input.type === 'password';
      input.type = hidden ? 'text' : 'password';
      toggle.textContent = hidden ? T.hidePassword : T.showPassword;
      input.focus();
    },
  });

  const wrap = el('div', { class: 'password-wrap' }, [input, toggle]);
  const error = el('p', { class: `signin-error${notice ? ' is-info' : ''}`, role: 'alert', text: notice });
  const button = el('button', {
    class: 'btn btn--primary btn--lg btn--block', type: 'submit', text: T.signInButton,
  });

  const form = el('form', { class: 'signin-form', novalidate: true }, [wrap, error, button]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    if (!input.value) {
      input.focus();
      return;
    }

    button.disabled = true;
    wrap.classList.remove('is-error');
    error.className = 'signin-error is-info';
    error.textContent = T.signInBusy;

    const result = await onSubmit(input.value);
    if (result?.ok) {
      input.value = '';
      return;
    }

    button.disabled = false;
    error.className = 'signin-error';
    error.textContent = result?.message || REASON_TEXT[result?.reason] || T.signInWrong;
    if (result?.reason === 'wrong') {
      input.value = '';
      // Restart the shake animation.
      void wrap.offsetWidth;
      wrap.classList.add('is-error');
      if (navigator.vibrate) navigator.vibrate(80);
    }
    input.focus();
  });

  mount.append(
    el('div', { class: 'signin-head' }, [
      el('div', { class: 'signin-head__shop', text: shopName || T.shopFallback }),
      el('p', { class: 'signin-head__hint', text: T.signInPrompt }),
    ]),
    form,
  );

  setTimeout(() => input.focus(), 50);
}
