/**
 * The photograph — the evidence behind every figure in this system.
 *
 * Guide 4.5: "give it real space everywhere it appears, never a corner
 * thumbnail." So this renders large by default, and a tap opens it full
 * screen where pinch-zoom is native rather than re-implemented.
 */
import { el } from '../core/dom.js';
import { T } from '../core/strings.js';
import { photoUrl } from '../data/photos.js';

/**
 * @param {string|null} path storage path from daily_entries.photo_path
 * @param {{tall?: boolean, alt?: string}} opts
 * @returns {HTMLElement} fills itself in once the signed URL arrives
 */
export function photoBlock(path, { tall = true, alt = 'صورة الدفتر' } = {}) {
  const wrap = el('div', { class: `photo${tall ? ' photo--tall' : ''}` }, [
    el('div', { class: 'skeleton', style: 'width:100%;height:260px' }),
  ]);

  if (!path || path === 'none') {
    wrap.innerHTML = `<p class="muted small" style="padding:var(--s-8)">${T.noPhoto}</p>`;
    return wrap;
  }

  photoUrl(path).then((url) => {
    if (!url) {
      // Appendix C: a failure here is a wrong path or a file never uploaded.
      wrap.innerHTML = `<p class="muted small" style="padding:var(--s-8)">${T.noPhoto}</p>`;
      return;
    }
    const img = el('img', { src: url, alt, loading: 'lazy' });
    img.addEventListener('click', () => openLightbox(url, alt));
    wrap.innerHTML = '';
    wrap.append(img, el('span', { class: 'photo__zoom', text: T.photoZoomHint }));
  });

  return wrap;
}

/** Small square for dense lists. Only used where a full photo would not fit. */
export function thumb(path, urls = {}) {
  const node = el('img', { class: 'thumb', alt: '' });
  const known = urls[path];
  if (known) node.src = known;
  else if (path && path !== 'none') photoUrl(path).then((url) => { if (url) node.src = url; });
  return node;
}

function openLightbox(url, alt) {
  const overlay = el('div', {
    class: 'modal',
    style: 'padding:0;background:#000',
    onclick: (e) => { if (e.target === overlay || e.target.dataset.close) close(); },
  }, [
    el('div', {
      style: 'width:100%;height:100dvh;overflow:auto;display:grid;place-items:center;' +
             'touch-action:pinch-zoom;-webkit-overflow-scrolling:touch',
    }, [el('img', { src: url, alt, style: 'max-width:none;width:100%' })]),
    el('button', {
      class: 'btn btn--ghost',
      'data-close': 'true',
      style: 'position:fixed;inset-block-start:calc(var(--s-4) + var(--safe-t));' +
             'inset-inline-end:var(--s-4);z-index:1',
      text: T.close,
    }),
  ]);

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = '';
  }
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  document.addEventListener('keydown', onKey);
  document.body.style.overflow = 'hidden';
  document.body.append(overlay);
}
