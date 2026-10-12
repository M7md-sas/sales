/**
 * [4.3] The owner sends today's page himself — the day the worker is away or
 * cannot photograph the notebook (DEVIATIONS.md #28).
 *
 * Today only, by design: the date is fixed to the business day and is not
 * editable here. Older days already have their own way in (bulk import). The
 * photo can come from the camera or the gallery, and goes through the same
 * reading step and review queue as the worker's.
 */
import { el, $, busy } from '../../core/dom.js';
import { T } from '../../core/strings.js';
import { longDate, todayRiyadh } from '../../core/format.js';
import { CONFIG } from '../../config.js';
import { compressImage } from '../../worker/capture.js';
import { uploadPhoto, backfillPath } from '../../data/storage.js';
import { importDay } from '../../data/imports.js';
import { getDay } from '../../data/entries.js';
import { toast } from '../../ui/toast.js';
import { messageFor } from '../../core/errors.js';
import { go } from '../router.js';

export const title = T.captureToday;
export const showBack = true;

let photo = null;
let previewUrl = null;

export async function render(root) {
  photo = null;
  const today = todayRiyadh();
  const existing = await getDay(today);

  root.innerHTML = '';
  root.append(el('div', { class: 'stack-lg' }, [
    el('div', { class: 'card stack' }, [
      el('div', { class: 'card__title', text: longDate(today) }),
      el('p', { class: 'small muted', text: T.captureTodayHint }),
      existing ? el('p', {
        class: `confidence ${existing.status === 'approved' ? 'confidence--ok' : 'confidence--low'}`,
        text: existing.status === 'approved' ? T.captureTodayLocked : T.captureTodayReplaces,
      }) : null,
    ]),
    existing?.status === 'approved' ? null : pickers(),
    el('div', { id: 'capture-preview' }),
  ]));

  return () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    photo = null;
  };
}

function pickers() {
  // capture="environment" opens the rear camera; without it the phone offers
  // its gallery. Two inputs, because one cannot do both on iPhone.
  const camera = el('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true,
                               onchange: onPicked });
  const gallery = el('input', { type: 'file', accept: 'image/*', hidden: true, onchange: onPicked });

  return el('div', { class: 'stack', id: 'capture-pickers' }, [
    el('button', { class: 'btn btn--primary btn--lg btn--block', type: 'button',
                   text: T.captureCamera, onclick: () => camera.click() }),
    el('button', { class: 'btn btn--ghost btn--block', type: 'button',
                   text: T.captureGallery, onclick: () => gallery.click() }),
    camera, gallery,
  ]);
}

async function onPicked(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;

  try {
    photo = await compressImage(file);
  } catch {
    toast(T.compressFailed, 'error');
    return;
  }
  if (photo.size > CONFIG.PHOTO.MAX_BYTES) {
    photo = null;
    toast(T.photoTooLarge, 'error');
    return;
  }

  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(photo);

  const box = $('#capture-preview');
  box.innerHTML = '';
  box.append(el('div', { class: 'stack' }, [
    el('img', { src: previewUrl, alt: T.captureToday,
                style: 'width:100%;border-radius:var(--r-md);border:1px solid var(--line)' }),
    el('button', { class: 'btn btn--approve btn--lg btn--block', id: 'btn-capture-send',
                   type: 'button', text: T.send, onclick: send }),
    el('button', { class: 'btn btn--ghost btn--block', type: 'button', text: T.retake,
                   onclick: () => { photo = null; box.innerHTML = ''; } }),
  ]));
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function send() {
  if (!photo) return;
  const today = todayRiyadh();
  const restore = busy($('#btn-capture-send'), T.sending);

  const path = backfillPath(today);
  const upload = await uploadPhoto(photo, path);
  if (!upload.ok) {
    restore();
    toast(messageFor('upload_failed'), 'error');
    return;
  }

  const result = await importDay({ entryDate: today, path, notes: T.captureTodayNote });
  restore();
  if (!result.ok) {
    toast(messageFor(result.code), 'error');
    return;
  }

  toast(T.captureTodaySent, 'ok');
  go('/review');
}
