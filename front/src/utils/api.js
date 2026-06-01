/**
 * API 호출 유틸리티
 * 위치: src/utils/api.js
 *
 * 기존에 각 컴포넌트에서 fetch를 직접 호출하던 방식을 중앙화.
 * 인증이 필요한 API는 localStorage의 lv_access_token을 자동으로 포함.
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

function getToken() {
  try {
    return localStorage.getItem('lv_access_token') || '';
  } catch {
    return '';
  }
}

function authHeaders() {
  const token = getToken();
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' };
}

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${text}`);
  }
  // 204 No Content 등 빈 응답 처리
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return null;
}

// ── 스크랩 ────────────────────────────────────────────────────────────────────

/** 내 스크랩 place_id 배열 조회 */
export async function fetchScraps() {
  const data = await request('/api/scraps');
  return Array.isArray(data?.place_ids) ? data.place_ids : [];
}

/** 스크랩 추가 */
export async function addScrap(placeId) {
  return request(`/api/scraps/${placeId}`, { method: 'POST' });
}

/** 스크랩 해제 */
export async function removeScrap(placeId) {
  return request(`/api/scraps/${placeId}`, { method: 'DELETE' });
}

// ── 여행 일정 ─────────────────────────────────────────────────────────────────

/** 내 여행 목록 조회 */
export async function fetchTrips() {
  const data = await request('/api/trips');
  return Array.isArray(data?.trips) ? data.trips : [];
}

/** 여행 생성 */
export async function createTrip(name) {
  return request('/api/trips', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

/** 여행 삭제 */
export async function deleteTrip(tripId) {
  return request(`/api/trips/${tripId}`, { method: 'DELETE' });
}

/** 여행에 장소 추가 */
export async function addPlaceToTrip(tripId, placeId, sortOrder = 0) {
  return request(`/api/trips/${tripId}/places`, {
    method: 'POST',
    body: JSON.stringify({ place_id: placeId, sort_order: sortOrder }),
  });
}

/** 여행에서 장소 제거 */
export async function removePlaceFromTrip(tripId, placeId) {
  return request(`/api/trips/${tripId}/places/${placeId}`, { method: 'DELETE' });
}

/**
 * 여행플래너 → 마이페이지 일정 동기화
 * 새 여행을 만들고 place_ids 순서대로 한 번에 저장
 */
export async function syncTripFromPlanner(name, placeIds) {
  return request('/api/trips/sync', {
    method: 'POST',
    body: JSON.stringify({ name, place_ids: placeIds }),
  });
}
