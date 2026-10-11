/**
 * Bulk import — the screen that decides whether a year of notebooks actually
 * makes it into the archive.
 *
 * "A form built for one day at a time will not survive that volume; he will
 *  give up partway and the archive will have a hole in it." (guide 4.4)
 *
 * So: many files at once, a date guessed for each, one button, and live
 * progress. Each photo travels the same extraction pipeline as a daily
 * submission, so reviewing them is the ordinary review queue rather than a
 * second one built for the occasion.
 *
 * [4.2] Fixes from the audit (DEVIATIONS.md #22):
 *   - two staged photos with the same date block the import (the second used
 *     to overwrite the first in silence);
 *   - an approved day is shown as skipped, never overwritten;
 *   - each row shows its real outcome, and failures can be retried alone;
 *   - the import stops at the free tier's daily reading cap;
 *   - the screen is kept awake, and photos are compressed one at a time.
 */
import { el, $, busy } from '../../core/dom.js';
import { T } from '../../core/strings.js';
import { shortDate, todayRiyadh } from '../../core/format.js';
import { CONFIG } from '../../config.js';
import { compressImage } from '../../worker/capture.js';
import { importBatch, existingDates } from '../../data/imports.js';
import { guessDate } from '../photo-date.js';
import { toast } from '../../ui/toast.js';
import { go } from '../router.js';

export const title = T.bulkImport;
export const showBack = true;

/** Files staged for this import: { id, file, date, source, url, state, code }. */
let staged = [];
let controller = null;
let running = false;
let wakeLock = null;

export async function render(root) {
  staged = [];
  running = false;
  controller = new AbortController();

  root.innerHTML = '';
  root.append(el('div', { class: 'stack-lg' }, [
    dropzone(),
    el('div', { id: 'import-status' }),
    el('div', { id: 'import-list', class: 'import-list' }),
    actions(),
  ]));

  return () => {
    controller?.abort();
    releaseWakeLock();
    staged.forEach((item) => URL.revokeObjectURL(item.url));
    staged = [];
  };
}

function dropzone() {
  const input = el('input', {
    type: 'file', accept: 'image/*', multiple: true, hidden: true, id: 'import-input',
    onchange: (e) => { addFiles(e.target.files); e.target.value = ''; },
  });

  const zone = el('div', { class: 'dropzone' }, [
    el('div', { class: 'dropzone__icon', html: uploadIcon() }),
    el('p', { style: 'font-weight:600;color:var(--ink)', text: T.bulkPickHint }),
    el('button', {
      class: 'btn btn--primary', type: 'button', text: T.bulkPick,
      style: 'margin-top:var(--s-4)',
      onclick: () => input.click(),
    }),
    input,
  ]);

  ['dragenter', 'dragover'].forEach((type) =>
    zone.addEventListener(type, (e) => { e.preventDefault(); zone.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((type) =>
    zone.addEventListener(type, () => zone.classList.remove('is-over')));

  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    addFiles(e.dataTransfer.files);
  });

  return zone;
}

async function addFiles(fileList) {
  if (running) return;
  const images = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
  if (!images.length) return;

  const status = $('#import-status');
  status.innerHTML = `<p class="small muted">${T.loading}</p>`;
  const button = $('#btn-import');
  if (button) button.dataset.mode = 'import';

  for (const file of images) {
    const { date, source } = await guessDate(file);
    staged.push({
      id: `${file.name}-${file.size}-${file.lastModified}-${staged.length}`,
      file,
      date: date && date <= todayRiyadh() ? date : '',
      source,
      url: URL.createObjectURL(file),
      state: 'ready',
      code: null,
    });
  }

  await paint();
}

/** Dates used by more than one staged photo. */
function batchDuplicates() {
  const seen = new Map();
  staged.filter((i) => i.date && i.state !== 'done')
    .forEach((i) => seen.set(i.date, (seen.get(i.date) || 0) + 1));
  return new Set([...seen].filter(([, n]) => n > 1).map(([d]) => d));
}

let clashes = new Map();

async function paint({ refetch = true } = {}) {
  const list = $('#import-list');
  const status = $('#import-status');
  if (!list) return;

  if (refetch) {
    try {
      clashes = await existingDates(staged.filter((i) => i.date).map((i) => i.date));
    } catch {
      // Unknown is not "no clashes": say so, and keep the button disabled.
      clashes = null;
    }
  }
  const dupes = batchDuplicates();

  list.innerHTML = '';
  staged.forEach((item) => list.append(row(item, dupes)));

  const pending = staged.filter((i) => i.state !== 'done');
  const needDates = pending.filter((i) => !i.date).length;
  const dupeCount = pending.filter((i) => dupes.has(i.date)).length;

  let line = '';
  if (staged.length) {
    line = `${T.bulkProgress(staged.length - needDates, staged.length)} — ` +
      (needDates ? T.bulkNeedsDate : dupeCount ? T.bulkDuplicateBatch : T.bulkAssignDates);
    if (clashes === null) line += ` — <span style="color:var(--danger)">${T.loadFailed}</span>`;
  }
  status.innerHTML = line ? `<p class="small">${line}</p>` : '';

  const start = $('#btn-import');
  if (start && !running && start.dataset.mode !== 'review') {
    const anything = pending.some((i) => i.state === 'ready' || i.state === 'failed');
    start.disabled = !anything || needDates > 0 || dupeCount > 0 || clashes === null;
    start.textContent = staged.some((i) => i.state === 'failed') ? T.bulkRetryFailed : T.bulkStart;
  }
}

function row(item, dupes) {
  const approvedClash = clashes?.get(item.date) === 'approved';
  const stateClass = {
    ready: item.date && !dupes.has(item.date) ? '' : ' import-item--needs-date',
    done: ' import-item--done',
    failed: ' import-item--failed',
    skipped: ' import-item--done',
  }[item.state] ?? '';

  const dateInput = el('input', {
    class: 'input', type: 'date', value: item.date, max: todayRiyadh(),
    disabled: item.state === 'done' || running,
    onchange: async (e) => {
      item.date = e.target.value;
      item.source = 'manual';
      if (item.state === 'skipped') item.state = 'ready';
      await paint();
    },
  });

  const badge = {
    done: ['approved', T.saved],
    failed: ['error', T.bulkFailed],
    skipped: ['review', T.bulkLocked],
  }[item.state];

  return el('div', { class: `import-item${stateClass}` }, [
    // [4.2] Lazy: hundreds of full-size originals decoded at once could run
    // an iPhone out of memory and reload the page mid-import.
    el('img', { class: 'thumb', src: item.url, alt: '', loading: 'lazy', decoding: 'async' }),
    el('div', { class: 'grow', style: 'min-width:120px' }, [
      el('div', { class: 'small truncate', style: 'font-weight:600', text: item.file.name }),
      el('div', { class: 'xs muted', text: hint(item, dupes, approvedClash) }),
    ]),
    el('div', { class: 'import-item__date' }, [dateInput]),
    item.state === 'ready'
      ? el('button', {
          class: 'btn btn--quiet small', type: 'button', text: '✕',
          'aria-label': T.bulkRemove, disabled: running,
          onclick: async () => {
            URL.revokeObjectURL(item.url);
            staged = staged.filter((s) => s.id !== item.id);
            await paint();
          },
        })
      : el('span', { class: `badge badge--${badge[0]}`, text: badge[1] }),
  ]);
}

function hint(item, dupes, approvedClash) {
  if (item.state === 'failed') return `${T.bulkFailed}${item.code ? ` — ${item.code}` : ''}`;
  if (item.state === 'skipped') return T.bulkLocked;
  if (item.date && dupes.has(item.date)) return T.bulkDuplicateBatch;
  if (item.date && approvedClash) return T.bulkDuplicateApproved;
  if (item.date && clashes?.has(item.date)) return T.bulkDuplicate;
  if (!item.date) return T.bulkNeedsDate;
  // [4.2] A file's save time is often the day the page was photographed,
  // not the day it records. Say so instead of "read from the file".
  if (item.source === 'file') return T.bulkFileDate;
  if (item.source === 'exif' || item.source === 'filename') return T.bulkAutoDate;
  return shortDate(item.date);
}

function actions() {
  return el('div', { class: 'stack' }, [
    el('p', { class: 'xs muted', text: T.bulkKeepScreen }),
    el('div', { class: 'progress hidden', id: 'import-progress' }, [
      el('div', { class: 'progress__bar', style: 'width:0%' }),
    ]),
    el('button', {
      class: 'btn btn--primary btn--lg btn--block', id: 'btn-import', type: 'button',
      text: T.bulkStart, disabled: true,
      onclick: onPrimary,
    }),
  ]);
}

/** One handler for the one button: start/retry, or go to the review queue. */
function onPrimary() {
  if (running) return;
  const button = $('#btn-import');
  if (button.dataset.mode === 'review') {
    go('/review');
    return;
  }
  run();
}

async function run() {
  const button = $('#btn-import');
  const bar = $('#import-progress');

  // Approved days are final — they are skipped, not imported over.
  staged.forEach((s) => {
    if ((s.state === 'ready' || s.state === 'failed') && clashes?.get(s.date) === 'approved') {
      s.state = 'skipped';
    }
  });

  let todo = staged.filter((s) => s.state === 'ready' || s.state === 'failed');
  const cap = CONFIG.BULK_IMPORT.DAILY_CAP;
  const capped = todo.length > cap;
  if (capped) todo = todo.slice(0, cap);
  if (!todo.length) { await paint({ refetch: false }); return; }

  running = true;
  const restore = busy(button, T.bulkSending);
  bar.classList.remove('hidden');
  bar.firstElementChild.classList.remove('progress__bar--ok');
  await keepAwake();

  const items = todo.map((s) => ({ id: s.id, date: s.date, file: s.file }));

  const { ok, failed } = await importBatch(items, (progress) => {
    const percent = (progress.done / progress.total) * 100;
    bar.firstElementChild.style.width = `${percent.toFixed(1)}%`;

    if (progress.outcome) {
      const item = staged.find((s) => s.id === progress.outcome.id);
      if (item) {
        if (progress.outcome.ok) item.state = 'done';
        else if (progress.outcome.code === 'locked') item.state = 'skipped';
        else { item.state = 'failed'; item.code = progress.outcome.code; }
      }
      paint({ refetch: false });
    }

    $('#import-status').innerHTML =
      `<p class="small">${T.bulkProgress(progress.done, progress.total)}` +
      (progress.waiting ? ` — ${T.bulkRateNote}` : '') +
      (progress.failed ? ` — <span style="color:var(--danger)">${progress.failed} ${T.bulkFailed}</span>` : '') +
      '</p>';
  }, { signal: controller.signal, prepare: compressImage });

  running = false;
  releaseWakeLock();
  restore();
  bar.firstElementChild.classList.add('progress__bar--ok');
  await paint();

  toast(`${T.bulkDone} — ${ok}/${items.length}`, failed ? 'error' : 'ok');

  const left = staged.filter((s) => s.state === 'ready' || s.state === 'failed').length;
  const lines = [];
  if (failed) lines.push(`<span style="color:var(--danger)">${failed} ${T.bulkFailed}</span>`);
  if (capped) lines.push(T.bulkDailyCap(cap));
  lines.push(T.bulkDoneHint);
  $('#import-status').innerHTML =
    `<div class="confidence confidence--${failed || capped ? 'low' : 'ok'}">` +
    `<span class="grow">${lines.join(' — ')}</span></div>`;

  // Failures (or photos past today's cap) left: the button retries them.
  // Nothing left: it leads to the review queue.
  if (left) {
    button.dataset.mode = 'import';
  } else {
    button.dataset.mode = 'review';
    button.textContent = T.reviewQueue;
    button.disabled = false;
  }
}

/** [4.2] Keep the phone from locking during the 40-second pauses. */
async function keepAwake() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch { wakeLock = null; }
}

function releaseWakeLock() {
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
}

function uploadIcon() {
  return `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;
}
