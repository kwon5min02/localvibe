const DRAFT_VERSION = 1;
const LEGACY_STORAGE_KEY = 'lv_trip_planner_draft';

function plannerStorageKey(userId) {
  const id = String(userId || '').trim();
  if (!id) return null;
  return `lv_trip_planner_draft_u_${id}`;
}

export function clearGuestPlannerDraft() {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function readTripPlannerDraft(userId) {
  const key = plannerStorageKey(userId);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.v !== DRAFT_VERSION) return null;
    return data;
  } catch {
    return null;
  }
}

export function saveTripPlannerDraft(userId, { placeEntries, tripDuration, messages }) {
  const key = plannerStorageKey(userId);
  if (!key) return;
  try {
    const payload = {
      v: DRAFT_VERSION,
      savedAt: Date.now(),
      userId: String(userId),
      tripDuration: tripDuration ?? null,
      placeEntries: Array.isArray(placeEntries) ? placeEntries : [],
      messages: Array.isArray(messages) ? messages : [],
    };
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

export function clearTripPlannerDraft(userId) {
  const key = plannerStorageKey(userId);
  if (!key) return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** regionMap 없이도 로드맵 복원 가능하도록 스냅샷 필드 저장 */
export function serializePlannerPlaces(locations) {
  return (locations || [])
    .map(loc => {
      const id = Number(loc?.id);
      if (!Number.isFinite(id)) return null;
      return {
        id,
        name: String(loc.name || ''),
        imageUrl: String(loc.imageUrl || ''),
        address: String(loc.address || ''),
        latitude: loc.latitude ?? null,
        longitude: loc.longitude ?? null,
        summary: String(loc.summary || ''),
        summaryShort: String(loc.summaryShort || ''),
        province: String(loc.province || ''),
        region: String(loc.region || ''),
        tripDay: loc.tripDay ?? null,
        tripTime: String(loc.tripTime || ''),
        tripSlot: String(loc.tripSlot || ''),
        tripOrder: loc.tripOrder ?? null,
        scheduleAdjusted: Boolean(loc.scheduleAdjusted),
      };
    })
    .filter(Boolean);
}

function mergeScheduleFields(base, entry) {
  return {
    ...base,
    tripDay: entry.tripDay ?? base.tripDay ?? null,
    tripTime: entry.tripTime ?? base.tripTime ?? '',
    tripSlot: entry.tripSlot ?? base.tripSlot ?? '',
    tripOrder: entry.tripOrder ?? base.tripOrder ?? null,
    scheduleAdjusted: entry.scheduleAdjusted ?? base.scheduleAdjusted,
  };
}

export function hydratePlannerPlaces(entries, regionMap) {
  const map = regionMap instanceof Map ? regionMap : new Map();
  return (entries || [])
    .map(entry => {
      const id = Number(entry?.id);
      if (!Number.isFinite(id)) return null;
      const fromMap = map.get(id);
      if (fromMap) {
        return mergeScheduleFields(fromMap, entry);
      }
      if (!entry.name && !entry.imageUrl) return null;
      return mergeScheduleFields(
        {
          id,
          name: entry.name || `장소 #${id}`,
          imageUrl: entry.imageUrl || '',
          address: entry.address || '',
          latitude: entry.latitude ?? null,
          longitude: entry.longitude ?? null,
          summary: entry.summary || '',
          summaryShort: entry.summaryShort || '',
          province: entry.province || '',
          region: entry.region || '',
        },
        entry,
      );
    })
    .filter(Boolean);
}

export function serializePlannerMessages(messages) {
  return (messages || [])
    .filter(m => m?.role === 'user' || m?.role === 'assistant')
    .filter(m => typeof m?.text === 'string' && m.text.trim())
    .map(m => ({
      role: m.role,
      text: String(m.text).slice(0, 4000),
      ...(m.componentType ? { componentType: m.componentType } : {}),
    }));
}

export function restorePlannerMessages(saved) {
  if (!Array.isArray(saved) || saved.length === 0) return null;
  return saved
    .filter(m => m?.role === 'user' || m?.role === 'assistant')
    .map(m => ({
      role: m.role,
      text: String(m.text || ''),
      ...(m.componentType ? { componentType: m.componentType } : {}),
    }));
}

export function getPlannerUserId(currentUser) {
  if (!currentUser) return null;
  const id = currentUser.id ?? currentUser.user_id ?? currentUser.email;
  const s = String(id ?? '').trim();
  return s || null;
}
