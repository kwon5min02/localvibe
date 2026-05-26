/** API imageUrl 없을 때만 쓰는 로컬 placeholder (DB·데모 Unsplash와 무관). */

export const CARD_PLACEHOLDER_SVG =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='480' height='300'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0%25' stop-color='%23e8ebf7'/%3E%3Cstop offset='100%25' stop-color='%23cdd6f2'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='100%25' height='100%25' fill='url(%23g)'/%3E%3Ctext x='50%25' y='52%25' dominant-baseline='middle' text-anchor='middle' fill='%235468a3' font-family='Arial' font-size='22'%3ELocalVibe%3C/text%3E%3C/svg%3E";

const PLACEHOLDER_HOST_MARKERS = ['images.unsplash.com'];

export function isClientPlaceholderImageUrl(url) {
  const u = String(url || '').trim().toLowerCase();
  if (!u) return true;
  return PLACEHOLDER_HOST_MARKERS.some((m) => u.includes(m));
}

export function displayImageSrc(imageUrl, resolveFn) {
  const resolved = resolveFn ? resolveFn(imageUrl) : String(imageUrl || '').trim();
  if (isClientPlaceholderImageUrl(resolved)) return CARD_PLACEHOLDER_SVG;
  return resolved;
}
