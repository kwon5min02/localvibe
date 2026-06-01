import { useEffect, useState } from 'react';
import { deleteTrip, fetchTrips, removePlaceFromTrip } from '../utils/api';

const CARD_IMAGE_FALLBACK =
  'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=900&q=80';

export default function MyPage({
  scrappedRegions = [],
  myTrips = [],       // localStorage 기반 trips (로그아웃 상태 폴백)
  setMyTrips,
  onToggleScrap,
  onOpenRegion,
  onAddToTrip,
  regions = [],
}) {
  const [tab, setTab] = useState('scraps');
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [newTripName, setNewTripName] = useState('');
  const [showNewTripForm, setShowNewTripForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // [추가] 백엔드 여행 목록 (로그인 시)
  const [serverTrips, setServerTrips] = useState(null); // null = 로딩 중 or 미로그인
  const [serverTripsLoading, setServerTripsLoading] = useState(false);

  const isLoggedIn = Boolean(localStorage.getItem('lv_access_token'));

  // [추가] 로그인 시 서버 여행 목록 로드
  useEffect(() => {
    if (!isLoggedIn) { setServerTrips(null); return; }
    setServerTripsLoading(true);
    fetchTrips()
      .then(trips => setServerTrips(trips))
      .catch(() => setServerTrips(null))
      .finally(() => setServerTripsLoading(false));
  }, [isLoggedIn]);

  // 로그인 시 serverTrips, 비로그인 시 myTrips 사용
  const activeTrips = (isLoggedIn && serverTrips !== null) ? serverTrips : myTrips;

  const handleCreateTrip = (e) => {
    e.preventDefault();
    const name = newTripName.trim();
    if (!name) return;
    const newTrip = { id: Date.now(), name, createdAt: new Date().toISOString(), places: [], place_ids: [] };
    const next = [...myTrips, newTrip];
    setMyTrips(next);
    setNewTripName('');
    setShowNewTripForm(false);
    setSelectedTrip(newTrip.id);
  };

  const handleDeleteTrip = async (tripId) => {
    if (!window.confirm('이 여행을 삭제할까요?')) return;
    if (isLoggedIn) {
      try {
        await deleteTrip(tripId);
        setServerTrips(prev => prev?.filter(t => t.trip_id !== tripId) ?? null);
      } catch { window.alert('삭제에 실패했어요.'); }
    } else {
      const next = myTrips.filter(t => t.id !== tripId);
      setMyTrips(next);
    }
    if (selectedTrip === tripId) setSelectedTrip(null);
  };

  const handleRemovePlaceFromTrip = async (tripId, placeId) => {
    if (isLoggedIn) {
      try {
        await removePlaceFromTrip(tripId, placeId);
        setServerTrips(prev =>
          prev?.map(t =>
            t.trip_id === tripId
              ? { ...t, place_ids: t.place_ids.filter(id => id !== placeId) }
              : t,
          ) ?? null,
        );
      } catch { window.alert('제거에 실패했어요.'); }
    } else {
      const next = myTrips.map(t => t.id === tripId ? { ...t, places: t.places.filter(p => p.id !== placeId) } : t);
      setMyTrips(next);
    }
  };

  const currentTrip = activeTrips.find(t => (t.trip_id ?? t.id) === selectedTrip);

  // 서버 여행의 장소를 regionMap으로 매핑
  const regionMap = new Map(regions.map(r => [r.id, r]));
  const currentTripPlaces = currentTrip
    ? (currentTrip.places ?? (currentTrip.place_ids ?? []).map(id => regionMap.get(Number(id))).filter(Boolean))
    : [];

  const filteredRegions = regions
    .filter(r => r.name?.includes(searchQuery) || r.region?.includes(searchQuery))
    .slice(0, 12);

  return (
    <section style={{ width: '100%' }}>
      {/* 탭 */}
      <div className="app-tabs" style={{ marginTop: 16 }}>
        <button className={`app-tab${tab === 'scraps' ? ' active' : ''}`} onClick={() => setTab('scraps')} type="button">
          ♥ 스크랩한 장소 ({scrappedRegions.length})
        </button>
        <button className={`app-tab${tab === 'trips' ? ' active' : ''}`} onClick={() => setTab('trips')} type="button">
          ✈ 내 여행 일정 ({activeTrips.length})
        </button>
      </div>

      {/* ── 스크랩 탭 ── */}
      {tab === 'scraps' && (
        scrappedRegions.length === 0 ? (
          <div className="mypage-empty">
            <p style={{ fontSize: 32, margin: '0 0 12px' }}>♡</p>
            <p style={{ margin: 0 }}>아직 스크랩한 장소가 없어요.</p>
            <p style={{ margin: '6px 0 0', fontSize: 12, color: '#aaa' }}>갤러리나 여행플래너에서 하트를 눌러 저장해보세요.</p>
          </div>
        ) : (
          <div className="region-grid" style={{ marginTop: 20 }}>
            {scrappedRegions.map(region => (
              <article key={region.id} className="region-card">
                <div
                  className="region-preview"
                  role="button" tabIndex={0}
                  onClick={() => onOpenRegion?.(region)}
                  onKeyDown={e => { if (e.key === 'Enter') onOpenRegion?.(region); }}
                >
                  <button type="button" className="card-heart-btn active"
                    onClick={e => { e.stopPropagation(); onToggleScrap?.(region.id); }}
                    aria-label="스크랩 해제"
                  >♥</button>
                  <img
                    src={region.imageUrl || CARD_IMAGE_FALLBACK}
                    alt={region.name}
                    className="region-image"
                    onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = CARD_IMAGE_FALLBACK; }}
                  />
                  <div className="region-overlay">
                    <span className="region-overlay-name">{region.name}</span>
                    <p className="region-overlay-summary">{String(region.summary || '').trim() || '정보 없음'}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )
      )}

      {/* ── 여행 일정 탭 ── */}
      {tab === 'trips' && (
        <div style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#111' }}>내 여행 목록</h2>
            {!isLoggedIn && (
              <button type="button" className="mypage-create-btn" onClick={() => setShowNewTripForm(v => !v)}>+ 새 여행 만들기</button>
            )}
            {isLoggedIn && (
              <p style={{ margin: 0, fontSize: 12, color: '#aaa' }}>여행플래너에서 "마이페이지에 저장" 버튼으로 추가하세요.</p>
            )}
          </div>

          {!isLoggedIn && showNewTripForm && (
            <form onSubmit={handleCreateTrip} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <input type="text" value={newTripName} onChange={e => setNewTripName(e.target.value)}
                placeholder="여행 이름 입력..." autoFocus
                style={{ flex: 1, height: 40, border: '1px solid #e5e5e5', borderRadius: 8, padding: '0 12px', fontSize: 14, outline: 'none', fontFamily: 'inherit' }}
              />
              <button type="submit" style={{ height: 40, padding: '0 16px', background: '#111', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>만들기</button>
              <button type="button" onClick={() => setShowNewTripForm(false)} style={{ height: 40, padding: '0 12px', background: 'none', color: '#888', border: '1px solid #e5e5e5', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>취소</button>
            </form>
          )}

          {serverTripsLoading && (
            <div style={{ textAlign: 'center', padding: 20, color: '#aaa', fontSize: 13 }}>불러오는 중…</div>
          )}

          {!serverTripsLoading && activeTrips.length === 0 ? (
            <div className="mypage-empty">
              <p style={{ fontSize: 32, margin: '0 0 12px' }}>✈</p>
              <p style={{ margin: 0 }}>아직 만든 여행이 없어요.</p>
              <p style={{ margin: '6px 0 0', fontSize: 12, color: '#aaa' }}>
                {isLoggedIn ? '여행플래너에서 일정을 만들고 저장해보세요.' : '새 여행을 만들고 장소를 추가해보세요.'}
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: selectedTrip ? '240px 1fr' : '1fr', gap: 16 }}>
              {/* 여행 목록 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {activeTrips.map(trip => {
                  const id = trip.trip_id ?? trip.id;
                  const placeCount = trip.place_ids?.length ?? trip.places?.length ?? 0;
                  return (
                    <div
                      key={id}
                      className={`mypage-trip-card${selectedTrip === id ? ' selected' : ''}`}
                      onClick={() => setSelectedTrip(selectedTrip === id ? null : id)}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{trip.name}</div>
                        <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                          {placeCount}개 장소 · {new Date(trip.created_at || trip.createdAt).toLocaleDateString('ko-KR')}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); handleDeleteTrip(id); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ccc', fontSize: 14, padding: 4, flexShrink: 0 }}
                        title="삭제"
                      >🗑</button>
                    </div>
                  );
                })}
              </div>

              {/* 선택된 여행 상세 */}
              {currentTrip && (
                <div style={{ border: '1px solid #e5e5e5', borderRadius: 12, padding: 20, background: '#fff' }}>
                  <h3 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 800, color: '#111' }}>{currentTrip.name}</h3>

                  {currentTripPlaces.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '24px 0', color: '#aaa', fontSize: 14 }}>
                      <p style={{ margin: '0 0 4px' }}>아직 담긴 장소가 없어요.</p>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                      {currentTripPlaces.map((place, idx) => place && (
                        <div key={place.id ?? idx} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: '#f8f8f8', borderRadius: 8, border: '1px solid #eee' }}>
                          <span style={{ fontSize: 12, color: '#aaa', fontWeight: 700, minWidth: 20 }}>{idx + 1}</span>
                          <img src={place.imageUrl || CARD_IMAGE_FALLBACK} alt={place.name}
                            style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
                            onError={e => { e.currentTarget.src = CARD_IMAGE_FALLBACK; }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{place.name}</div>
                            <div style={{ fontSize: 11, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{place.region || place.address || ''}</div>
                          </div>
                          <button type="button" onClick={() => onOpenRegion?.(place)}
                            style={{ background: 'none', border: '1px solid #e5e5e5', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: '#555', fontFamily: 'inherit', flexShrink: 0 }}
                          >보기</button>
                          <button type="button"
                            onClick={() => handleRemovePlaceFromTrip(currentTrip.trip_id ?? currentTrip.id, place.id)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ccc', fontSize: 14, padding: 2, flexShrink: 0 }}
                          >✕</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 장소 추가 검색 (비로그인 or localStorage 여행) */}
                  {!isLoggedIn && (
                    <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
                      <h4 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: '#555' }}>장소 추가</h4>
                      <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                        placeholder="장소 이름 또는 지역 검색..."
                        style={{ width: '100%', height: 38, border: '1px solid #e5e5e5', borderRadius: 8, padding: '0 12px', fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                      />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10, maxHeight: 240, overflowY: 'auto' }}>
                        {filteredRegions.map(place => {
                          const alreadyIn = currentTripPlaces.some(p => p?.id === place.id);
                          return (
                            <div key={place.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 7, border: '1px solid #eee', background: '#fafafa' }}>
                              <img src={place.imageUrl || CARD_IMAGE_FALLBACK} alt={place.name}
                                style={{ width: 36, height: 36, borderRadius: 5, objectFit: 'cover', flexShrink: 0 }}
                                onError={e => { e.currentTarget.src = CARD_IMAGE_FALLBACK; }} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{place.name}</div>
                                <div style={{ fontSize: 11, color: '#888' }}>{place.region || ''}</div>
                              </div>
                              <button type="button" disabled={alreadyIn}
                                onClick={() => { if (!alreadyIn) onAddToTrip?.(place); }}
                                style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, background: alreadyIn ? '#f0f0f0' : '#111', color: alreadyIn ? '#aaa' : '#fff', border: 'none', borderRadius: 6, cursor: alreadyIn ? 'default' : 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
                              >{alreadyIn ? '추가됨' : '+ 추가'}</button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
