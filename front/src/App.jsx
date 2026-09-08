import { memo, useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import CommonHeader from './components/CommonHeader';
import GallerySearchBox from './components/GallerySearchBox';
import RegionGallery from './components/RegionGallery';
import RegionModal from './components/RegionModal';
import TripPlannerPage from './pages/TripPlannerPage';
import TripSelectModal from './components/TripSelectModal';
import MyPage from './pages/MyPage';
import ContactPage from './pages/ContactPage';
import CommunityPage from './pages/CommunityPage';
import {
  normalizeRegionMediaFields,
  resolveBackendMediaUrl,
} from './utils/apiMediaUrl';
import { API_BASE_URL } from './shared/api/client';
import { useAuth } from './shared/auth/AuthContext';
import { useScraps } from './features/scraps/ScrapsContext';
import { useTrips } from './features/trips/TripsContext';
import {
  useGalleryFeed,
  feedHasDisplayImages,
} from './features/gallery/useGalleryFeed';

const SIDEBAR_WIDTH_KEY = 'lv_sidebar_width';
const SIDEBAR_WIDTH_DEFAULT = 210;
const SIDEBAR_WIDTH_MIN = 170;
const SIDEBAR_WIDTH_MAX = 360;

function readInitialSidebarWidth() {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    const n = Number(raw);
    return Number.isFinite(n)
      ? Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(n)))
      : SIDEBAR_WIDTH_DEFAULT;
  } catch {
    return SIDEBAR_WIDTH_DEFAULT;
  }
}

const REGION_TREE = [
  { id: 'metro', label: '수도권', children: ['서울', '경기', '인천'] },
  {
    id: 'gangwon',
    label: '강원특별자치도',
    regionFilter: '강원특별자치도',
    children: ['강릉', '춘천', '원주', '속초'],
  },
  {
    id: 'chungcheong',
    label: '충청',
    children: ['대전', '청주', '천안', '충주'],
  },
  {
    id: 'jeonbuk',
    label: '전북특별자치도',
    regionFilter: '전북특별자치도',
    children: ['전주', '군산', '익산', '남원'],
  },
  {
    id: 'jeonnam',
    label: '전라남도',
    children: ['광주', '여수', '순천', '목포'],
  },
  {
    id: 'gyeongsang',
    label: '경상',
    children: ['부산', '대구', '경주', '울산', '포항'],
  },
  { id: 'jeju', label: '제주', children: ['제주시', '서귀포'] },
];

/** URL(?tab=)과 주고받는 탭 목록. */
const VALID_TABS = ['gallery', 'planner', 'community', 'mypage', 'contact'];

function readTabFromSearch(search) {
  const tab = new URLSearchParams(search).get('tab');
  return VALID_TABS.includes(tab) ? tab : 'gallery';
}

const PAGE_INFO = {
  gallery: { title: '갤러리', subtitle: '' },
  planner: {
    title: '여행 플래너',
    subtitle:
      '챗봇과 함께 나만의 여행 일정을 만들어보세요. 채팅·검색으로 채우고 드래그로 순서·일차를 조정하세요.',
  },
  mypage: {
    title: '마이페이지',
    subtitle: '스크랩한 장소와 내 여행 일정을 관리하세요.',
  },
  community: {
    title: '커뮤니티',
    subtitle: '광주·전남의 장소를 다녀온 사람들의 이야기.',
  },
  contact: {
    title: '문의하기',
    subtitle: '궁금한 점이나 불편한 점을 알려주세요.',
  },
};

function SidebarAccount({ currentUser, onAccountClick, onLoginClick }) {
  if (currentUser) {
    return (
      <button
        type="button"
        className="sidebar-account-card"
        onClick={onAccountClick}
        title="계정 메뉴"
        style={{
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
          background: 'none',
          border: 'none',
          padding: 0,
          fontFamily: 'inherit',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flex: 1,
            minWidth: 0,
          }}
        >
          {currentUser.picture ? (
            <img
              src={currentUser.picture}
              alt=""
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                objectFit: 'cover',
                flexShrink: 0,
                border: '1px solid #eee',
              }}
              referrerPolicy="no-referrer"
              onError={e => {
                e.currentTarget.style.display = 'none';
              }}
            />
          ) : (
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: '#f0f0f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: 11,
                color: '#555',
                flexShrink: 0,
              }}
            >
              {String(currentUser.name || 'U')
                .slice(0, 1)
                .toUpperCase()}
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: '#111',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {currentUser.name || '사용자'}
            </div>
            <div
              style={{
                fontSize: 10,
                color: '#888',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {currentUser.email}
            </div>
          </div>
        </div>
        <span style={{ fontSize: 13, color: '#bbb', flexShrink: 0 }}>⋯</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      className="sidebar-account-guest"
      onClick={onLoginClick}
    >
      <div className="sidebar-account-guest-avatar">👤</div>
      <div className="sidebar-account-guest-text">
        <span className="sidebar-account-guest-name">로그인이 필요해요</span>
        <span className="sidebar-account-guest-sub">클릭해서 시작하기</span>
      </div>
    </button>
  );
}

const MemoTripPlannerPage = memo(TripPlannerPage);

function GallerySearchSkeleton() {
  return (
    <section className="gallery-scroll-area gallery-skeleton-area" aria-label="검색 결과 불러오는 중">
      <div className="region-grid">
        {Array.from({ length: 6 }, (_, index) => (
          <article className="gallery-skeleton-card" key={index}>
            <div className="gallery-skeleton-image" />
            <div className="gallery-skeleton-content">
              <div className="gallery-skeleton-title" />
              <div className="gallery-skeleton-summary" />
              <div className="gallery-skeleton-summary gallery-skeleton-summary-short" />
              <div className="gallery-skeleton-link" />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();

  // ── Context 훅 ──────────────────────────────────────────────────
  const { currentUser, logout } = useAuth();
  const { scrappedIds, toggleScrap: handleToggleScrap } = useScraps();
  const {
    myTrips,
    setMyTrips,
    requireLogin: requireLoginForTrips,
    onCreateTrip: handleCreateTrip,
    onDeleteTrip: handleDeleteTrip,
    onRenameTrip: handleRenameTrip,
    onReorderTripPlaces: handleReorderTripPlaces,
    onAddPlaceToTrip: handleAddPlaceToTrip,
    onRemovePlaceFromTrip: handleRemovePlaceFromTrip,
  } = useTrips();
  const {
    regions,
    regionMap,
    galleryDisplayRegions,
    feedLoading: galleryFeedLoading,
    searchBusy: gallerySearchBusy,
    handleVectorSearch: handleGalleryVectorSearch,
    handleSidebarRegionClick,
  } = useGalleryFeed();

  // ── 로컬 UI 상태 ─────────────────────────────────────────────────
  // 탭의 단일 소스는 URL(?tab=). state로 복제하면 두 값이 서로를 덮어쓰며
  // 무한 렌더가 발생하므로, 여기서는 파생만 하고 변경은 navigate로 한다.
  const activeTab = readTabFromSearch(location.search);

  const setActiveTab = useCallback(
    tab => {
      const params = new URLSearchParams(location.search);
      if (tab === 'gallery') params.delete('tab');
      else params.set('tab', tab);
      // 커뮤니티를 벗어나면 열려 있던 글도 함께 정리
      if (tab !== 'community') params.delete('post');
      const qs = params.toString();
      navigate(`${location.pathname}${qs ? `?${qs}` : ''}`);
    },
    [location.pathname, location.search, navigate],
  );
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [insightRegion, setInsightRegion] = useState(null);
  const [isInsightLoading, setIsInsightLoading] = useState(false);
  const [modalCrawlImages, setModalCrawlImages] = useState([]);
  const [modalArticle, setModalArticle] = useState(null);
  const [modalArticleLoading, setModalArticleLoading] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(readInitialSidebarWidth);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [openRegions, setOpenRegions] = useState({});
  const [accountPopupOpen, setAccountPopupOpen] = useState(false);
  const [tripSelectRegion, setTripSelectRegion] = useState(null);
  const accountAreaRef = useRef(null);
  const shellRef = useRef(null);

  // ── Effects ──────────────────────────────────────────────────────

  // 예전 방식(navigate(state:{tab}))으로 들어온 경우에만 URL로 옮겨준다.
  useEffect(() => {
    const tab = location.state?.tab;
    if (!VALID_TABS.includes(tab)) return;
    const params = new URLSearchParams(location.search);
    if (tab === 'gallery') params.delete('tab');
    else params.set('tab', tab);
    if (tab !== 'community') params.delete('post');
    const qs = params.toString();
    navigate(`${location.pathname}${qs ? `?${qs}` : ''}`, {
      replace: true,
      state: {},
    });
  }, [location.state, location.pathname, location.search, navigate]);

  // 탭 전환 시 콘텐츠 영역에 등장 애니메이션 재생.
  // 플래너는 계속 마운트해 두는 구조라 리마운트(key) 대신 클래스를 다시 붙여 재생한다.
  useEffect(() => {
    // 탭이 바뀌면 이전 탭에서 내려둔 스크롤이 남지 않도록 맨 위에서 시작한다.
    window.scrollTo({ top: 0 });

    const el = shellRef.current;
    if (!el) return;
    el.classList.remove('app-shell--switching');
    void el.offsetWidth; // 애니메이션 재시작을 위한 강제 reflow
    el.classList.add('app-shell--switching');
  }, [activeTab]);

  // 탭 전환 시 모달 초기화
  useEffect(() => {
    if (
      activeTab === 'planner' ||
      activeTab === 'contact' ||
      activeTab === 'community'
    ) {
      setSelectedRegion(null);
      setInsightRegion(null);
      setModalCrawlImages([]);
      setModalArticle(null);
      setModalArticleLoading(false);
    }
  }, [activeTab]);

  // 장소 선택 시 insight 로드
  useEffect(() => {
    let m = true;
    if (!selectedRegion?.id) {
      setInsightRegion(null);
      return;
    }
    setIsInsightLoading(true);
    fetch(`${API_BASE_URL}/api/regions/${selectedRegion.id}/insight`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (m && data?.region)
          setInsightRegion(normalizeRegionMediaFields({ ...data.region }));
      })
      .catch(() => {})
      .finally(() => {
        if (m) setIsInsightLoading(false);
      });
    return () => {
      m = false;
    };
  }, [selectedRegion]);

  // 장소 선택 시 이미지·아티클 로드
  useEffect(() => {
    const id = selectedRegion?.id;
    if (!id) {
      setModalCrawlImages([]);
      setModalArticle(null);
      setModalArticleLoading(false);
      return;
    }
    let cancelled = false;
    setModalCrawlImages([]);
    setModalArticle(null);
    setModalArticleLoading(true);
    (async () => {
      try {
        const imgRes = await fetch(`${API_BASE_URL}/api/places/${id}/images`);
        if (imgRes.ok && !cancelled) {
          const d = await imgRes.json();
          setModalCrawlImages(
            (d.images || [])
              .map(x => x.url)
              .filter(Boolean)
              .map(u => resolveBackendMediaUrl(u)),
          );
        }
        if (cancelled) return;
        const artRes = await fetch(`${API_BASE_URL}/api/places/${id}/article`);
        if (cancelled) return;
        if (artRes.ok) {
          const a = await artRes.json();
          if (!cancelled)
            setModalArticle({
              title: a.title || '',
              content: a.content || '',
              blocks: Array.isArray(a.blocks) ? a.blocks : [],
            });
        } else if (!cancelled) setModalArticle(null);
      } catch {
        if (!cancelled) setModalArticle(null);
      } finally {
        if (!cancelled) setModalArticleLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedRegion?.id]);

  // 계정 팝업 외부 클릭 닫기
  useEffect(() => {
    if (!accountPopupOpen) return;
    const handler = e => {
      if (accountAreaRef.current && !accountAreaRef.current.contains(e.target))
        setAccountPopupOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [accountPopupOpen]);

  // ── 핸들러 ───────────────────────────────────────────────────────

  const handleSidebarResizePointerDown = useCallback(
    e => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX,
        startW = sidebarWidth;
      let lastW = startW;
      const onMove = ev => {
        lastW = Math.min(
          SIDEBAR_WIDTH_MAX,
          Math.max(SIDEBAR_WIDTH_MIN, Math.round(startW + ev.clientX - startX)),
        );
        setSidebarWidth(lastW);
      };
      const end = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', end);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        try {
          localStorage.setItem(SIDEBAR_WIDTH_KEY, String(lastW));
        } catch {}
      };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', end);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {}
    },
    [sidebarWidth],
  );

  const handleRequestAddToTrip = useCallback(
    region => setTripSelectRegion(region),
    [],
  );

  const handleAddToSpecificTrip = useCallback(
    async tripId => {
      if (!tripSelectRegion) return;
      const region = tripSelectRegion;
      try {
        await handleAddPlaceToTrip(tripId, region);
        setTripSelectRegion(null);
        window.alert(`"${region.name}"을(를) 여행에 담았어요!`);
      } catch (err) {
        if (err?.message === 'not_logged_in') requireLoginForTrips();
        else window.alert('여행에 담기에 실패했습니다.');
      }
    },
    [tripSelectRegion, handleAddPlaceToTrip, requireLoginForTrips],
  );

  const handleCreateNewTripAndAdd = useCallback(async () => {
    if (!tripSelectRegion) return;
    const region = tripSelectRegion;
    const tripName = prompt(
      '새 여행 이름을 입력하세요:',
      `여행 ${new Date().toLocaleDateString('ko-KR')}`,
    );
    if (!tripName?.trim()) return;
    try {
      const trip = await handleCreateTrip(tripName.trim());
      if (!trip) return;
      await handleAddPlaceToTrip(trip.id, region);
      setTripSelectRegion(null);
      window.alert(`"${region.name}"을(를) "${tripName.trim()}"에 담았어요!`);
    } catch (err) {
      if (err?.message === 'not_logged_in') requireLoginForTrips();
      else window.alert('여행 만들기에 실패했습니다.');
    }
  }, [
    tripSelectRegion,
    handleCreateTrip,
    handleAddPlaceToTrip,
    requireLoginForTrips,
  ]);

  const handleLogout = useCallback(() => {
    logout();
    setAccountPopupOpen(false);
  }, [logout]);

  // ── 파생 값 ──────────────────────────────────────────────────────
  const scrappedRegions = useMemo(
    () => regions.filter(r => scrappedIds.includes(r.id)),
    [regions, scrappedIds],
  );
  const currentPage = PAGE_INFO[activeTab] || PAGE_INFO.gallery;
  const showSidebar = activeTab === 'contact' && sidebarOpen;
  const effectiveSidebarWidth = showSidebar ? sidebarWidth : 0;

  // ── JSX ──────────────────────────────────────────────────────────
  return (
    <div className="app-page">
      <CommonHeader onTabChange={setActiveTab} />

      <div className="app-layout">
        {showSidebar && (
          <aside
            className="app-sidebar"
            style={{
              width: effectiveSidebarWidth,
              minWidth: SIDEBAR_WIDTH_MIN,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div className="sidebar-scroll-area">
              <div className="sidebar-section-title" style={{ marginTop: 14 }}>
                지역
              </div>
              {REGION_TREE.map(r => (
                <div key={r.id}>
                  <button
                    className="sidebar-link sidebar-link--region"
                    type="button"
                    aria-expanded={Boolean(openRegions[r.id])}
                    onClick={() =>
                      setOpenRegions(prev => ({ ...prev, [r.id]: !prev[r.id] }))
                    }
                  >
                    <span className="sidebar-link-label">{r.label}</span>
                    <span
                      className={`sidebar-link-chevron${openRegions[r.id] ? ' is-open' : ''}`}
                      aria-hidden
                    >
                      ▼
                    </span>
                  </button>
                  {openRegions[r.id] && (
                    <div className="sidebar-children">
                      {r.children.map(city => (
                        <button
                          key={city}
                          className="sidebar-link sidebar-link--child"
                          type="button"
                          onClick={() => {
                            void handleSidebarRegionClick(city);
                            setActiveTab('gallery');
                          }}
                        >
                          {city}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <div className="sidebar-section-title" style={{ marginTop: 14 }}>
                정보
              </div>
              <button
                type="button"
                className="sidebar-link"
                onClick={() => navigate('/')}
              >
                서비스 소개
              </button>
              <button
                type="button"
                className={`sidebar-link${activeTab === 'contact' ? ' active' : ''}`}
                onClick={() => setActiveTab('contact')}
              >
                문의하기
              </button>
            </div>
          </aside>
        )}

        <main ref={shellRef} className="app-shell">
          {/* 콘텐츠가 한 화면을 채우게 해서, 로딩 중에도 푸터가 화면 안으로 올라오지 않게 한다. */}
          <div className="app-shell-content">
          {activeTab !== 'gallery' &&
            activeTab !== 'mypage' &&
            activeTab !== 'community' &&
            activeTab !== 'planner' && (
            <div
              className={`page-header${activeTab === 'contact' ? ' page-header--contact' : ''}`}
            >
              <h1 className="page-title">{currentPage.title}</h1>
              {currentPage.subtitle && (
                <p className="page-subtitle">{currentPage.subtitle}</p>
              )}
            </div>
          )}

          {activeTab === 'gallery' && (
            <>
              <div className="gallery-search-center">
                <GallerySearchBox
                  onSearch={handleGalleryVectorSearch}
                  busy={gallerySearchBusy}
                  placeholder="장소나 분위기를 검색해보세요"
                />
              </div>
              {gallerySearchBusy && (
                <GallerySearchSkeleton />
              )}
              {galleryFeedLoading &&
                !gallerySearchBusy &&
                !feedHasDisplayImages(galleryDisplayRegions) && (
                  <p className="gallery-feed-loading" aria-live="polite">
                    장소를 불러오는 중…
                  </p>
                )}
              {!gallerySearchBusy && (
                <div className="gallery-results-fade">
                  <RegionGallery
                    regions={galleryDisplayRegions}
                    scrappedIds={scrappedIds}
                    onToggleScrap={handleToggleScrap}
                    onAddToTrip={handleRequestAddToTrip}
                    onSelect={region => {
                      setSelectedRegion(region);
                      setInsightRegion(null);
                    }}
                  />
                </div>
              )}
            </>
          )}

          <div
            className={
              activeTab === 'planner'
                ? 'trip-planner-mount'
                : 'trip-planner-mount trip-planner-mount--hidden'
            }
            aria-hidden={activeTab !== 'planner'}
          >
            <MemoTripPlannerPage
              regionMap={regionMap}
              scrappedIds={scrappedIds}
              onToggleScrap={handleToggleScrap}
              currentUser={currentUser}
              myTrips={myTrips}
              onMyTripsChange={setMyTrips}
              onRequireLogin={requireLoginForTrips}
            />
          </div>

          {activeTab === 'contact' && <ContactPage />}

          {activeTab === 'community' && <CommunityPage />}

          {activeTab === 'mypage' && (
            <MyPage
              scrappedRegions={scrappedRegions}
              isLoggedIn={Boolean(currentUser)}
              myTrips={myTrips}
              onCreateTrip={handleCreateTrip}
              onDeleteTrip={handleDeleteTrip}
              onRenameTrip={handleRenameTrip}
              onReorderTripPlaces={handleReorderTripPlaces}
              onAddPlaceToTrip={handleAddPlaceToTrip}
              onRemovePlaceFromTrip={handleRemovePlaceFromTrip}
              onToggleScrap={handleToggleScrap}
              onOpenRegion={region => {
                setSelectedRegion(region);
                setInsightRegion(null);
              }}
              onGoCommunity={postId => {
                const params = new URLSearchParams();
                params.set('tab', 'community');
                if (postId != null) params.set('post', String(postId));
                navigate(`/main?${params.toString()}`);
              }}
              currentUser={currentUser}
              onAddToTrip={handleRequestAddToTrip}
              regionMap={regionMap}
              regions={regions}
            />
          )}

          </div>

          <footer className="main-footer">
            <div className="main-footer-top">
              <div>
                <div className="main-footer-brand">LocalVibe</div>
                <div className="main-footer-desc">
                  Discover real local stories with AI.
                </div>
              </div>
              <div className="main-footer-links">
                <span>Core Features</span>
                <span>Pro Experience</span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveTab('contact')}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setActiveTab('contact');
                    }
                  }}
                >
                  Contact
                </span>
                <span>Join</span>
              </div>
            </div>
            <div className="main-footer-bottom">
              © {new Date().getFullYear()} LocalVibe. All rights reserved.
            </div>
          </footer>
        </main>
      </div>

      {tripSelectRegion && (
        <TripSelectModal
          myTrips={myTrips}
          onSelect={handleAddToSpecificTrip}
          onCreateNew={handleCreateNewTripAndAdd}
          onClose={() => setTripSelectRegion(null)}
        />
      )}

      <RegionModal
        region={
          activeTab === 'gallery' || activeTab === 'mypage'
            ? insightRegion || selectedRegion
            : null
        }
        isLoading={
          (activeTab === 'gallery' || activeTab === 'mypage') &&
          isInsightLoading
        }
        apiBaseUrl={API_BASE_URL}
        crawlImageUrls={modalCrawlImages}
        article={modalArticle}
        articleLoading={modalArticleLoading}
        scrappedIds={scrappedIds}
        onToggleScrap={handleToggleScrap}
        onAddToTrip={handleRequestAddToTrip}
        onClose={() => {
          setSelectedRegion(null);
          setInsightRegion(null);
          setModalCrawlImages([]);
          setModalArticle(null);
          setModalArticleLoading(false);
        }}
      />
    </div>
  );
}
