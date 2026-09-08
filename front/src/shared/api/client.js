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
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
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
