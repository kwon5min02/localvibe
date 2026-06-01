/**
 * 사이드바 지역 클릭 — 장소명이 아닌 주소·region·province만 매칭 (백엔드 sidebar_location.py와 동일 규칙).
 */

import {
  canonicalProvince,
  GANGWON_PROVINCE_TOKENS,
  JEONBUK_PROVINCE_TOKENS,
  matchesSpecialProvinceCity,
  provinceTokensForFilter,
} from './provinceNames';

const SIDEBAR_CITY_ADDRESS_TOKENS = {
  서울: ['서울특별시', '서울시'],
  인천: ['인천광역시', '인천시'],
  강릉: ['강릉시', '강릉군'],
  춘천: ['춘천시'],
  원주: ['원주시'],
  속초: ['속초시'],
  대전: ['대전광역시', '대전시'],
  청주: ['청주시'],
  천안: ['천안시'],
  충주: ['충주시'],
  광주: ['광주광역시', '광주시'],
  전주: ['전주시'],
  군산: ['군산시'],
  익산: ['익산시'],
  남원: ['남원시'],
  여수: ['여수시'],
  순천: ['순천시'],
  목포: ['목포시'],
  부산: ['부산광역시', '부산시'],
  대구: ['대구광역시', '대구시'],
  경주: ['경주시'],
  울산: ['울산광역시', '울산시'],
  포항: ['포항시'],
  제주시: ['제주시'],
  서귀포: ['서귀포시'],
};

const SIDEBAR_PROVINCE_TOKENS = {
  경기: ['경기도'],
  강원: GANGWON_PROVINCE_TOKENS,
  강원특별자치도: GANGWON_PROVINCE_TOKENS,
  전북: JEONBUK_PROVINCE_TOKENS,
  전북특별자치도: JEONBUK_PROVINCE_TOKENS,
};

function compact(s) {
  return String(s || '').replace(/\s/g, '').trim();
}

function addressTokensForLocality(locality) {
  const label = String(locality || '').trim();
  if (SIDEBAR_PROVINCE_TOKENS[label]) return SIDEBAR_PROVINCE_TOKENS[label];
  if (SIDEBAR_CITY_ADDRESS_TOKENS[label]) return SIDEBAR_CITY_ADDRESS_TOKENS[label];
  const base = label.replace(/시$/, '').replace(/군$/, '').trim();
  if (!base) return [];
  const out = [];
  if (/[시군]$/.test(label)) out.push(label);
  out.push(`${base}시`, `${base}군`);
  return [...new Set(out)];
}

export function placeMatchesSidebarLocality(regionRow, locality) {
  const label = String(locality || '').trim();
  if (label.length < 2 || !regionRow) return false;

  const addr = compact(regionRow.address);
  const reg = String(regionRow.region || '').trim();
  const prov = compact(canonicalProvince(regionRow.province) || regionRow.province);
  const addressRaw = String(regionRow.address || '');

  if (SIDEBAR_PROVINCE_TOKENS[label]) {
    return SIDEBAR_PROVINCE_TOKENS[label].some(tok => {
      const t = compact(tok);
      return t && (prov.includes(t) || addr.includes(t));
    });
  }

  if (label === '제주시') {
    if (addr.includes('서귀포시') && !addr.includes('제주시')) return false;
    if (addr.includes('제주시') || addressRaw.includes('제주특별자치도')) return true;
    return reg === '제주' || reg === '제주시';
  }

  if (label === '서귀포') {
    return addr.includes('서귀포시') || reg === '서귀포' || reg === '서귀포시';
  }

  const tokens = addressTokensForLocality(label);
  if (tokens.some(tok => compact(tok) && addr.includes(compact(tok)))) return true;

  const base = label.replace(/시$/, '').replace(/군$/, '').trim();
  if ([label, base, `${base}시`, `${base}군`].includes(reg)) return true;

  if (matchesSpecialProvinceCity(regionRow, label, tokens)) return true;

  return false;
}

export function filterRegionsBySidebarLocation(regions, locality) {
  const label = String(locality || '').trim();
  if (!label || !Array.isArray(regions)) return [];
  return regions.filter(r => placeMatchesSidebarLocality(r, label));
}
