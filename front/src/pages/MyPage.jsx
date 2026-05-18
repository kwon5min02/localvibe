import { useState } from 'react';

const CARD_IMAGE_FALLBACK = "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=900&q=80";

export default function MyPage({ scrappedRegions = [], myTrips = [], setMyTrips, onToggleScrap, onOpenRegion, regions = [] }) {
  const [tab, setTab] = useState('scraps');
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [newTripName, setNewTripName] = useState('');
  const [showNewTripForm, setShowNewTripForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const handleCreateTrip = (e) => {
    e.preventDefault();
    const name = newTripName.trim();
    if (!name) return;
    const newTrip = { id: Date.now(), name, createdAt: new Date().toISOString(), places: [] };
    const next = [...myTrips, newTrip];
    setMyTrips(next);
    setNewTripName('');
    setShowNewTripForm(false);
    setSelectedTrip(newTrip.id);
  };

  const handleDeleteTrip = (tripId) => {
    if (!window.confirm('이 여행을 삭제할까요?')) return;
    const next = myTrips.filter(t => t.id !== tripId);
    setMyTrips(next);
    if (selectedTrip === tripId) setSelectedTrip(null);
  };

  const handleRemovePlaceFromTrip = (tripId, placeId) => {
    const next = myTrips.map(t => t.id === tripId ? { ...t, places: t.places.filter(p => p.id !== placeId) } : t);
    setMyTrips(next);
  };

  const handleAddPlaceToTrip = (tripId, place) => {
    const trip = myTrips.find(t => t.id === tripId);
    if (!trip) return;
    if (trip.places.some(p => p.id === place.id)) { window.alert('이미 담긴 장소예요!'); return; }
    const next = myTrips.map(t => t.id === tripId ? { ...t, places: [...t.places, place] } : t);
    setMyTrips(next);
  };

  const currentTrip = myTrips.find(t => t.id === selectedTrip);
  const filteredRegions = regions.filter(r => r.name?.includes(searchQuery) || r.region?.includes(searchQuery)).slice(0, 12);

  return (
    <section style={{ width: '100%' }}>
      {/* 탭 */}
      <div className="app-tabs" style={{ marginTop: 16 }}>
        <button className={`app-tab${tab === 'scraps' ? ' active' : ''}`} onClick={() => setTab('scraps')} type="button">
          ♥ 스크랩한 장소 ({scrappedRegions.length})
        </button>
        <button className={`app-tab${tab === 'trips' ? ' active' : ''}`} onClick={() => setTab('trips')} type="button">
          ✈ 내 여행 일정 ({myTrips.length})
        </button>
      </div>

      {/* ── 스크랩 탭 ── */}
      {tab === 'scraps' && (
        <>
          {scrappedRegions.length === 0 ? (
            <div className="mypage-empty">
              <p style={{ fontSize: 32, margin: '0 0 12px' }}>♡</p>
              <p style={{ margin: 0 }}>아직 스크랩한 장소가 없어요.</p>
              <p style={{ margin: '6px 0 0', fontSize: 12, color: '#aaa' }}>갤러리에서 마음에 드는 장소를 하트로 저장해보세요.</p>
            </div>
          ) : (
            <div className="region-grid" style={{ marginTop: 20 }}>
              {scrappedRegions.map(region => (
                <article key={region.id} className="region-card">
                  <div className="region-preview" role="button" tabIndex={0} onClick={() => onOpenRegion?.(region)} onKeyDown={e => { if (e.key === 'Enter') onOpenRegion?.(region); }}>
                    <button type="button" className="card-heart-btn active" onClick={e => { e.stopPropagation(); onToggleScrap?.(region.id); }} aria-label="스크랩 해제">♥</button>
                    <img src={region.imageUrl || CARD_IMAGE_FALLBACK} alt={region.name} className="region-image" onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = CARD_IMAGE_FALLBACK; }} />
                    <div className="region-overlay">
                      <span className="region-overlay-name">{region.name}</span>
                      <p className="region-overlay-summary">{String(region.summary || '').trim() || '정보 없음'}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── 여행 일정 탭 ── */}
      {tab === 'trips' && (
        <div style={{ marginTop: 20 }}>
          {/* 여행 목록 + 새 여행 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#111' }}>내 여행 목록</h2>
            <button type="button" className="mypage-create-btn" onClick={() => setShowNewTripForm(v => !v)}>+ 새 여행 만들기</button>
          </div>

          {showNewTripForm && (
            <form onSubmit={handleCreateTrip} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <input
                type="text"
                value={newTripName}
                onChange={e => setNewTripName(e.target.value)}
                placeholder="여행 이름 입력..."
                style={{ flex: 1, height: 40, border: '1px solid #e5e5e5', borderRadius: 8, padding: '0 12px', fontSize: 14, outline: 'none', fontFamily: 'inherit' }}
                autoFocus
              />
              <button type="submit" style={{ height: 40, padding: '0 16px', background: '#111', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>만들기</button>
              <button type="button" onClick={() => setShowNewTripForm(false)} style={{ height: 40, padding: '0 12px', background: 'none', color: '#888', border: '1px solid #e5e5e5', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>취소</button>
            </form>
          )}

          {myTrips.length === 0 ? (
            <div className="mypage-empty">
              <p style={{ fontSize: 32, margin: '0 0 12px' }}>✈</p>
              <p style={{ margin: 0 }}>아직 만든 여행이 없어요.</p>
              <p style={{ margin: '6px 0 0', fontSize: 12, color: '#aaa' }}>새 여행을 만들고 원하는 장소를 추가해보세요.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: selectedTrip ? '240px 1fr' : '1fr', gap: 16 }}>
              {/* 여행 목록 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {myTrips.map(trip => (
                  <div
                    key={trip.id}
                    className={`mypage-trip-card${selectedTrip === trip.id ? ' selected' : ''}`}
                    onClick={() => setSelectedTrip(selectedTrip === trip.id ? null : trip.id)}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{trip.name}</div>
                      <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                        {trip.places.length}개 장소 · {new Date(trip.createdAt).toLocaleDateString('ko-KR')}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); handleDeleteTrip(trip.id); }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ccc', fontSize: 14, padding: 4, flexShrink: 0 }}
                      title="삭제"
                    >🗑</button>
                  </div>
                ))}
              </div>

              {/* 선택된 여행 상세 */}
              {currentTrip && (
                <div style={{ border: '1px solid #e5e5e5', borderRadius: 12, padding: 20, background: '#fff' }}>
                  <h3 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 800, color: '#111' }}>{currentTrip.name}</h3>

                  {/* 담긴 장소 */}
                  {currentTrip.places.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '24px 0', color: '#aaa', fontSize: 14 }}>
                      <p style={{ margin: '0 0 4px' }}>아직 담긴 장소가 없어요.</p>
                      <p style={{ margin: 0, fontSize: 12 }}>아래 검색으로 장소를 추가해보세요.</p>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                      {currentTrip.places.map((place, idx) => (
                        <div key={place.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: '#f8f8f8', borderRadius: 8, border: '1px solid #eee' }}>
                          <span style={{ fontSize: 12, color: '#aaa', fontWeight: 700, minWidth: 20 }}>{idx + 1}</span>
                          <img src={place.imageUrl || CARD_IMAGE_FALLBACK} alt={place.name} style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} onError={e => { e.currentTarget.src = CARD_IMAGE_FALLBACK; }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{place.name}</div>
                            <div style={{ fontSize: 11, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{place.region || place.address || ''}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => onOpenRegion?.(place)}
                            style={{ background: 'none', border: '1px solid #e5e5e5', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: '#555', fontFamily: 'inherit', flexShrink: 0 }}
                          >보기</button>
                          <button
                            type="button"
                            onClick={() => handleRemovePlaceFromTrip(currentTrip.id, place.id)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ccc', fontSize: 14, padding: 2, flexShrink: 0 }}
                          >✕</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 장소 추가 검색 */}
                  <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
                    <h4 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: '#555' }}>장소 추가</h4>
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="장소 이름 또는 지역 검색..."
                      style={{ width: '100%', height: 38, border: '1px solid #e5e5e5', borderRadius: 8, padding: '0 12px', fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10, maxHeight: 240, overflowY: 'auto' }}>
                      {filteredRegions.map(place => {
                        const alreadyIn = currentTrip.places.some(p => p.id === place.id);
                        return (
                          <div key={place.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 7, border: '1px solid #eee', background: '#fafafa' }}>
                            <img src={place.imageUrl || CARD_IMAGE_FALLBACK} alt={place.name} style={{ width: 36, height: 36, borderRadius: 5, objectFit: 'cover', flexShrink: 0 }} onError={e => { e.currentTarget.src = CARD_IMAGE_FALLBACK; }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{place.name}</div>
                              <div style={{ fontSize: 11, color: '#888' }}>{place.region || ''}</div>
                            </div>
                            <button
                              type="button"
                              disabled={alreadyIn}
                              onClick={() => handleAddPlaceToTrip(currentTrip.id, place)}
                              style={{
                                padding: '4px 10px', fontSize: 11, fontWeight: 600,
                                background: alreadyIn ? '#f0f0f0' : '#111',
                                color: alreadyIn ? '#aaa' : '#fff',
                                border: 'none', borderRadius: 6, cursor: alreadyIn ? 'default' : 'pointer',
                                fontFamily: 'inherit', flexShrink: 0,
                              }}
                            >{alreadyIn ? '추가됨' : '+ 추가'}</button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
