/**
 * Worker app — the whole of it.
 *
 * Five screens: sign in → capture → preview → sending → sent.
 * It sends a photograph and receives the word "saved". There is no screen
 * after "sent", no history, and no number anywhere in this file.
 *
 * Build guide: Sections 1.1, 3.1, 4.2, 9.4, 9.5.
 */
import { $, on, showScreen, show, setText } from '../core/dom.js';
import { T } from '../core/strings.js';
import { todayRiyadh, longDate, shortDate, weekdayName } from '../core/format.js';
import { messageFor, withTimeout } from '../core/errors.js';
import { signIn, signOut, getSession, onAuthChange } from '../core/auth.js';
import { hasStoredSession } from '../core/supabase.js';
import { submitPhoto } from '../data/submit.js';
import { CONFIG } from '../config.js';
import { compressImage } from './capture.js';
import { cameraSupported, startCamera, stopCamera, snap, toggleTorch } from './camera.js';
import {
  enqueue, flush, pendingCount, isFull, clear as clearQueue, droppedDays, clearDropped,
} from './queue.js';
import { mountSignIn } from '../ui/signin.js';
import { toast } from '../ui/toast.js';

/** The photo currently held between "captured" and "sent". Never persisted. */
let photo = null;
/**
 * The day shown on screen when the photo was taken. Used only if the photo
 * has to wait offline; a live send lets the server decide the day.
 */
let captureDate = todayRiyadh();

const els = {
  banner: $('#offline-banner'),
  bannerText: $('#offline-text'),
  bannerRetry: $('#offline-retry'),
  dropped: $('#dropped-notice'),
  droppedText: $('#dropped-text'),
  weekday: $('#capture-weekday'),
  date: $('#capture-date'),
  fileInput: $('#file-input'),
  previewImg: $('#preview-img'),
  video: $('#camera-video'),
  snap: $('#btn-snap'),
  torch: $('#btn-torch'),
  torchSpacer: $('#torch-spacer'),
};

/* ------------------------------------------------------------------ boot */

async function boot() {
  renderDate();
  wire();

  // [4.2] A session saved on this phone counts as signed in even when it
  // cannot be refreshed right now (no signal). The keypad used to appear in
  // every dead spot, and the worker was told his code was wrong.
  const session = await getSession();
  if (session || hasStoredSession()) enterApp();
  else showSignIn();

  // A photo parked during a dead spot goes out as soon as we are back.
  refreshBanner();
  refreshDropped();
  flushQueue();
}

/**
 * The worker signs in about once a month; the rest of the time the session
 * is already there and he never sees this screen.
 */
function showSignIn(notice = '') {
  mountSignIn({
    mount: $('#signin-mount'),
    // Not read from settings: the worker has no read policy on that table, so
    // the request would only ever fail. The shop name here is a label on a
    // sign-in screen, not data.
    shopName: T.appNameWorker,
    notice,
    onSubmit: async (password) => {
      const result = await signIn('worker', password);
      if (result.ok) {
        enterApp();
        flushQueue();
      }
      return result;
    },
  });
  showScreen('screen-signin');
}

function enterApp() {
  captureDate = todayRiyadh();
  renderDate();
  showScreen('screen-capture');
}

function renderDate() {
  const today = todayRiyadh();
  setText(els.weekday, weekdayName(today));
  setText(els.date, longDate(today).replace(`${weekdayName(today)} `, ''));
}

/* ----------------------------------------------------------------- wiring */

function wire() {
  on($('#btn-capture'), 'click', openCamera);
  on(els.fileInput, 'change', onFilePicked);
  // TEMP-GALLERY: testing only, remove before handover.
  on($('#btn-gallery'), 'click', () => $('#gallery-input').click());
  on($('#gallery-input'), 'change', onFilePicked);
  on(els.snap, 'click', onSnap);
  on($('#btn-camera-cancel'), 'click', closeCamera);
  on(els.torch, 'click', async () => {
    const lit = await toggleTorch();
    els.torch.setAttribute('aria-pressed', String(lit));
  });
  on($('#btn-retake'), 'click', retake);
  on($('#btn-send'), 'click', send);
  on($('#btn-again'), 'click', () => { discardPhoto(); enterApp(); });
  on($('#btn-signout'), 'click', onSignOut);
  on(els.bannerRetry, 'click', flushQueue);
  on($('#dropped-dismiss'), 'click', () => { clearDropped(); refreshDropped(); });

  on(window, 'online', flushQueue);
  on(window, 'offline', refreshBanner);
  // [4.2] Opening the app again is when a parked photo gets its next chance;
  // the 'online' event alone never fires if the app was closed meanwhile.
  on(document, 'visibilitychange', () => {
    // The camera is released whenever the app goes to the background.
    if (document.visibilityState === 'hidden') closeCamera();
    if (document.visibilityState === 'visible') {
      renderDate();
      flushQueue();
    }
  });

  // [4.2] The session ended under us (password changed by the owner, token
  // revoked). Back to sign-in — the queue stays, it is not his to lose.
  onAuthChange((event) => {
    if (event === 'SIGNED_OUT' && !signingOut) showSignIn(T.sessionExpired);
  });
}

/* ----------------------------------------------------------------- camera */

/**
 * The big button opens the camera inside the app: a live view and one
 * shutter. Where that is not possible (old browser, permission refused, page
 * not on HTTPS) it falls back to the phone's own camera through the file
 * input, as before.
 */
async function openCamera() {
  if (!cameraSupported()) {
    els.fileInput.click();
    return;
  }

  showScreen('screen-camera');
  els.snap.disabled = true;
  const result = await startCamera(els.video);

  if (!result.ok) {
    showScreen('screen-capture');
    toast(result.reason === 'denied' ? T.cameraDenied : T.cameraUnavailable, 'error');
    els.fileInput.click();
    return;
  }

  show(els.torch, result.torch);
  show(els.torchSpacer, !result.torch);
  els.torch.setAttribute('aria-pressed', 'false');
  els.snap.disabled = false;
}

function closeCamera() {
  stopCamera();
  els.video.srcObject = null;
  if ($('#screen-camera').classList.contains('is-active')) showScreen('screen-capture');
}

async function onSnap() {
  els.snap.disabled = true;
  let frame;
  try {
    frame = await snap(els.video);
  } catch {
    els.snap.disabled = false;
    toast(T.compressFailed, 'error');
    return;
  }
  stopCamera();
  els.video.srcObject = null;
  await usePhoto(frame);
}

async function onFilePicked(event) {
  const file = event.target.files?.[0];
  event.target.value = '';           // so picking the same file twice still fires
  if (!file) return;
  await usePhoto(file);
}

/** A photo from either source: compress it, then show the preview. */
async function usePhoto(file) {
  // The day shown on screen when the photo is taken — kept for the queue.
  captureDate = todayRiyadh();

  try {
    photo = await compressImage(file);
  } catch {
    showScreen('screen-capture');
    toast(T.compressFailed, 'error');
    return;
  }

  if (photo.size > CONFIG.PHOTO.MAX_BYTES) {
    photo = null;
    toast(T.photoTooLarge, 'error');
    return;
  }

  els.previewImg.src = URL.createObjectURL(photo);
  showScreen('screen-preview');
}

function retake() {
  discardPhoto();
  openCamera();
}

function discardPhoto() {
  if (els.previewImg.src.startsWith('blob:')) URL.revokeObjectURL(els.previewImg.src);
  els.previewImg.removeAttribute('src');
  photo = null;
}

/* ------------------------------------------------------------------- send */

async function send() {
  if (!photo) {
    toast(T.photoRequired, 'error');
    return;
  }

  showScreen('screen-sending');

  // Offline: park it and tell him plainly it has not gone yet. Showing the
  // success screen for something that did not send is the one failure this
  // app must never have — that day would vanish and nobody would know.
  if (!navigator.onLine) {
    await park();
    return;
  }

  // [4.2] A live send: the server picks the day. A send that hangs on a weak
  // signal is parked after SEND_TIMEOUT_MS instead of holding him on
  // "sending… don't close the app" for minutes (DEVIATIONS.md #20).
  let result;
  try {
    result = await withTimeout(submitPhoto({ date: null, blob: photo }), CONFIG.SEND_TIMEOUT_MS);
  } catch {
    result = { ok: false, code: 'timeout' };
  }

  if (result.ok) {
    discardPhoto();
    showScreen('screen-sent');
    refreshBanner();
    return;
  }

  if (result.code === 'not_signed_in') {
    // Keep the photo in the queue, then ask for the password.
    await park({ quiet: true });
    showSignIn(T.sessionExpired);
    return;
  }

  // [4.2] Only a definite refusal from the server goes back to the preview.
  // Everything else — no signal, a weak one, a failed upload, a server
  // hiccup — parks the photo. On a flaky connection that reports "online"
  // the photo used to be lost if he gave up and closed the app.
  const refused = ['locked', 'bad_date', 'photo_required', 'too_many', 'forbidden',
                   'photo_too_large'].includes(result.code);
  if (!refused) {
    await park();
    return;
  }

  showScreen('screen-preview');
  toast(messageFor(result.code), 'error');
}

async function park({ quiet = false } = {}) {
  if (isFull()) {
    showScreen('screen-preview');
    toast(T.queueFull, 'error');
    return;
  }
  const outcome = await enqueue({ date: captureDate, blob: photo });
  if (outcome !== 'queued') {
    // Not stored on the phone: keep it on screen so he can try again,
    // rather than telling him it is waiting when it is not.
    showScreen('screen-preview');
    toast(outcome === 'full' ? T.queueFull : T.queueSaveFailed, 'error');
    return;
  }
  discardPhoto();
  showScreen('screen-capture');
  refreshBanner();
  if (!quiet) toast(T.offlineBanner, 'info');
}

async function flushQueue() {
  if (!pendingCount()) { refreshBanner(); return; }

  setText(els.bannerText, T.sending);
  const { sent, signedOut } = await flush();
  refreshBanner();
  refreshDropped();
  if (sent > 0) toast(T.sent, 'ok');
  if (signedOut) showSignIn(T.sessionExpired);
}

function refreshBanner() {
  const waiting = pendingCount();
  show(els.banner, waiting > 0);
  if (waiting > 0) setText(els.bannerText, T.queueBanner(waiting));
}

function refreshDropped() {
  const days = droppedDays();
  show(els.dropped, days.length > 0);
  if (days.length) setText(els.droppedText, T.droppedBanner(days.map(shortDate).join('، ')));
}

let signingOut = false;

async function onSignOut() {
  // Signing out is a change of hands. Nothing waiting, nothing remembered —
  // [4.2] but never without asking when photos have not gone yet.
  const waiting = pendingCount();
  if (waiting > 0 && !window.confirm(T.signOutConfirm(waiting))) return;

  signingOut = true;
  clearQueue();
  await signOut();
  location.reload();
}

/* --------------------------------------------------------- service worker */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline shell is optional */ });
  });
}

boot();
