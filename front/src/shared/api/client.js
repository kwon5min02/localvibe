export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

export function getAccessToken() {
  try {
    return localStorage.getItem('lv_access_token') || '';
  } catch {
    return '';
  }
}

async function parseError(res) {
  try {
    const data = await res.json();
    return data?.detail || res.statusText;
  } catch {
    return res.statusText;
  }
}

async function readBody(res) {
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : null;
}

/**
 * 인증 필요 API 호출.
 * 토큰 없으면 'not_logged_in' throw, 401 응답도 동일하게 처리.
 */
export async function apiFetch(path, options = {}) {
  const token = getAccessToken();
  if (!token) throw new Error('not_logged_in');
  // FormData는 브라우저가 boundary까지 넣은 Content-Type을 만들어야 하므로 직접 지정하지 않는다.
  const isFormData =
    typeof FormData !== 'undefined' && options.body instanceof FormData;
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) throw new Error('not_logged_in');
  if (!res.ok) throw new Error(await parseError(res));
  return readBody(res);
}

/** 인증 불필요 공개 API 호출. */
export async function publicFetch(path, options = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, options);
  if (!res.ok) throw new Error(await parseError(res));
  return readBody(res);
}

/**
 * 비로그인도 볼 수 있지만, 로그인했다면 사용자별 상태까지 받아야 하는 조회용.
 * (예: 커뮤니티 목록의 saved/myVote/liked)
 * 토큰이 없으면 그냥 공개 호출로 나가고 'not_logged_in'을 던지지 않는다.
 */
export async function optionalAuthFetch(path, options = {}) {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(await parseError(res));
  return readBody(res);
}
