import { isClientPlaceholderImageUrl } from './placeholderImage';
import { canonicalProvince } from './provinceNames';

/**
 * 백엔드가 돌려주는 상대 경로(`/static/...`)는 Vite(dev:5173)가 아니라 API 서버에서 서빙됩니다.
 * 그 상태로 `<img src>`에 넣으면 5173으로 요청이 가며 깨져서 프런트 fallbac만 보입니다.
 */

export function getApiBaseUrl() {
  const raw =
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL != null
      ? String(import.meta.env.VITE_API_BASE_URL || '').trim()
      : '';
  return (raw || 'http://127.0.0.1:8000').replace(/\/$/, '');
}

export function resolveBackendMediaUrl(url, apiBaseUrl) {
  const u = String(url || '').trim();
  if (!u) {
    return '';
  }
  if (u.startsWith('http://') || u.startsWith('https://')) {
    return u;
  }
  if (u.startsWith('//')) {
    return `https:${u}`;
  }
  // 이미지 크롤링을 더 이상 하지 않으므로 백엔드 /static 경로는 항상 비어 있습니다.
  // 그대로 넘기면 매번 404가 나므로 여기서 버리고 각 호출부의 placeholder를 쓰게 합니다.
  if (u.startsWith('/static/')) {
    return '';
  }
  const base = String(apiBaseUrl ?? getApiBaseUrl()).replace(/\/$/, '');
  if (u.startsWith('/') && base) {
    return `${base}${u}`;
  }
  return u;
}

export function normalizeRegionMediaFields(region) {
  if (!region || typeof region !== 'object') {
    return region;
  }
  const resolved = resolveBackendMediaUrl(region.imageUrl);
  const province = canonicalProvince(region.province) || region.province;
  return {
    ...region,
    province: province || region.province,
    imageUrl: isClientPlaceholderImageUrl(resolved) ? '' : resolved,
  };
}
