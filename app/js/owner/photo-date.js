/**
 * Guessing the business day a backlog photograph belongs to.
 *
 * The guide wants each thumbnail's date "read automatically if the notebook
 * page shows one, or picked manually from a calendar strip if not" (4.4).
 * Reading the handwritten date off the page would mean a second AI round trip
 * per photo, on a free tier already rate-limited by the extraction itself —
 * so we read the date the camera recorded instead, which is the same day the
 * page was photographed and costs nothing.
 *
 * Order: EXIF DateTimeOriginal → the filename → the file's own timestamp.
 * Whatever we guess is shown in an editable field; the owner has the last word.
 *
 * [4.2] The code now follows that order (it used to try the filename first),
 * prefers the moment of capture over a later gallery edit, and reads dates in
 * Riyadh time rather than UTC (DEVIATIONS.md #22).
 */
import { CONFIG } from '../config.js';
import { todayRiyadh, addDays } from '../core/format.js';

/** A timestamp as a Riyadh calendar date. */
function riyadhDate(ms) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CONFIG.TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms));
}

/** @returns {Promise<{date: string|null, source: 'exif'|'filename'|'file'|null}>} */
export async function guessDate(file) {
  const fromExif = await readExifDate(file).catch(() => null);
  if (fromExif) return { date: fromExif, source: 'exif' };

  const fromName = fromFilename(file.name);
  if (fromName) return { date: fromName, source: 'filename' };

  if (file.lastModified) {
    const iso = riyadhDate(file.lastModified);
    if (isPlausible(iso)) return { date: iso, source: 'file' };
  }
  return { date: null, source: null };
}

/**
 * Camera and messaging apps put the date in the filename far more reliably
 * than users expect: IMG_20260807_201533.jpg, IMG-20260807-WA0009.jpg,
 * 2026-08-07 21.14.02.jpg, Screenshot_20260807.png.
 */
function fromFilename(name = '') {
  const patterns = [
    /(20\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])/,   // 20260807 / 2026-08-07
    /(0[1-9]|[12]\d|3[01])[-_.](0[1-9]|1[0-2])[-_.](20\d{2})/,     // 07-08-2026
  ];

  for (const [index, pattern] of patterns.entries()) {
    const found = name.match(pattern);
    if (!found) continue;
    const [year, month, day] = index === 0
      ? [found[1], found[2], found[3]]
      : [found[3], found[2], found[1]];
    const iso = `${year}-${month}-${day}`;
    if (isPlausible(iso)) return iso;
  }
  return null;
}

/** A real calendar date, not in the future, not more than five years back. */
function isPlausible(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return false;
  const today = todayRiyadh();
  return iso <= today && iso > addDays(today, -5 * 366);
}

/**
 * Minimal EXIF reader: walk the JPEG markers to APP1, then the TIFF IFD0 and
 * the Exif sub-IFD, looking only for DateTimeOriginal (0x9003) and
 * DateTime (0x0132). A dependency for one tag is not worth it.
 */
async function readExifDate(file) {
  const head = await file.slice(0, 128 * 1024).arrayBuffer();
  const view = new DataView(head);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) return null;   // not a JPEG

  let offset = 2;
  while (offset + 4 < view.byteLength) {
    if (view.getUint8(offset) !== 0xFF) break;
    const marker = view.getUint8(offset + 1);
    const size = view.getUint16(offset + 2);
    if (marker === 0xE1) {
      const start = offset + 4;
      // "Exif\0\0"
      if (view.getUint32(start) === 0x45786966) return readTiff(view, start + 6);
      return null;
    }
    if (marker === 0xDA) break;   // start of scan — no EXIF before the image data
    offset += 2 + size;
  }
  return null;
}

function readTiff(view, tiffStart) {
  if (tiffStart + 8 > view.byteLength) return null;
  const little = view.getUint16(tiffStart) === 0x4949;
  const u16 = (p) => view.getUint16(p, little);
  const u32 = (p) => view.getUint32(p, little);

  if (u16(tiffStart + 2) !== 0x002A) return null;

  const dateAt = (entry) => {
    const text = ascii(view, tiffStart + u32(entry + 8), 19);
    const iso = text.slice(0, 10).replace(/:/g, '-');
    return isPlausible(iso) ? iso : null;
  };

  // IFD0: remember DateTime (0x0132 — last modified, e.g. a gallery edit) and
  // follow the pointer to the Exif sub-IFD, where DateTimeOriginal (0x9003 —
  // the moment the shutter fired) lives. The capture date wins.
  const scan = (ifdStart) => {
    if (ifdStart + 2 > view.byteLength) return { original: null, modified: null, exif: null };
    const entries = u16(ifdStart);
    const out = { original: null, modified: null, exif: null };
    for (let i = 0; i < entries; i++) {
      const entry = ifdStart + 2 + i * 12;
      if (entry + 12 > view.byteLength) break;
      const tag = u16(entry);
      if (tag === 0x9003) out.original = dateAt(entry);
      else if (tag === 0x0132) out.modified = dateAt(entry);
      else if (tag === 0x8769) out.exif = tiffStart + u32(entry + 8);
    }
    return out;
  };

  const ifd0 = scan(tiffStart + u32(tiffStart + 4));
  const sub = ifd0.exif ? scan(ifd0.exif) : { original: null };
  return sub.original || ifd0.original || ifd0.modified || null;
}

function ascii(view, offset, length) {
  let out = '';
  for (let i = 0; i < length && offset + i < view.byteLength; i++) {
    const code = view.getUint8(offset + i);
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out;
}
