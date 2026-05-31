/** 백엔드 trip_planner_utils와 맞춘 일정 유틸 (표시는 오전/오후만) */

export const TRIP_ITEMS_PER_DAY_DEFAULT = 6;

export const PERIOD_LABELS = ['오전', '오후'];

const MORNING_SLOTS = new Set(['morning', 'lunch', 'cafe_am']);
const AFTERNOON_SLOTS = new Set(['afternoon', 'dinner', 'night']);

export function periodForSlotIndex(indexInDay) {
  return PERIOD_LABELS[indexInDay % PERIOD_LABELS.length];
}

export function normalizePeriodLabel(time, slot) {
  const t = String(time || '').trim();
  if (t === '오전' || t === '오후') {
    return t;
  }
  if (slot && MORNING_SLOTS.has(slot)) {
    return '오전';
  }
  if (slot && AFTERNOON_SLOTS.has(slot)) {
    return '오후';
  }
  if (/^\d{2}:\d{2}/.test(t)) {
    const hour = parseInt(t.slice(0, 2), 10);
    if (!Number.isNaN(hour) && hour < 14) {
      return '오전';
    }
    return '오후';
  }
  return '오전';
}

export function displayPeriod(loc) {
  if (!loc) {
    return '';
  }
  const t = String(loc.tripTime || '').trim();
  if (t === '오전' || t === '오후') {
    return t;
  }
  return normalizePeriodLabel(t, loc.tripSlot);
}

/** 하루 3곳 이하면 카드 대신 일차 헤더에만 시간대 표시 */
export const TRIP_CARD_PERIOD_MAX = 3;

export function shouldShowCardPeriod(dayCount) {
  return Number(dayCount) > TRIP_CARD_PERIOD_MAX;
}

/** 카드에 표시할 순서 라벨 (하루 3곳 이하) */
export function displayOrderLabel(indexInDay) {
  return `${Number(indexInDay) + 1}번째`;
}

/** 일차 헤더용 오전/오후 요약 */
export function formatDayPeriodSummary(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return '';
  }
  if (items.length > TRIP_CARD_PERIOD_MAX) {
    return '';
  }
  return items
    .map((loc, i) => {
      const p = displayPeriod(loc);
      const name = loc?.name || `장소 ${i + 1}`;
      return p ? `${p} ${name}` : name;
    })
    .join(' · ');
}

export const TRIP_DAY_COLORS = [
  '#4f6ef7',
  '#e05b6f',
  '#0d9488',
  '#d97706',
  '#7c3aed',
  '#0891b2',
];

export function dayMarkerColor(dayNumber) {
  const d = Math.max(1, Number(dayNumber) || 1);
  return TRIP_DAY_COLORS[(d - 1) % TRIP_DAY_COLORS.length];
}

function collapsePeriodFlow(periods) {
  const out = [];
  for (const p of periods) {
    if (!p) {
      continue;
    }
    if (out.length === 0 || out[out.length - 1] !== p) {
      out.push(p);
    }
  }
  return out.join(' → ');
}

export function getMaxLocationsByDuration(days, itemsPerDay = TRIP_ITEMS_PER_DAY_DEFAULT) {
  return Math.max(1, Number(days) * itemsPerDay);
}

export function applyScheduleToRegions(regions, schedule) {
  if (!Array.isArray(schedule) || schedule.length === 0) {
    return regions;
  }
  const byId = new Map(schedule.map(entry => [Number(entry.placeId), entry]));
  return regions.map(region => {
    const meta = byId.get(Number(region.id));
    if (!meta) {
      return region;
    }
    return {
      ...region,
      tripDay: meta.day,
      tripTime: normalizePeriodLabel(meta.time, meta.slot),
      tripSlot: meta.slot,
    };
  });
}

function finalizeItineraryOrder(locations, days) {
  const dayCount = Math.max(1, Number(days) || 1);
  const buckets = new Map();

  for (const loc of locations) {
    const d = Math.min(dayCount, Math.max(1, Number(loc.tripDay) || 1));
    if (!buckets.has(d)) {
      buckets.set(d, []);
    }
    buckets.get(d).push(loc);
  }

  const ordered = [];
  for (let day = 1; day <= dayCount; day += 1) {
    const bucket = buckets.get(day) || [];
    bucket.forEach((loc, slotIndex) => {
      ordered.push({
        ...loc,
        tripDay: day,
        tripTime: periodForSlotIndex(slotIndex),
        tripSlot: slotIndex % 2 === 0 ? 'morning' : 'afternoon',
        scheduleAdjusted: true,
      });
    });
  }

  for (const [day, bucket] of buckets.entries()) {
    if (day > dayCount) {
      bucket.forEach((loc, slotIndex) => {
        ordered.push({
          ...loc,
          tripDay: day,
          tripTime: periodForSlotIndex(slotIndex),
          tripSlot: slotIndex % 2 === 0 ? 'morning' : 'afternoon',
          scheduleAdjusted: true,
        });
      });
    }
  }

  return ordered.length > 0 ? ordered : locations;
}

/** 순서·일차 반영 후 오전/오후 라벨 재부착 */
export function recomputeScheduleForOrderedLocations(
  locations,
  days = 1,
  itemsPerDay = TRIP_ITEMS_PER_DAY_DEFAULT,
) {
  if (!Array.isArray(locations) || locations.length === 0) {
    return [];
  }
  return finalizeItineraryOrder(locations, days);
}

export function moveLocationToIndex(
  locations,
  fromIndex,
  toIndex,
  days,
  itemsPerDay = TRIP_ITEMS_PER_DAY_DEFAULT,
) {
  if (
    !Array.isArray(locations) ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= locations.length ||
    fromIndex === toIndex
  ) {
    return locations;
  }
  const dayCount = Math.max(
    1,
    Number(days) || Math.ceil(locations.length / itemsPerDay) || 1,
  );
  const next = [...locations];
  const [moved] = next.splice(fromIndex, 1);
  const insertAt = toIndex > fromIndex ? toIndex - 1 : toIndex;
  const targetDay =
    next[insertAt]?.tripDay ?? next[insertAt - 1]?.tripDay ?? moved.tripDay ?? 1;
  next.splice(insertAt, 0, { ...moved, tripDay: targetDay });
  return finalizeItineraryOrder(next, dayCount);
}

/** 특정 N일차 맨 뒤로 이동 */
export function moveLocationToDay(
  locations,
  fromIndex,
  targetDay,
  days,
  itemsPerDay = TRIP_ITEMS_PER_DAY_DEFAULT,
) {
  if (!Array.isArray(locations) || fromIndex < 0 || fromIndex >= locations.length) {
    return locations;
  }
  const dayCount = Math.max(1, Number(days) || 1);
  const target = Math.min(dayCount, Math.max(1, Number(targetDay) || 1));
  const next = [...locations];
  const [moved] = next.splice(fromIndex, 1);

  let insertAt = next.length;
  for (let i = 0; i < next.length; i += 1) {
    const d = Number(next[i].tripDay) || 1;
    if (d > target) {
      insertAt = i;
      break;
    }
    if (d === target) {
      insertAt = i + 1;
    }
  }
  next.splice(insertAt, 0, { ...moved, tripDay: target });
  return finalizeItineraryOrder(next, dayCount);
}

export function buildDaySummaries(locations) {
  const byDay = new Map();
  for (const loc of locations) {
    const day = Number(loc.tripDay) || 1;
    if (!byDay.has(day)) {
      byDay.set(day, []);
    }
    byDay.get(day).push(loc);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([dayNumber, items]) => {
      const periods = items.map(displayPeriod).filter(Boolean);
      const names = items.map(i => i.name).filter(Boolean);
      return {
        dayNumber,
        count: items.length,
        timeFlow: periods.length > 0 ? collapsePeriodFlow(periods) : null,
        preview: names.slice(0, 3).join(' · '),
      };
    });
}

export const TRIP_ACTION_LABELS = {
  replan: '전체 일정 새로 구성',
  recommend: '장소 추가',
  remove: '장소 삭제',
  replace: '장소 교체',
  add_preference: '조건만 반영',
  unsupported: '지원하지 않는 요청',
};

export function formatScheduleAsText(schedule) {
  if (!Array.isArray(schedule) || schedule.length === 0) {
    return '';
  }
  const byDay = new Map();
  for (const entry of schedule) {
    const day = Number(entry.day) || 1;
    if (!byDay.has(day)) {
      byDay.set(day, []);
    }
    byDay.get(day).push(entry);
  }
  const lines = ['', '📋 일정 요약'];
  [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .forEach(([day, items]) => {
      lines.push(`\n${day}일차 (${items.length}곳)`);
      items.forEach(item => {
        const period = normalizePeriodLabel(item.time, item.slot);
        const name = item.placeName || `장소 #${item.placeId}`;
        lines.push(`  · ${period} ${name}`);
      });
    });
  return lines.join('\n');
}

export const TRIP_LOADING_PHASES = [
  '질문을 이해하고 있어요…',
  '지역·분위기·제외 조건을 분석 중…',
  '추천 후보를 검색하고 있어요…',
  '일정·동선을 맞추는 중…',
];
