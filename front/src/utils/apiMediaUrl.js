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
  // 크롤링 이미지(/static/images/...)는 더 이상 수집하지 않아 항상 404입니다.
  // 그대로 넘기면 매번 요청이 실패하므로 버리고 호출부의 placeholder를 쓰게 합니다.
  // 커뮤니티 업로드(/static/community/...)는 실제로 존재하므로 통과시킵니다.
  if (u.startsWith('/static/images/')) {
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
