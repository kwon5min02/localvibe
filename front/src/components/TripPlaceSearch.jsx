import { useMemo, useState } from 'react';
import { resolveBackendMediaUrl } from '../utils/apiMediaUrl';
import { CARD_PLACEHOLDER_SVG } from '../utils/placeholderImage';

const MAX_RESULTS = 8;

export default function TripPlaceSearch({
  regionMap,
  currentLocationIds = [],
  maxLocations = null,
  onAddPlace,
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const existing = useMemo(
    () => new Set((currentLocationIds || []).map(Number)),
    [currentLocationIds],
  );

  const atCap =
    Number.isFinite(maxLocations) && existing.size >= maxLocations;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 1) {
      return [];
    }
    const list = [];
    for (const region of regionMap.values()) {
      const blob = `${region.name || ''} ${region.region || ''} ${region.province || ''} ${region.summary || ''}`.toLowerCase();
      if (blob.includes(q)) {
        list.push(region);
      }
      if (list.length >= MAX_RESULTS * 2) {
        break;
      }
    }
    return list.slice(0, MAX_RESULTS);
  }, [query, regionMap]);

  function handlePick(region) {
    if (!region?.id || existing.has(Number(region.id)) || atCap) {
      return;
    }
    onAddPlace?.(region);
    setQuery('');
    setOpen(false);
  }

  return (
    <div className="trip-place-search">
      <label className="trip-place-search-label" htmlFor="trip-place-search-input">
        장소 직접 추가
      </label>
      <input
        id="trip-place-search-input"
        type="search"
        className="trip-place-search-input"
        placeholder="이름·지역으로 검색 (갤러리와 동일 데이터)"
        value={query}
        onChange={e => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        disabled={atCap}
      />
      {atCap ? (
        <p className="trip-place-search-cap">일정이 가득 찼어요. 삭제하거나 기간을 늘려 주세요.</p>
      ) : null}
      {open && query.trim() && results.length > 0 ? (
        <ul className="trip-place-search-results" role="listbox">
          {results.map(region => {
            const added = existing.has(Number(region.id));
            const img =
              resolveBackendMediaUrl(region.imageUrl) || CARD_PLACEHOLDER_SVG;
            return (
              <li key={region.id}>
                <button
                  type="button"
                  className="trip-place-search-item"
                  disabled={added}
                  onClick={() => handlePick(region)}
                >
                  <img src={img} alt="" className="trip-place-search-thumb" />
                  <span className="trip-place-search-item-text">
                    <strong>{region.name}</strong>
                    <span>
                      {[region.region, region.province].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {added ? (
                    <span className="trip-place-search-added">담김</span>
                  ) : (
                    <span className="trip-place-search-add">+ 추가</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {open && query.trim() && results.length === 0 ? (
        <p className="trip-place-search-empty">검색 결과가 없어요.</p>
      ) : null}
    </div>
  );
}
