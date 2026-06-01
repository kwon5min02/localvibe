import { getAccessToken } from './scrapsApi';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

function authHeaders() {
  const token = getAccessToken();
  if (!token) throw new Error('not_logged_in');
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

function normalizeTrip(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = Number(raw.id);
  if (!Number.isFinite(id)) return null;
  return {
    id,
    name: String(raw.name || ''),
    createdAt: raw.createdAt || raw.created_at || new Date().toISOString(),
    places: Array.isArray(raw.places) ? raw.places : [],
  };
}

/** @returns {Promise<Array<{id:number,name:string,createdAt:string,places:object[]}>>} */
export async function fetchMyTrips() {
  const res = await fetch(`${API_BASE_URL}/api/me/trips`, { headers: authHeaders() });
  if (res.status === 401) throw new Error('not_logged_in');
  if (!res.ok) throw new Error(await parseError(res));
  const data = await res.json();
  return (Array.isArray(data?.trips) ? data.trips : [])
    .map(normalizeTrip)
    .filter(Boolean);
}

/** @param {Array<{name:string,createdAt?:string,places?:{id:number}[]}>} trips */
export async function syncMyTrips(trips) {
  const payload = (trips || []).map(t => ({
    name: t.name,
    createdAt: t.createdAt,
    places: (t.places || []).map(p => ({ id: Number(p.id) })).filter(p => Number.isFinite(p.id)),
  }));
  const res = await fetch(`${API_BASE_URL}/api/me/trips/sync`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ trips: payload }),
  });
  if (res.status === 401) throw new Error('not_logged_in');
  if (!res.ok) throw new Error(await parseError(res));
  const data = await res.json();
  return (Array.isArray(data?.trips) ? data.trips : []).map(normalizeTrip).filter(Boolean);
}

export async function createTrip(name) {
  const res = await fetch(`${API_BASE_URL}/api/me/trips`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ name }),
  });
  if (res.status === 401) throw new Error('not_logged_in');
  if (!res.ok) throw new Error(await parseError(res));
  const data = await res.json();
  const trip = normalizeTrip(data);
  if (!trip) throw new Error('invalid trip response');
  return trip;
}

export async function deleteTrip(tripId) {
  const res = await fetch(`${API_BASE_URL}/api/me/trips/${tripId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (res.status === 401) throw new Error('not_logged_in');
  if (!res.ok) throw new Error(await parseError(res));
}

export async function addPlaceToTrip(tripId, placeId) {
  const res = await fetch(`${API_BASE_URL}/api/me/trips/${tripId}/places/${placeId}`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (res.status === 401) throw new Error('not_logged_in');
  if (!res.ok) throw new Error(await parseError(res));
  const data = await res.json();
  const trip = normalizeTrip(data);
  if (!trip) throw new Error('invalid trip response');
  return trip;
}

/** 로드맵 순서대로 여행 장소 전체 교체 */
export async function replaceTripPlaces(tripId, placeIds) {
  const ids = (placeIds || []).map(id => Number(id)).filter(Number.isFinite);
  const res = await fetch(`${API_BASE_URL}/api/me/trips/${tripId}/places`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ place_ids: ids }),
  });
  if (res.status === 401) throw new Error('not_logged_in');
  if (!res.ok) throw new Error(await parseError(res));
  const trip = normalizeTrip(await res.json());
  if (!trip) throw new Error('invalid trip response');
  return trip;
}

export async function removePlaceFromTrip(tripId, placeId) {
  const res = await fetch(`${API_BASE_URL}/api/me/trips/${tripId}/places/${placeId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (res.status === 401) throw new Error('not_logged_in');
  if (!res.ok) throw new Error(await parseError(res));
  const data = await res.json();
  const trip = normalizeTrip(data);
  if (!trip) throw new Error('invalid trip response');
  return trip;
}
