import { apiFetch } from '../../shared/api/client';

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

/** @returns {Promise<Array>} */
export async function fetchMyTrips() {
  const data = await apiFetch('/api/me/trips');
  return (Array.isArray(data?.trips) ? data.trips : [])
    .map(normalizeTrip)
    .filter(Boolean);
}

/** @param {Array} trips */
export async function syncMyTrips(trips) {
  const payload = (trips || []).map(t => ({
    name: t.name,
    createdAt: t.createdAt,
    places: (t.places || [])
      .map(p => ({ id: Number(p.id) }))
      .filter(p => Number.isFinite(p.id)),
  }));
  const data = await apiFetch('/api/me/trips/sync', {
    method: 'POST',
    body: JSON.stringify({ trips: payload }),
  });
  return (Array.isArray(data?.trips) ? data.trips : [])
    .map(normalizeTrip)
    .filter(Boolean);
}

export async function createTrip(name) {
  const data = await apiFetch('/api/me/trips', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  const trip = normalizeTrip(data);
  if (!trip) throw new Error('invalid trip response');
  return trip;
}

export async function renameTrip(tripId, name) {
  const data = await apiFetch(`/api/me/trips/${tripId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
  const trip = normalizeTrip(data);
  if (!trip) throw new Error('invalid trip response');
  return trip;
}

export async function deleteTrip(tripId) {
  await apiFetch(`/api/me/trips/${tripId}`, { method: 'DELETE' });
}

export async function addPlaceToTrip(tripId, placeId) {
  const data = await apiFetch(`/api/me/trips/${tripId}/places/${placeId}`, {
    method: 'POST',
  });
  const trip = normalizeTrip(data);
  if (!trip) throw new Error('invalid trip response');
  return trip;
}

export async function replaceTripPlaces(tripId, placeIds) {
  const ids = (placeIds || []).map(Number).filter(Number.isFinite);
  const data = await apiFetch(`/api/me/trips/${tripId}/places`, {
    method: 'PUT',
    body: JSON.stringify({ place_ids: ids }),
  });
  const trip = normalizeTrip(data);
  if (!trip) throw new Error('invalid trip response');
  return trip;
}

export async function removePlaceFromTrip(tripId, placeId) {
  const data = await apiFetch(`/api/me/trips/${tripId}/places/${placeId}`, {
    method: 'DELETE',
  });
  const trip = normalizeTrip(data);
  if (!trip) throw new Error('invalid trip response');
  return trip;
}
