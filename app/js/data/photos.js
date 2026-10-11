/**
 * Reading a photograph back out of the private bucket.
 *
 * Owner-only by storage policy. Never make the bucket public to skip this
 * step (guide 9.8) — the signed URL is what keeps a year of the shop's
 * takings from being one guessed filename away from the open internet.
 */
import { supabase } from '../core/supabase.js';
import { CONFIG } from '../config.js';

/** Signed URLs are short-lived, so cache them only for their own lifetime. */
const cache = new Map();

export async function photoUrl(path) {
  if (!path || path === 'none') return null;

  const hit = cache.get(path);
  if (hit && hit.expires > Date.now()) return hit.url;

  const { data, error } = await supabase.storage
    .from(CONFIG.BUCKET)
    .createSignedUrl(path, CONFIG.SIGNED_URL_TTL);

  // Appendix C: a 400 here means the path is wrong or the file never uploaded.
  if (error || !data?.signedUrl) return null;

  cache.set(path, {
    url: data.signedUrl,
    expires: Date.now() + (CONFIG.SIGNED_URL_TTL - 30) * 1000,
  });
  return data.signedUrl;
}

/** Sign several paths at once — the review queue's thumbnails. */
export async function photoUrls(paths) {
  const unique = [...new Set(paths.filter((p) => p && p !== 'none'))];
  const entries = await Promise.all(unique.map(async (p) => [p, await photoUrl(p)]));
  return Object.fromEntries(entries);
}
