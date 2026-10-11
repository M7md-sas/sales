/**
 * Settings — monthly target, shop name, the worker's password, the owner's
 * own password, and how full the photo storage is.
 *
 * The target is the only one left in the product (the daily one was removed),
 * so it is worth being explicit that changing it changes what the monthly
 * report is measured against, and nothing else.
 */
import { el, $, busy } from '../../core/dom.js';
import { T } from '../../core/strings.js';
import { saveSetting, setWorkerCode, loadSettings, storageUsage } from '../../data/settings.js';
import { changeOwnPassword } from '../../core/auth.js';
import { passwordProblem } from '../../core/password.js';
import { messageFor } from '../../core/errors.js';
import { toast } from '../../ui/toast.js';

export const title = T.settings;
export const showBack = true;

export async function render(root, _params, ctx) {
  const settings = ctx.settings ?? await loadSettings();

  root.innerHTML = '';
  root.append(el('div', { class: 'stack-lg' }, [
    shopCard(settings, ctx),
    targetCard(settings, ctx),
    workerCodeCard(),
    ownerPasswordCard(),
    storageCard(),
  ]));
}

function shopCard(settings, ctx) {
  return el('form', { class: 'card stack', onsubmit: (e) => saveShop(e, ctx) }, [
    el('label', { class: 'field' }, [
      el('span', { class: 'field__label', text: T.shopName }),
      el('input', { class: 'input', id: 'set-shop', value: settings.shop_name || '',
                    maxlength: '60', required: true }),
    ]),
    el('button', { class: 'btn btn--primary', type: 'submit', text: T.save }),
  ]);
}

async function saveShop(event, ctx) {
  event.preventDefault();
  const button = event.submitter || event.target.querySelector('button');
  const restore = busy(button, T.loading);
  const result = await saveSetting('shop_name', $('#set-shop').value.trim());
  restore();
  if (result.ok) ctx.settings = await loadSettings({ force: true });
  toast(result.ok ? T.settingsSaved : T.unknownError, result.ok ? 'ok' : 'error');
}

function targetCard(settings, ctx) {
  return el('form', { class: 'card stack', onsubmit: (e) => saveTarget(e, ctx) }, [
    el('label', { class: 'field' }, [
      el('span', { class: 'field__label', text: T.targetLabel }),
      el('input', {
        class: 'input input--amount', id: 'set-target', type: 'number',
        inputmode: 'numeric', min: '0', step: '50',
        value: settings.monthly_target || '3000', required: true,
      }),
      // Open point 6 in the guide: 3000 is a placeholder extrapolated from a
      // single sample day. It is meant to be replaced by a real figure.
      el('span', { class: 'field__hint',
                   text: 'يُستخدم في شريط التقدم في التقرير الشهري فقط' }),
    ]),
    el('button', { class: 'btn btn--primary', type: 'submit', text: T.save }),
  ]);
}

async function saveTarget(event, ctx) {
  event.preventDefault();
  const button = event.submitter || event.target.querySelector('button');
  const restore = busy(button, T.loading);
  const result = await saveSetting('monthly_target', $('#set-target').value);
  restore();
  if (result.ok) ctx.settings = await loadSettings({ force: true });
  toast(result.ok ? T.settingsSaved : T.unknownError, result.ok ? 'ok' : 'error');
}

/** A password field with a show/hide switch. */
function passwordInput(id, autocomplete) {
  const input = el('input', {
    class: 'input', id, type: 'password', autocomplete, autocapitalize: 'off',
    autocorrect: 'off', spellcheck: 'false', required: true, style: 'direction:ltr',
  });
  const toggle = el('button', {
    class: 'password-toggle', type: 'button', text: T.showPassword,
    onclick: () => {
      const hidden = input.type === 'password';
      input.type = hidden ? 'text' : 'password';
      toggle.textContent = hidden ? T.hidePassword : T.showPassword;
    },
  });
  return el('div', { class: 'password-wrap' }, [input, toggle]);
}

/**
 * Changing another user's password is an admin operation, so this goes
 * through the set-worker-code Edge Function rather than the browser — the
 * service_role key must never reach a phone. See DEVIATIONS.md.
 */
function workerCodeCard() {
  return el('form', { class: 'card stack', onsubmit: saveCode, novalidate: true }, [
    el('label', { class: 'field' }, [
      el('span', { class: 'field__label', text: T.workerCode }),
      passwordInput('set-code', 'new-password'),
      el('span', { class: 'field__hint', text: `${T.passwordRuleShort} — ${T.workerCodeHint}` }),
    ]),
    el('button', { class: 'btn btn--ghost', type: 'submit', text: T.save }),
  ]);
}

async function saveCode(event) {
  event.preventDefault();
  const input = $('#set-code');
  const password = input.value;

  if (passwordProblem(password)) {
    toast(T.workerCodeInvalid, 'error');
    return;
  }

  const button = event.submitter || event.target.querySelector('button[type=submit]');
  const restore = busy(button, T.loading);
  const result = await setWorkerCode(password);
  restore();

  if (result.ok) {
    input.value = '';
    toast(T.workerCodeChanged, 'ok');
  } else {
    toast(messageFor(result.code), 'error');
  }
}

/** [4.2] The owner's own password, with the same rule as the worker's. */
function ownerPasswordCard() {
  return el('form', { class: 'card stack', onsubmit: saveOwnPassword, novalidate: true }, [
    el('div', { class: 'card__title', text: T.ownerPassword }),
    el('label', { class: 'field' }, [
      el('span', { class: 'field__label', text: T.ownerPasswordNew }),
      passwordInput('set-own', 'new-password'),
      el('span', { class: 'field__hint', text: T.passwordRuleShort }),
    ]),
    el('label', { class: 'field' }, [
      el('span', { class: 'field__label', text: T.ownerPasswordConfirm }),
      passwordInput('set-own-2', 'new-password'),
    ]),
    el('button', { class: 'btn btn--ghost', type: 'submit', text: T.save }),
  ]);
}

async function saveOwnPassword(event) {
  event.preventDefault();
  const first = $('#set-own');
  const second = $('#set-own-2');

  if (passwordProblem(first.value)) {
    toast(T.passwordRule, 'error');
    return;
  }
  if (first.value !== second.value) {
    toast(T.passwordMismatch, 'error');
    return;
  }

  const button = event.submitter || event.target.querySelector('button[type=submit]');
  const restore = busy(button, T.loading);
  const result = await changeOwnPassword(first.value);
  restore();

  if (result.ok) {
    first.value = '';
    second.value = '';
    toast(T.ownerPasswordChanged, 'ok');
  } else {
    toast(messageFor(result.code), 'error');
  }
}

/** [4.2] How full the free tier's 1 GB of photo storage is. */
function storageCard() {
  const value = el('div', { class: 'small', text: T.loading });
  storageUsage().then((usage) => {
    if (!usage) { value.textContent = T.loadFailed; return; }
    const mb = (usage.bytes / (1024 * 1024)).toFixed(1);
    value.textContent = T.storageOf(mb, usage.files);
    if (usage.bytes > 0.8 * 1024 * 1024 * 1024) value.style.color = 'var(--danger)';
  });
  return el('div', { class: 'card stack' }, [
    el('div', { class: 'card__title', text: T.storageUsage }),
    value,
  ]);
}
