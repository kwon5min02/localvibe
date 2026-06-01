const STORAGE_KEY = 'lv_trip_planner_draft';
const DRAFT_VERSION = 1;

export function readTripPlannerDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.v !== DRAFT_VERSION) return null;
    return data;
  } catch {
    return null;
  }
}

export function saveTripPlannerDraft({ placeEntries, tripDuration, messages }) {
  try {
    const payload = {
      v: DRAFT_VERSION,
      savedAt: Date.now(),
      tripDuration: tripDuration ?? null,
      placeEntries: Array.isArray(placeEntries) ? placeEntries : [],
      messages: Array.isArray(messages) ? messages : [],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

export function clearTripPlannerDraft() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function serializePlannerPlaces(locations) {
  return (locations || [])
    .map(loc => {
      const id = Number(loc?.id);
      if (!Number.isFinite(id)) return null;
      return {
        id,
        tripDay: loc.tripDay ?? null,
        tripTime: String(loc.tripTime || ''),
        tripSlot: String(loc.tripSlot || ''),
        tripOrder: loc.tripOrder ?? null,
        scheduleAdjusted: Boolean(loc.scheduleAdjusted),
      };
    })
    .filter(Boolean);
}

export function hydratePlannerPlaces(entries, regionMap) {
  const map = regionMap instanceof Map ? regionMap : new Map();
  return (entries || [])
    .map(entry => {
      const id = Number(entry?.id);
      if (!Number.isFinite(id)) return null;
      const base = map.get(id);
      if (!base) return null;
      return {
        ...base,
        tripDay: entry.tripDay ?? base.tripDay ?? null,
        tripTime: entry.tripTime ?? base.tripTime ?? '',
        tripSlot: entry.tripSlot ?? base.tripSlot ?? '',
        tripOrder: entry.tripOrder ?? base.tripOrder ?? null,
        scheduleAdjusted: entry.scheduleAdjusted ?? base.scheduleAdjusted,
      };
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
