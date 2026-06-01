import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { googleLogout } from '@react-oauth/google';
import CommonHeader from './components/CommonHeader';
import GallerySearchBox from './components/GallerySearchBox';
import RegionGallery from './components/RegionGallery';
import RegionModal from './components/RegionModal';
import { defaultRegions } from './data/defaultRegions';
import TripPlannerPage from './pages/TripPlannerPage';
import MyPage from './pages/MyPage';
import { normalizeRegionMediaFields, resolveBackendMediaUrl } from './utils/apiMediaUrl';
import ContactModal from './components/ContactModal';
import { addScrap, fetchScraps, removeScrap } from './utils/api';

const DEFAULT_REGIONS_NORMALIZED = defaultRegions.map((r) =>
  normalizeRegionMediaFields({ ...r }),
);

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';
const FEED_SIZE = 9;
const GALLERY_VECTOR_ACTIVE_KEY = 'lv_gallery_vector_active';
const GALLERY_SEARCH_RESULTS_KEY = 'lv_gallery_search_results';
const SIDEBAR_WIDTH_KEY = 'lv_sidebar_width';
const SIDEBAR_WIDTH_DEFAULT = 210;
const SIDEBAR_WIDTH_MIN = 170;
const SIDEBAR_WIDTH_MAX = 360;

function readInitialSidebarWidth() {
  try { const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY); const n = Number(raw); return Number.isFinite(n) ? Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(n))) : SIDEBAR_WIDTH_DEFAULT; } catch { return SIDEBAR_WIDTH_DEFAULT; }
}
function isGalleryVectorFeedLocked() { try { return sessionStorage.getItem(GALLERY_VECTOR_ACTIVE_KEY) === '1'; } catch { return false; } }
function readPersistedGalleryRegions() {
  try {
    if (sessionStorage.getItem(GALLERY_VECTOR_ACTIVE_KEY) !== '1') return null;
    const raw = sessionStorage.getItem(GALLERY_SEARCH_RESULTS_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return arr.map((r) => normalizeRegionMediaFields({ ...r }));
  } catch {
    return null;
  }
}
function persistGalleryVectorResults(mapped) { try { sessionStorage.setItem(GALLERY_VECTOR_ACTIVE_KEY, '1'); sessionStorage.setItem(GALLERY_SEARCH_RESULTS_KEY, JSON.stringify(mapped)); } catch {} }

const REGION_TREE = [
  { id: 'metro',       label: '수도권', children: ['서울', '경기', '인천'] },
  { id: 'gangwon',     label: '강원',   children: ['강릉', '춘천', '원주', '속초'] },
  { id: 'chungcheong', label: '충청',   children: ['대전', '청주', '천안', '충주'] },
  { id: 'jeolla',      label: '전라',   children: ['광주', '전주', '여수', '순천', '목포'] },
  { id: 'gyeongsang',  label: '경상',   children: ['부산', '대구', '경주', '울산', '포항'] },
  { id: 'jeju',        label: '제주',   children: ['제주시', '서귀포'] },
];

const PAGE_INFO = {
  gallery: { title: '지역 갤러리',   subtitle: 'AI 기반으로 숨은 로컬 스팟을 찾아드려요.' },
  planner: { title: '여행 플래너',   subtitle: '챗봇과 함께 나만의 여행 일정을 만들어보세요.' },
  mypage:  { title: '마이페이지',    subtitle: '스크랩한 장소와 내 여행 일정을 관리하세요.' },
};

function normalizeTextKey(v) { return String(v || '').toLowerCase().replace(/\s+/g, '').trim(); }
function normalizeImageKey(u) { const v = String(u || '').trim().toLowerCase(); return v ? v.replace(/^https?:/, '') : ''; }

function pickFeedItems(items, size = FEED_SIZE) {
  if (!Array.isArray(items) || !items.length) return [];
  const shuffled = [...items].sort(() => Math.random() - 0.5);
  const picked = [], usedImg = new Set(), usedName = new Set();
  for (const item of shuffled) {
    const nk = normalizeTextKey(item?.name), ik = normalizeImageKey(item?.imageUrl);
    if (!nk || usedName.has(nk) || (ik && usedImg.has(ik))) continue;
    picked.push(item); usedName.add(nk); if (ik) usedImg.add(ik);
    if (picked.length >= size) return picked;
  }
  for (const item of shuffled) { const nk = normalizeTextKey(item?.name); if (!nk || usedName.has(nk)) continue; picked.push(item); usedName.add(nk); if (picked.length >= size) break; }
  return picked.slice(0, size);
}

function mapSearchHitToRegion(row, regionMap) {
  const id = Number(row.place_id), base = regionMap.get(id);
  const sim = row.pinecone_similarity != null ? `유사도 ${Number(row.pinecone_similarity).toFixed(3)}` : '';
  return { id, name: row.name || base?.name || '이름 없음', imageUrl: base?.imageUrl || '', summary: base?.summary || [row.category, row.region, sim].filter(Boolean).join(' · ') || '상세 설명이 없습니다.', summaryShort: sim || base?.summaryShort, address: base?.address, latitude: base?.latitude, longitude: base?.longitude, region: row.region || base?.region, province: row.province || base?.province, dataSource: base?.dataSource, sourceId: base?.sourceId, recommendedBusinesses: base?.recommendedBusinesses?.length > 0 ? base.recommendedBusinesses : row.category ? [row.category] : [], busyHours: base?.busyHours || [], targetCustomers: base?.targetCustomers || [] };
}

// 여행 선택 모달
function TripSelectModal({ myTrips, onSelect, onCreateNew, onClose }) {
  return (
    <div className="trip-select-backdrop" onClick={onClose}>
      <div className="trip-select-modal" onClick={e => e.stopPropagation()}>
        <div className="trip-select-header">
          <h2 className="trip-select-title">어떤 여행에 담을까요?</h2>
          <button type="button" className="trip-select-close" onClick={onClose}>✕</button>
        </div>
        <div className="trip-select-body">
          {myTrips.length === 0
            ? <p style={{ textAlign: 'center', color: '#aaa', fontSize: 13, padding: '16px 0', margin: 0 }}>아직 만든 여행이 없어요.</p>
            : myTrips.map(trip => (
              <button key={trip.id} type="button" className="trip-select-item" onClick={() => onSelect(trip.id)}>
                <div style={{ textAlign: 'left' }}>
                  <div className="trip-select-item-name">{trip.name}</div>
                  <div className="trip-select-item-count">{trip.places.length}개 장소 · {new Date(trip.createdAt).toLocaleDateString('ko-KR')}</div>
                </div>
                <span style={{ fontSize: 16, color: '#ccc' }}>›</span>
              </button>
            ))
          }
        </div>
        <div className="trip-select-footer">
          <button type="button" className="trip-select-new-btn" onClick={onCreateNew}>+ 새 여행 만들고 담기</button>
        </div>
      </div>
    </div>
  );
}

// 사이드바 계정 영역
function SidebarAccount({ currentUser, onAccountClick, onLoginClick }) {
  if (currentUser) {
    return (
      <button type="button" className="sidebar-account-card" onClick={onAccountClick} title="계정 메뉴" style={{ cursor: 'pointer', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: 0, fontFamily: 'inherit' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          {currentUser.picture
            ? <img src={currentUser.picture} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '1px solid #eee' }} />
            : <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 11, color: '#555', flexShrink: 0 }}>{String(currentUser.name || 'U').slice(0, 1).toUpperCase()}</div>
          }
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentUser.name || '사용자'}</div>
            <div style={{ fontSize: 10, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentUser.email}</div>
          </div>
        </div>
        <span style={{ fontSize: 13, color: '#bbb', flexShrink: 0 }}>⋯</span>
      </button>
    );
  }
  // 미로그인 — 임시 프로필
  return (
    <button type="button" className="sidebar-account-guest" onClick={onLoginClick}>
      <div className="sidebar-account-guest-avatar">👤</div>
      <div className="sidebar-account-guest-text">
        <span className="sidebar-account-guest-name">로그인이 필요해요</span>
        <span className="sidebar-account-guest-sub">클릭해서 시작하기</span>
      </div>
    </button>
  );
}

export default function App() {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState(() => { try { const raw = localStorage.getItem('lv_user'); return raw ? JSON.parse(raw) : null; } catch { return null; } });
  const [regions, setRegions] = useState(DEFAULT_REGIONS_NORMALIZED);
  const [displayedRegions, setDisplayedRegions] = useState(() => readPersistedGalleryRegions() ?? DEFAULT_REGIONS_NORMALIZED);
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [insightRegion, setInsightRegion] = useState(null);
  const [isInsightLoading, setIsInsightLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('gallery');
  const [scrappedIds, setScrappedIds] = useState(() => { try { const p = JSON.parse(localStorage.getItem('lv_scraps') || '[]'); return Array.isArray(p) ? p : []; } catch { return []; } });
  const [contactOpen, setContactOpen] = useState(false);
  const [myTrips, setMyTrips] = useState(() => { try { const p = JSON.parse(localStorage.getItem('lv_my_trips') || '[]'); return Array.isArray(p) ? p : []; } catch { return []; } });
  const [modalCrawlImages, setModalCrawlImages] = useState([]);
  const [modalArticle, setModalArticle] = useState(null);
  const [modalArticleLoading, setModalArticleLoading] = useState(false);
  const [gallerySearchBusy, setGallerySearchBusy] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(readInitialSidebarWidth);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [openRegions, setOpenRegions] = useState({});
  const [accountPopupOpen, setAccountPopupOpen] = useState(false);
  const [tripSelectRegion, setTripSelectRegion] = useState(null);
  const [chatbotOpen, setChatbotOpen] = useState(false);
  const [chatbotMessages, setChatbotMessages] = useState([{ role: 'assistant', text: '안녕하세요! 어떤 장소를 찾고 계신가요?\n예: 여자친구랑 감성 카페, 가족 당일치기' }]);
  const [chatbotInput, setChatbotInput] = useState('');
  const [chatbotBusy, setChatbotBusy] = useState(false);
  const chatMessagesRef = useRef(null);
  const accountAreaRef = useRef(null);
  const galleryVectorSearchActiveRef = useRef(isGalleryVectorFeedLocked());
  const gallerySearchSeqRef = useRef(0);

  useEffect(() => { const sync = () => { try { const raw = localStorage.getItem('lv_user'); setCurrentUser(raw ? JSON.parse(raw) : null); } catch { setCurrentUser(null); } }; window.addEventListener('lv-auth-changed', sync); return () => window.removeEventListener('lv-auth-changed', sync); }, []);

  useEffect(() => { let m = true; fetch(`${API_BASE_URL}/api/regions`).then(r => r.ok ? r.json() : null).then(data => { if (!m || !Array.isArray(data?.regions) || !data.regions.length) return; const normalized = data.regions.map((r) => normalizeRegionMediaFields({ ...r })); setRegions(normalized); if (!galleryVectorSearchActiveRef.current && !isGalleryVectorFeedLocked()) setDisplayedRegions(pickFeedItems(normalized)); }).catch(() => { if (!galleryVectorSearchActiveRef.current && !isGalleryVectorFeedLocked()) setDisplayedRegions(pickFeedItems(DEFAULT_REGIONS_NORMALIZED)); }); return () => { m = false; }; }, []);

  useEffect(() => { let m = true; if (!selectedRegion?.id) { setInsightRegion(null); return; } setIsInsightLoading(true); fetch(`${API_BASE_URL}/api/regions/${selectedRegion.id}/insight`).then(r => r.ok ? r.json() : null).then(data => { if (m && data?.region) setInsightRegion(normalizeRegionMediaFields({ ...data.region })); }).catch(() => {}).finally(() => { if (m) setIsInsightLoading(false); }); return () => { m = false; }; }, [selectedRegion]);

  useEffect(() => {
    const id = selectedRegion?.id; if (!id) { setModalCrawlImages([]); setModalArticle(null); setModalArticleLoading(false); return; }
    let cancelled = false; setModalCrawlImages([]); setModalArticle(null); setModalArticleLoading(true);
    (async () => {
      try {
        await fetch(`${API_BASE_URL}/api/places/${id}/crawl`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); if (cancelled) return;
        const imgRes = await fetch(`${API_BASE_URL}/api/places/${id}/images`); if (imgRes.ok && !cancelled) { const d = await imgRes.json(); setModalCrawlImages((d.images || []).map(x => x.url).filter(Boolean).map(u => resolveBackendMediaUrl(u))); }
        if (cancelled) return; const artRes = await fetch(`${API_BASE_URL}/api/places/${id}/article`); if (cancelled) return;
        if (artRes.ok) { const a = await artRes.json(); if (!cancelled) setModalArticle({ title: a.title || '', content: a.content || '' }); }
        else if (!cancelled) setModalArticle(null); // 실패 시 null → 모달에서 하드코딩 아티클 표시
      } catch { if (!cancelled) setModalArticle(null); } // 실패 시 null → 하드코딩 폴백
      finally { if (!cancelled) setModalArticleLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [selectedRegion?.id]);

  useEffect(() => { if (chatMessagesRef.current) chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight; }, [chatbotMessages, chatbotBusy]);

  useEffect(() => {
    if (!accountPopupOpen) return;
    const handler = (e) => { if (accountAreaRef.current && !accountAreaRef.current.contains(e.target)) setAccountPopupOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [accountPopupOpen]);

  // 로그인 시 서버 스크랩 목록으로 동기화
  useEffect(() => {
    const token = localStorage.getItem('lv_access_token');
    if (!token) return;
    fetchScraps()
      .then(ids => {
        if (ids.length > 0) {
          setScrappedIds(ids);
          localStorage.setItem('lv_scraps', JSON.stringify(ids));
        }
      })
      .catch(() => {}); // 실패 시 localStorage 유지
  }, [currentUser]); // 로그인 상태 변경 시 재실행

  const handleSidebarResizePointerDown = useCallback((e) => {
    if (e.button !== 0) return; e.preventDefault();
    const startX = e.clientX, startW = sidebarWidth; let lastW = startW;
    const onMove = ev => { lastW = Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(startW + ev.clientX - startX))); setSidebarWidth(lastW); };
    const end = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', end); document.body.style.cursor = ''; document.body.style.userSelect = ''; try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(lastW)); } catch {} };
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', end);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  }, [sidebarWidth]);

  const regionMap = useMemo(() => new Map(regions.map(r => [r.id, r])), [regions]);

  const galleryDisplayRegions = useMemo(() => displayedRegions.map(r => {
    const id = Number(r?.id); if (!Number.isFinite(id)) return r;
    const base = regionMap.get(id); if (!base) return r;
    const s = r.summary && String(r.summary).trim() && r.summary !== '상세 설명이 없습니다.' ? r.summary : base.summary || r.summary;
    return { ...r, imageUrl: base.imageUrl || r.imageUrl || '', summary: s, address: r.address || base.address, latitude: r.latitude ?? base.latitude, longitude: r.longitude ?? base.longitude, province: r.province || base.province };
  }), [displayedRegions, regionMap]);

  const handleGalleryVectorSearch = useCallback(async (q) => {
    const trimmed = String(q || '').trim(); if (!trimmed) return false;
    const seq = ++gallerySearchSeqRef.current; setGallerySearchBusy(true);
    try {
      const url = new URL(`${API_BASE_URL}/api/search`); url.searchParams.set('q', trimmed);
      const res = await fetch(url.toString()); if (seq !== gallerySearchSeqRef.current) return false;
      if (!res.ok) { window.alert('검색 요청에 실패했습니다.'); return false; }
      const data = await res.json();
      const mapped = (Array.isArray(data?.results) ? data.results : []).map(row =>
        normalizeRegionMediaFields(mapSearchHitToRegion(row, regionMap)),
      );
      if (seq !== gallerySearchSeqRef.current) return false;
      if (mapped.length > 0) { galleryVectorSearchActiveRef.current = true; persistGalleryVectorResults(mapped); setDisplayedRegions(mapped); return true; }
      window.alert('검색 결과가 없습니다.'); return false;
    } catch { if (seq === gallerySearchSeqRef.current) window.alert('네트워크 오류입니다.'); return false; }
    finally { if (seq === gallerySearchSeqRef.current) setGallerySearchBusy(false); }
  }, [regionMap]);

  const handleChatbotSubmit = async (e) => {
    e.preventDefault(); const msg = chatbotInput.trim(); if (!msg || chatbotBusy) return;
    setChatbotMessages(prev => [...prev, { role: 'user', text: msg }]); setChatbotInput(''); setChatbotBusy(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg }) });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setChatbotMessages(prev => [...prev, { role: 'assistant', text: data.answer || '추천이 완료됐어요!' }]);
      if (Array.isArray(data.recommendedRegionIds) && data.recommendedRegionIds.length > 0) {
        const newRegions = data.recommendedRegionIds.map(id => regionMap.get(Number(id))).filter(Boolean);
        if (newRegions.length > 0) setDisplayedRegions(newRegions);
      }
    } catch { setChatbotMessages(prev => [...prev, { role: 'assistant', text: '오류가 발생했어요.' }]); }
    finally { setChatbotBusy(false); }
  };

  const handleToggleScrap = useCallback(async (regionId) => {
    const token = localStorage.getItem('lv_access_token');
    const isCurrentlyScrapped = scrappedIds.includes(regionId); // 낙관적 업데이트 전에 먼저 체크

    setScrappedIds(prev => {
      const next = isCurrentlyScrapped
        ? prev.filter(id => id !== regionId)
        : [...prev, regionId];
      localStorage.setItem('lv_scraps', JSON.stringify(next));
      return next;
    });

    if (token) {
      try {
        if (isCurrentlyScrapped) {
          await removeScrap(regionId);
        } else {
          await addScrap(regionId);
        }
      } catch {
        // 롤백
        setScrappedIds(prev => {
          const next = isCurrentlyScrapped
            ? [...prev, regionId]
            : prev.filter(id => id !== regionId);
          localStorage.setItem('lv_scraps', JSON.stringify(next));
          return next;
        });
      }
    }
  }, [scrappedIds]);

  const handleRequestAddToTrip = useCallback((region) => { setTripSelectRegion(region); }, []);

  const handleAddToSpecificTrip = useCallback((tripId) => {
    if (!tripSelectRegion) return;
    const region = tripSelectRegion;
    setMyTrips(prev => {
      const trip = prev.find(t => t.id === tripId); if (!trip) return prev;
      if (trip.places.some(p => p.id === region.id)) { window.alert('이미 담긴 장소예요!'); return prev; }
      const next = prev.map(t => t.id === tripId ? { ...t, places: [...t.places, region] } : t);
      localStorage.setItem('lv_my_trips', JSON.stringify(next)); return next;
    });
    setTripSelectRegion(null);
    window.alert(`"${region.name}"을(를) 여행에 담았어요!`);
  }, [tripSelectRegion]);

  const handleCreateNewTripAndAdd = useCallback(() => {
    if (!tripSelectRegion) return;
    const region = tripSelectRegion;
    const tripName = prompt('새 여행 이름을 입력하세요:', `여행 ${new Date().toLocaleDateString('ko-KR')}`);
    if (!tripName?.trim()) return;
    const newTrip = { id: Date.now(), name: tripName.trim(), createdAt: new Date().toISOString(), places: [region] };
    setMyTrips(prev => { const next = [...prev, newTrip]; localStorage.setItem('lv_my_trips', JSON.stringify(next)); return next; });
    setTripSelectRegion(null);
    window.alert(`"${region.name}"을(를) "${tripName.trim()}"에 담았어요!`);
  }, [tripSelectRegion]);

  const handleLogout = () => {
    googleLogout(); localStorage.removeItem('lv_access_token'); localStorage.removeItem('lv_user');
    window.dispatchEvent(new Event('lv-auth-changed')); setAccountPopupOpen(false);
  };

  const scrappedRegions = useMemo(() => regions.filter(r => scrappedIds.includes(r.id)), [regions, scrappedIds]);
  const currentPage = PAGE_INFO[activeTab] || PAGE_INFO.gallery;
  const effectiveSidebarWidth = sidebarOpen ? sidebarWidth : 0;

  return (
    <div className="app-page">
      <CommonHeader onTabChange={setActiveTab} />

      {/* 사이드바 토글 — 화면 중앙 세로, 얇고 깔끔 */}
      <button
        type="button"
        className="sidebar-toggle-btn"
        style={{ left: effectiveSidebarWidth }}
        onClick={() => setSidebarOpen(o => !o)}
        aria-label={sidebarOpen ? '사이드바 닫기' : '사이드바 열기'}
      >
        {sidebarOpen ? '‹' : '›'}
      </button>

      <div className="app-layout">
        {/* ── 사이드바 ── */}
        <aside
          className={`app-sidebar${sidebarOpen ? '' : ' collapsed'}`}
          style={{
            width: effectiveSidebarWidth,
            minWidth: sidebarOpen ? SIDEBAR_WIDTH_MIN : 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* 메뉴 */}
          <div className="sidebar-scroll-area">
            <div className="sidebar-section-title">메인</div>
            <button className="sidebar-link" type="button" onClick={() => navigate('/')}>🏠 시작</button>
            <button className={`sidebar-link${activeTab === 'gallery' ? ' active' : ''}`} type="button" onClick={() => setActiveTab('gallery')}>🗺 지역 갤러리</button>
            <button className={`sidebar-link${activeTab === 'planner' ? ' active' : ''}`} type="button" onClick={() => setActiveTab('planner')}>✈ 여행 플래너</button>
            <button className={`sidebar-link${activeTab === 'mypage' ? ' active' : ''}`} type="button" onClick={() => setActiveTab('mypage')}>👤 마이페이지</button>

            <div className="sidebar-section-title" style={{ marginTop: 14 }}>지역</div>
            {REGION_TREE.map(r => (
              <div key={r.id}>
                <button className="sidebar-link" type="button" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} onClick={() => setOpenRegions(prev => ({ ...prev, [r.id]: !prev[r.id] }))}>
                  <span>📍 {r.label}</span>
                  <span style={{ fontSize: 9, color: '#bbb', display: 'inline-block', transition: 'transform 150ms', transform: openRegions[r.id] ? 'rotate(180deg)' : 'none' }}>▼</span>
                </button>
                {openRegions[r.id] && (
                  <div style={{ paddingLeft: 8 }}>
                    {r.children.map(city => (
                      <button key={city} className="sidebar-link" type="button" style={{ fontSize: 12, color: '#777', paddingLeft: 18 }} onClick={() => { handleGalleryVectorSearch(city); setActiveTab('gallery'); }}>
                        {city}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            <div className="sidebar-section-title" style={{ marginTop: 14 }}>정보</div>
            <div className="sidebar-static-link">💡 서비스 소개</div>
            <button
              type="button"
              className="sidebar-link"
              onClick={() => setContactOpen(true)}
            >
              📬 문의하기
            </button>

          </div>

          {/* ── 하단 계정 영역 ── */}
          <div className="sidebar-account-area" ref={accountAreaRef} style={{ position: 'relative' }}>
            {/* 팝업 — 위로 열림 */}
            {accountPopupOpen && currentUser && (
              <div className="sidebar-account-popup">
                <div className="sidebar-account-popup-header">
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#111', marginBottom: 1 }}>{currentUser.name || '사용자'}</div>
                  <div className="sidebar-account-popup-email">{currentUser.email}</div>
                </div>
                <button type="button" className="sidebar-account-popup-item" onClick={() => { setAccountPopupOpen(false); }}>
                  <span style={{ fontSize: 14 }}>⚙️</span> 설정
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: '#bbb' }}>준비중</span>
                </button>
                <button type="button" className="sidebar-account-popup-item" onClick={() => { setAccountPopupOpen(false); }}>
                  <span style={{ fontSize: 14 }}>🌐</span> 언어
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: '#bbb' }}>준비중</span>
                </button>
                <button type="button" className="sidebar-account-popup-item" onClick={() => { setAccountPopupOpen(false); }}>
                  <span style={{ fontSize: 14 }}>❓</span> 도움 받기
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: '#bbb' }}>준비중</span>
                </button>
                <div className="sidebar-account-popup-divider" />
                <button type="button" className="sidebar-account-popup-item danger" onClick={handleLogout}>
                  <span style={{ fontSize: 14 }}>🚪</span> 로그아웃
                </button>
              </div>
            )}

            <SidebarAccount
              currentUser={currentUser}
              onAccountClick={() => setAccountPopupOpen(o => !o)}
              onLoginClick={() => navigate('/login')}
            />
          </div>
        </aside>

        {sidebarOpen && (
          <div className="app-sidebar-resizer" role="separator" aria-orientation="vertical" tabIndex={0} onPointerDown={handleSidebarResizePointerDown} />
        )}

        {/* ── 메인 ── */}
        <main className="app-shell">
          {/* 통일된 페이지 헤더 */}
          <div className="page-header">
            <h1 className="page-title">{currentPage.title}</h1>
            <p className="page-subtitle">{currentPage.subtitle}</p>
          </div>

          {activeTab === 'gallery' && (
            <>
              <div className="gallery-search-center">
                <GallerySearchBox onSearch={handleGalleryVectorSearch} busy={gallerySearchBusy} placeholder="예: 여수 야경 맛집, 조용한 감성 카페, 부산 당일치기" />
              </div>
              <RegionGallery
                regions={galleryDisplayRegions.slice(0, FEED_SIZE)}
                scrappedIds={scrappedIds}
                onToggleScrap={handleToggleScrap}
                onAddToTrip={handleRequestAddToTrip}
                onSelect={region => { setSelectedRegion(region); setInsightRegion(null); }}
              />
            </>
          )}
          {activeTab === 'planner' && (
            <TripPlannerPage
              regions={regions}
              scrappedIds={scrappedIds}
              onToggleScrap={handleToggleScrap}
              onAddToTrip={handleRequestAddToTrip}   // ← 추가
            />
          )}
          {activeTab === 'mypage' && (
            <MyPage
              scrappedRegions={scrappedRegions}
              myTrips={myTrips}
              setMyTrips={(next) => { setMyTrips(next); localStorage.setItem('lv_my_trips', JSON.stringify(next)); }}
              onToggleScrap={handleToggleScrap}
              onOpenRegion={region => { setSelectedRegion(region); setInsightRegion(null); }}
              onAddToTrip={handleRequestAddToTrip}
              regions={regions}
            />
          )}

          <footer className="main-footer">
            <div className="main-footer-top">
              <div><div className="main-footer-brand">LocalVibe</div><div className="main-footer-desc">Discover real local stories with AI.</div></div>
              <div className="main-footer-links"><span>Core Features</span><span>Pro Experience</span><span>Contact</span><span>Join</span></div>
            </div>
            <div className="main-footer-bottom">© {new Date().getFullYear()} LocalVibe. All rights reserved.</div>
          </footer>
        </main>
      </div>

      {/* 플로팅 챗봇 */}
      {activeTab === 'gallery' && (
        <>
          {chatbotOpen && (
            <div className="chatbot-float-panel">
              <div className="chatbot-float-header">
                <span style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>🤖 AI 장소 추천</span>
                <button type="button" onClick={() => setChatbotOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: 15, lineHeight: 1 }}>✕</button>
              </div>
              <div className="chatbot-float-messages" ref={chatMessagesRef}>
                {chatbotMessages.map((m, i) => <div key={i} className={`chatbot-float-msg ${m.role}`}>{m.text}</div>)}
                {chatbotBusy && <div className="chatbot-float-msg assistant"><span className="chatbot-skeleton-dot" /><span className="chatbot-skeleton-dot" /><span className="chatbot-skeleton-dot" /></div>}
              </div>
              <form className="chatbot-float-form" onSubmit={handleChatbotSubmit}>
                <input className="chatbot-float-input" type="text" value={chatbotInput} onChange={e => setChatbotInput(e.target.value)} placeholder="분위기 좋은 카페..." disabled={chatbotBusy} autoFocus />
                <button type="submit" className="chatbot-float-send" disabled={chatbotBusy || !chatbotInput.trim()}>→</button>
              </form>
            </div>
          )}
          <button type="button" className="chatbot-fab" onClick={() => setChatbotOpen(o => !o)} aria-label="AI 추천">
            {chatbotOpen ? '✕' : '🤖'}
          </button>
        </>
      )}

      {/* 여행 선택 모달 */}
      {tripSelectRegion && (
        <TripSelectModal
          myTrips={myTrips}
          onSelect={handleAddToSpecificTrip}
          onCreateNew={handleCreateNewTripAndAdd}
          onClose={() => setTripSelectRegion(null)}
        />
      )}

      {/* 장소 모달 */}
      <RegionModal
        region={insightRegion || selectedRegion}
        isLoading={isInsightLoading}
        apiBaseUrl={API_BASE_URL}
        crawlImageUrls={modalCrawlImages}
        article={modalArticle}
        articleLoading={modalArticleLoading}
        scrappedIds={scrappedIds}
        onToggleScrap={handleToggleScrap}
        onAddToTrip={handleRequestAddToTrip}
        onClose={() => { setSelectedRegion(null); setInsightRegion(null); setModalCrawlImages([]); setModalArticle(null); setModalArticleLoading(false); }}
      />
      
      {/* 문의하기 모달 */}
      <ContactModal isOpen={contactOpen} onClose={() => setContactOpen(false)} />
    </div>
  );
}
