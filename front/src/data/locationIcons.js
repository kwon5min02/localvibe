// 장소 카테고리별 아이콘 매핑
export const locationIconMap = {
  // 기본값
  default: '📍',

  // 음식 관련
  restaurant: '🍽️',
  cafe: '☕',
  bar: '🍷',
  food: '🍜',
  street_food: '🥘',

  // 숙박
  hotel: '🏨',
  hostel: '🏩',
  accommodation: '🏠',

  // 관광
  museum: '🏛️',
  landmark: '🗿',
  temple: '⛩️',
  palace: '🏰',
  observation: '🔭',
  sight: '👀',

  // 자연
  park: '🌳',
  beach: '🏖️',
  mountain: '⛰️',
  hiking: '🥾',

  // 문화/엔터
  art: '🎨',
  theater: '🎭',
  concert: '🎵',
  gallery: '🖼️',

  // 쇼핑
  market: '🛍️',
  shopping: '🏬',

  // 활동
  tour: '✈️',
  activity: '🎢',
  sport: '⚽',

  // 지역별 (예시)
  busan: '⛵',
  seoul: '🏙️',
  gwangju: '🎯',
};

// 지역명에서 아이콘 자동 추출 함수
export function getIconForLocation(location) {
  if (!location) return locationIconMap.default;

  const name = (location.name || '').toLowerCase();
  const source = (location.dataSource || '').toLowerCase();

  // 이름에서 감지
  if (name.includes('카페') || name.includes('coffee'))
    return locationIconMap.cafe;
  if (name.includes('식당') || name.includes('음식'))
    return locationIconMap.restaurant;
  if (name.includes('호텔') || name.includes('숙') || name.includes('숙박'))
    return locationIconMap.hotel;
  if (name.includes('박물관')) return locationIconMap.museum;
  if (name.includes('공원') || name.includes('park'))
    return locationIconMap.park;
  if (name.includes('해변') || name.includes('beach'))
    return locationIconMap.beach;
  if (name.includes('랜드마크') || name.includes('landmark'))
    return locationIconMap.landmark;
  if (name.includes('시장') || name.includes('market'))
    return locationIconMap.market;
  if (name.includes('갤러리') || name.includes('gallery'))
    return locationIconMap.gallery;
  if (name.includes('타워') || name.includes('tower') || name.includes('전망'))
    return locationIconMap.observation;

  // 지역에서 감지
  if (source.includes('부산')) return locationIconMap.busan;
  if (source.includes('서울')) return locationIconMap.seoul;
  if (source.includes('광주')) return locationIconMap.gwangju;

  return locationIconMap.default;
}
