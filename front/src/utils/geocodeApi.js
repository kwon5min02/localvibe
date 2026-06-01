const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

/** 백엔드 Kakao REST API로 주소 → 좌표 (일정 지도용) */
export async function geocodeAddressesBatch(items) {
  const payload = (items || [])
    .map(item => ({
      id: item.id ?? null,
      address: String(item.address || '').trim(),
    }))
    .filter(item => item.address);

  if (!payload.length) {
    return [];
  }

  const response = await fetch(`${API_BASE_URL}/api/geocode/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: payload }),
  });

  if (!response.ok) {
    throw new Error('geocode_batch_failed');
  }

  const data = await response.json();
  return Array.isArray(data?.results) ? data.results : [];
}
