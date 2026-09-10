import { API_BASE_URL } from '../../shared/api/client';
import { getViewerKey } from '../../shared/viewerKey';

/**
 * 장소 상세를 열었다고 서버에 알립니다. '지금 많이 찾는 장소' 집계에만 쓰입니다.
 * 집계는 화면에 아무 영향이 없으므로 실패해도 조용히 넘어갑니다.
 */
export function recordPlaceView(placeId) {
  const key = getViewerKey();
  if (!placeId || !key) return;
  fetch(
    `${API_BASE_URL}/api/places/${placeId}/view?viewerKey=${encodeURIComponent(key)}`,
    { method: 'POST', keepalive: true },
  ).catch(() => {});
}
