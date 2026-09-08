import { apiFetch } from '../../shared/api/client';

/** @returns {{ placeIds: number[], regions: object[] }} */
export async function fetchMyScraps() {
  const data = await apiFetch('/api/me/scraps');
  return {
    placeIds: Array.isArray(data?.place_ids) ? data.place_ids.map(Number) : [],
    regions: Array.isArray(data?.regions) ? data.regions : [],
  };
}

/** @param {number[]} placeIds */
export async function syncMyScraps(placeIds) {
  const data = await apiFetch('/api/me/scraps/sync', {
    method: 'POST',
    body: JSON.stringify({ place_ids: placeIds }),
  });
  return {
    placeIds: Array.isArray(data?.place_ids) ? data.place_ids.map(Number) : [],
    regions: Array.isArray(data?.regions) ? data.regions : [],
  };
}

export async function addScrap(placeId) {
  await apiFetch(`/api/me/scraps/${placeId}`, { method: 'POST' });
}

export async function removeScrap(placeId) {
  await apiFetch(`/api/me/scraps/${placeId}`, { method: 'DELETE' });
}
