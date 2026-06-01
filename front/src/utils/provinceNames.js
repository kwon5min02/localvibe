/** 행정구역 정식 명칭 (표시·필터) */

const PROVINCE_CANONICAL = {
  강원: '강원특별자치도',
  강원도: '강원특별자치도',
  강원특별자치: '강원특별자치도',
  강원특별자치도: '강원특별자치도',
  전북: '전북특별자치도',
  전라북: '전북특별자치도',
  전라북도: '전북특별자치도',
  전북특별자치: '전북특별자치도',
  전북특별자치도: '전북특별자치도',
};

export const GANGWON_PROVINCE_TOKENS = ['강원특별자치도', '강원도', '강원특별자치'];

export const JEONBUK_PROVINCE_TOKENS = ['전북특별자치도', '전라북도', '전북특별자치', '전라북'];

export const GANGWON_CITY_LABELS = new Set([
  '강릉', '춘천', '원주', '속초', '평창', '양양', '동해', '삼척', '태백', '홍천',
]);

export const JEONBUK_CITY_LABELS = new Set([
  '전주', '군산', '익산', '남원', '김제', '정읍', '완주', '무주', '진안', '장수',
]);

const LOCALITY_TO_SPECIAL_PROVINCE = {
  강원: '강원특별자치도',
  강원특별자치도: '강원특별자치도',
  전북: '전북특별자치도',
  전북특별자치도: '전북특별자치도',
};

export function canonicalProvince(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const compact = raw.replace(/\s/g, '');
  return PROVINCE_CANONICAL[compact] || raw;
}

export function provinceTokensForFilter(label) {
  const key = String(label || '').trim();
  if (key === '강원' || key === '강원특별자치도') return GANGWON_PROVINCE_TOKENS;
  if (key === '전북' || key === '전북특별자치도') return JEONBUK_PROVINCE_TOKENS;
  const canon = canonicalProvince(key);
  if (canon === '강원특별자치도') return GANGWON_PROVINCE_TOKENS;
  if (canon === '전북특별자치도') return JEONBUK_PROVINCE_TOKENS;
  return canon ? [canon] : (key ? [key] : []);
}

export function specialProvinceCanonForLocality(label) {
  const key = String(label || '').trim();
  if (LOCALITY_TO_SPECIAL_PROVINCE[key]) return LOCALITY_TO_SPECIAL_PROVINCE[key];
  if (GANGWON_CITY_LABELS.has(key)) return '강원특별자치도';
  if (JEONBUK_CITY_LABELS.has(key)) return '전북특별자치도';
  return null;
}

export function matchesSpecialProvinceCity(regionRow, label, addressTokens) {
  const canon = specialProvinceCanonForLocality(label);
  if (!canon || LOCALITY_TO_SPECIAL_PROVINCE[label]) return false;

  const compact = s => String(s || '').replace(/\s/g, '');
  const addr = compact(regionRow.address);
  const prov = compact(canonicalProvince(regionRow.province) || regionRow.province);
  const reg = String(regionRow.region || '').trim();
  const base = label.replace(/시$/, '').replace(/군$/, '').trim();

  const provOk = provinceTokensForFilter(canon).some(
    tok => compact(tok) && (prov.includes(compact(tok)) || addr.includes(compact(tok))),
  );
  if (!provOk) return false;

  const tokens = addressTokens || [];
  return (
    [label, base, `${base}시`].includes(reg)
    || tokens.some(tok => compact(tok) && addr.includes(compact(tok)))
  );
}
