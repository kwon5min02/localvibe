const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

export function getAccessToken() {
  try {
    return localStorage.getItem('lv_access_token') || '';
  } catch {
    return '';
  }
}

function authHeaders() {
  const token = getAccessToken();
  if (!token) {
    throw new Error('not_logged_in');
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function parseError(res) {
  try {
    const data = await res.json();
    return data?.detail || res.statusText;
  } catch {
    return res.statusText;
  }
}

/** @returns {{ placeIds: number[], regions: object[] }} */
export async function fetchMyScraps() {
  const res = await fetch(`${API_BASE_URL}/api/me/scraps`, {
    headers: authHeaders(),
  });
  if (res.status === 401) throw new Error('not_logged_in');
  if (!res.ok) throw new Error(await parseError(res));
  const data = await res.json();
  const placeIds = Array.isArray(data?.place_ids) ? data.place_ids.map(Number) : [];
  const regions = Array.isArray(data?.regions) ? data.regions : [];
  return { placeIds, regions };
}

/** @param {number[]} placeIds */
export async function syncMyScraps(placeIds) {
  const res = await fetch(`${API_BASE_URL}/api/me/scraps/sync`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ place_ids: placeIds }),
  });
  if (res.status === 401) throw new Error('not_logged_in');
  if (!res.ok) throw new Error(await parseError(res));
  const data = await res.json();
  const ids = Array.isArray(data?.place_ids) ? data.place_ids.map(Number) : [];
  return { placeIds: ids, regions: Array.isArray(data?.regions) ? data.regions : [] };
}

export async function addScrap(placeId) {
  const res = await fetch(`${API_BASE_URL}/api/me/scraps/${placeId}`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (res.status === 401) throw new Error('not_logged_in');
  if (!res.ok) throw new Error(await parseError(res));
}

export async function removeScrap(placeId) {
  const res = await fetch(`${API_BASE_URL}/api/me/scraps/${placeId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (res.status === 401) throw new Error('not_logged_in');
  if (!res.ok) throw new Error(await parseError(res));
}
