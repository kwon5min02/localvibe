/** 여행 이름·검색어로 장소 목록 필터 (마이페이지 장소 추가) */

const TRIP_NAME_REGION_RULES = [
  { test: /제주|서귀포/, hints: ['제주', '서귀포'] },
  { test: /부산|해운대|광안|서면/, hints: ['부산'] },
  { test: /경주/, hints: ['경주', '경상'] },
  { test: /대구/, hints: ['대구'] },
  { test: /인천/, hints: ['인천'] },
  { test: /서울/, hints: ['서울'] },
  { test: /경기|수원|파주|용인|고양|성남/, hints: ['경기'] },
  { test: /강원|강원특별|강릉|춘천|속초|원주/, hints: ['강원특별자치도', '강원도', '강원'] },
  { test: /충청|대전|청주|천안|충주/, hints: ['충청', '대전', '청주', '천안'] },
  { test: /전북|전라북|전주|군산|익산|남원/, hints: ['전북특별자치도', '전라북도', '전북'] },
  { test: /전남|전라남|광주|여수|순천|목포/, hints: ['전라남도', '광주', '여수', '순천', '목포'] },
  { test: /경상|울산|포항/, hints: ['경상', '울산', '포항'] },
  { test: /여수/, hints: ['여수'] },
];

export function inferRegionHintsFromTripName(tripName) {
  const raw = String(tripName || '').trim();
  if (!raw) return [];
  const compact = raw.replace(/\s+/g, '');
  const hints = new Set();
  for (const rule of TRIP_NAME_REGION_RULES) {
    if (rule.test.test(compact) || rule.test.test(raw)) {
      for (const h of rule.hints) hints.add(h);
    }
  }
  return [...hints];
}

function placeBlob(region) {
  return `${region?.name || ''} ${region?.region || ''} ${region?.province || ''} ${region?.summary || ''}`
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function matchesAnyHint(region, hints) {
  const blob = placeBlob(region);
  return hints.some(h => blob.includes(String(h).toLowerCase()));
}

/**
 * @param {Iterable<object>} regions
 * @param {{ query?: string, tripName?: string, limit?: number }} opts
 */
export function searchPlacesForTrip(regions, { query = '', tripName = '', limit = 12 } = {}) {
  const list = [...regions];
  const q = String(query || '').trim().toLowerCase();

  if (q.length >= 1) {
    return list
      .filter(r => placeBlob(r).includes(q))
      .slice(0, limit);
  }

  const hints = inferRegionHintsFromTripName(tripName);
  if (!hints.length) {
    return [];
  }

  return list.filter(r => matchesAnyHint(r, hints)).slice(0, limit);
}
