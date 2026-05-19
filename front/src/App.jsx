import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TopHeader from './components/TopHeader';
import GallerySearchBox from './components/GallerySearchBox';
import RegionGallery from './components/RegionGallery';
import RegionModal from './components/RegionModal';
import { defaultRegions } from './data/defaultRegions';
import TripPlannerPage from './pages/TripPlannerPage';
import MyPage from './pages/MyPage';
import { normalizeRegionMediaFields, resolveBackendMediaUrl } from './utils/apiMediaUrl';

const DEFAULT_REGIONS_NORMALIZED = defaultRegions.map((r) =>
  normalizeRegionMediaFields({ ...r }),
);
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';
const FEED_SIZE = 9;
const GALLERY_VECTOR_ACTIVE_KEY = 'lv_gallery_vector_active';
const GALLERY_SEARCH_RESULTS_KEY = 'lv_gallery_search_results';
const SIDEBAR_WIDTH_KEY = 'lv_sidebar_width';
const SIDEBAR_WIDTH_DEFAULT = 204;
const SIDEBAR_WIDTH_MIN = 168;
const SIDEBAR_WIDTH_MAX = 420;

function readInitialSidebarWidth() {
  if (typeof localStorage === 'undefined') {
    return SIDEBAR_WIDTH_DEFAULT;
  }
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    const n = raw != null ? Number(raw) : NaN;
    if (!Number.isFinite(n)) {
      return SIDEBAR_WIDTH_DEFAULT;
    }
    return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(n)));
  } catch {
    return SIDEBAR_WIDTH_DEFAULT;
  }
}

function isGalleryVectorFeedLocked() {
  if (typeof sessionStorage === 'undefined') {
    return false;
  }
  try {
    return sessionStorage.getItem(GALLERY_VECTOR_ACTIVE_KEY) === '1';
  } catch {
    return false;
  }
}

function readPersistedGalleryRegions() {
  if (typeof sessionStorage === 'undefined') {
    return null;
  }
  try {
    if (sessionStorage.getItem(GALLERY_VECTOR_ACTIVE_KEY) !== '1') {
      return null;
    }
    const raw = sessionStorage.getItem(GALLERY_SEARCH_RESULTS_KEY);
    if (!raw) {
      return null;
    }
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0) {
      return null;
    }
    return arr.map((r) => normalizeRegionMediaFields({ ...r }));
  } catch {
    return null;
  }
}

function persistGalleryVectorResults(mapped) {
  try {
    sessionStorage.setItem(GALLERY_VECTOR_ACTIVE_KEY, '1');
    sessionStorage.setItem(GALLERY_SEARCH_RESULTS_KEY, JSON.stringify(mapped));
  } catch {
    // 사생활 보호 모드·할당량 등
  }
}
const SIDEBAR_MENU = [
  { id: 'gallery', label: '🗺 지역 갤러리', section: '메인' },
  { id: 'planner', label: '✈ 여행 플래너', section: '메인' },
  { id: 'mypage', label: '👤 마이페이지', section: '메인' },
  { id: 'gwangju', label: '📍 광주', section: '지역' },
  { id: 'jeonnam', label: '📍 전남', section: '지역' },
  { id: 'about', label: '💡 서비스 소개', section: '정보' },
  { id: 'contact', label: '📬 문의하기', section: '정보' },
];

function normalizeTextKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .trim();
}

function normalizeImageKey(imageUrl) {
  const value = String(imageUrl || '')
    .trim()
    .toLowerCase();
  if (!value) {
    return '';
  }
  return value.replace(/^https?:/, '');
}

function pickFeedItems(items, size = FEED_SIZE) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const shuffled = [...items].sort(() => Math.random() - 0.5);
  const picked = [];
  const usedImageKeys = new Set();
  const usedNameKeys = new Set();

  for (const item of shuffled) {
    const nameKey = normalizeTextKey(item?.name);
    const imageKey = normalizeImageKey(item?.imageUrl);
    if (!nameKey || usedNameKeys.has(nameKey)) {
      continue;
    }
    if (imageKey && usedImageKeys.has(imageKey)) {
      continue;
    }
    picked.push(item);
    usedNameKeys.add(nameKey);
    if (imageKey) {
      usedImageKeys.add(imageKey);
    }
    if (picked.length >= size) {
      return picked;
    }
  }

  // 후보가 부족할 때는 이름 중복만 막고 채웁니다.
  for (const item of shuffled) {
    const nameKey = normalizeTextKey(item?.name);
    if (!nameKey || usedNameKeys.has(nameKey)) {
      continue;
    }
    picked.push(item);
    usedNameKeys.add(nameKey);
    if (picked.length >= size) {
      break;
    }
  }

  return picked.slice(0, size);
}

function mapSearchHitToRegion(row, regionMap) {
  const id = Number(row.place_id);
  const base = regionMap.get(id);
  const sim =
    row.pinecone_similarity != null && !Number.isNaN(Number(row.pinecone_similarity))
      ? `Pinecone 유사도 ${Number(row.pinecone_similarity).toFixed(3)}`
      : '';
  const rank =
    row.score != null && !Number.isNaN(Number(row.score))
      ? `랭킹점수 ${Number(row.score).toFixed(3)}`
      : '';
  const bits = [row.category, row.region, sim, rank].filter(Boolean).join(' · ');
  return {
    id,
    name: row.name || base?.name || '이름 없음',
    imageUrl: base?.imageUrl || '',
    summary: base?.summary || bits || '상세 설명이 없습니다.',
    summaryShort: sim || base?.summaryShort,
    address: base?.address,
    latitude: base?.latitude,
    longitude: base?.longitude,
    region: row.region || base?.region,
    province: row.province || base?.province,
    dataSource: base?.dataSource,
    sourceId: base?.sourceId,
    recommendedBusinesses:
      base?.recommendedBusinesses?.length > 0
        ? base.recommendedBusinesses
        : row.category
          ? [row.category]
          : [],
    busyHours: base?.busyHours || [],
    targetCustomers: base?.targetCustomers || [],
  };
}

export default function App() {
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('lv_access_token') || '');
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const raw = localStorage.getItem('lv_user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [regions, setRegions] = useState(DEFAULT_REGIONS_NORMALIZED);
  const [displayedRegions, setDisplayedRegions] = useState(() => {
    const persisted = readPersistedGalleryRegions();
    return persisted ?? DEFAULT_REGIONS_NORMALIZED;
  });
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [insightRegion, setInsightRegion] = useState(null);
  const [isInsightLoading, setIsInsightLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('gallery'); // "gallery" or "planner"
  const [scrappedIds, setScrappedIds] = useState(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('lv_scraps') || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [modalCrawlImages, setModalCrawlImages] = useState([]);
  const [modalArticle, setModalArticle] = useState(null);
  const [modalArticleLoading, setModalArticleLoading] = useState(false);
  const [gallerySearchBusy, setGallerySearchBusy] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(readInitialSidebarWidth);
  /** 갤러리 벡터 검색으로 `displayedRegions`를 채운 뒤에는 초기 `/api/regions` 응답이 늦게 도착해도 덮어쓰지 않습니다. */
  const galleryVectorSearchActiveRef = useRef(isGalleryVectorFeedLocked());
  /** 가장 최근에 시작한 검색만 결과를 반영합니다(늦게 도착한 이전 요청 무시). */
  const gallerySearchSeqRef = useRef(0);

  useEffect(() => {
    let isMounted = true;

    async function fetchRegions() {
      try {
        const response = await fetch(`${API_BASE_URL}/api/regions`);
        if (!response.ok) {
          return;
        }

        const data = await response.json();
        if (
          isMounted &&
          Array.isArray(data?.regions) &&
          data.regions.length > 0
        ) {
          const normalizedRegions = data.regions.map((r) =>
            normalizeRegionMediaFields({ ...r }),
          );
          setRegions(normalizedRegions);
          if (
            !galleryVectorSearchActiveRef.current &&
            !isGalleryVectorFeedLocked()
          ) {
            setDisplayedRegions(pickFeedItems(normalizedRegions));
          }
        }
      } catch {
        // 백엔드 미실행 상태에서도 UI 초안이 보이도록 기본 데이터를 유지합니다.
        if (
          !galleryVectorSearchActiveRef.current &&
          !isGalleryVectorFeedLocked()
        ) {
          setDisplayedRegions(pickFeedItems(DEFAULT_REGIONS_NORMALIZED));
        }
      }
    }

    fetchRegions();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function fetchRegionInsight() {
      if (!selectedRegion?.id) {
        setInsightRegion(null);
        return;
      }

      setIsInsightLoading(true);
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/regions/${selectedRegion.id}/insight`,
        );
        if (!response.ok) {
          return;
        }

        const data = await response.json();
        if (isMounted && data?.region) {
          setInsightRegion(normalizeRegionMediaFields({ ...data.region }));
        }
      } catch {
        // 상세 API 실패 시에도 선택한 기본 카드 정보는 유지합니다.
      } finally {
        if (isMounted) {
          setIsInsightLoading(false);
        }
      }
    }

    fetchRegionInsight();

    return () => {
      isMounted = false;
    };
  }, [selectedRegion]);

  useEffect(() => {
    const id = selectedRegion?.id;
    if (!id) {
      setModalCrawlImages([]);
      setModalArticle(null);
      setModalArticleLoading(false);
      return;
    }
    let cancelled = false;
    async function loadPlaceExtras() {
      setModalCrawlImages([]);
      setModalArticle(null);
      setModalArticleLoading(true);
      try {
        const imgRes = await fetch(`${API_BASE_URL}/api/places/${id}/images`);
        if (imgRes.ok) {
          const imgData = await imgRes.json();
          const urls = (imgData.images || [])
            .map((x) => x.url)
            .filter(Boolean)
            .map((u) => resolveBackendMediaUrl(u));
          if (!cancelled) {
            setModalCrawlImages(urls);
          }
        }
        const artRes = await fetch(`${API_BASE_URL}/api/places/${id}/article`);
        if (cancelled) {
          return;
        }
        if (artRes.ok) {
          const art = await artRes.json();
          if (!cancelled) {
            setModalArticle({ title: art.title || '', content: art.content || '' });
          }
        } else if (!cancelled) {
          setModalArticle({ title: '', content: '아티클을 불러오지 못했습니다.' });
        }
      } catch {
        if (!cancelled) {
          setModalArticle({ title: '', content: '네트워크 오류로 상세를 불러오지 못했습니다.' });
        }
      } finally {
        if (!cancelled) {
          setModalArticleLoading(false);
        }
      }
    }
    loadPlaceExtras();
    return () => {
      cancelled = true;
    };
  }, [selectedRegion?.id]);

  const handleSidebarResizePointerDown = useCallback(
    e => {
      if (e.button !== 0) {
        return;
      }
      e.preventDefault();
      const startX = e.clientX;
      const startW = sidebarWidth;
      let lastW = startW;

      const onMove = ev => {
        const dx = ev.clientX - startX;
        lastW = Math.min(
          SIDEBAR_WIDTH_MAX,
          Math.max(SIDEBAR_WIDTH_MIN, Math.round(startW + dx)),
        );
        setSidebarWidth(lastW);
      };

      const end = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        try {
          localStorage.setItem(SIDEBAR_WIDTH_KEY, String(lastW));
        } catch {
          // storage full / private mode
        }
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // 일부 브라우저에서 캡처 실패해도 window 리스너로 동작합니다.
      }
    },
    [sidebarWidth],
  );

  const regionMap = useMemo(() => {
    return new Map(regions.map(region => [region.id, region]));
  }, [regions]);

  /** 검색 직후에는 `displayedRegions`에 imageUrl이 비어 있을 수 있음. `/api/regions` 갱신 후 regionMap과 다시 합칩니다. */
  const galleryDisplayRegions = useMemo(() => {
    return displayedRegions.map(r => {
      const id = Number(r?.id);
      if (!Number.isFinite(id)) {
        return r;
      }
      const base = regionMap.get(id);
      if (!base) {
        return r;
      }
      const mergedSummary =
        r.summary && String(r.summary).trim() && r.summary !== '상세 설명이 없습니다.'
          ? r.summary
          : base.summary || r.summary;
      return {
        ...r,
        imageUrl: base.imageUrl || r.imageUrl || '',
        summary: mergedSummary,
        address: r.address || base.address,
        latitude: r.latitude ?? base.latitude,
        longitude: r.longitude ?? base.longitude,
        province: r.province || base.province,
        sourceId: r.sourceId || base.sourceId,
        dataSource: r.dataSource || base.dataSource,
        contentTypeId: r.contentTypeId ?? base.contentTypeId,
      };
    });
  }, [displayedRegions, regionMap]);

  const handleGalleryVectorSearch = useCallback(
    async (q) => {
      const trimmed = String(q || '').trim();
      if (!trimmed) {
        return false;
      }
      const seq = ++gallerySearchSeqRef.current;
      setGallerySearchBusy(true);
      try {
        const url = new URL(`${API_BASE_URL}/api/search`);
        url.searchParams.set('q', trimmed);
        const res = await fetch(url.toString());
        if (seq !== gallerySearchSeqRef.current) {
          return false;
        }
        if (!res.ok) {
          window.alert('검색 요청에 실패했습니다.');
          return false;
        }
        const data = await res.json();
        const rows = Array.isArray(data?.results) ? data.results : [];
        const mapped = rows.map((row) =>
          normalizeRegionMediaFields(mapSearchHitToRegion(row, regionMap)),
        );
        if (seq !== gallerySearchSeqRef.current) {
          return false;
        }
        if (mapped.length > 0) {
          galleryVectorSearchActiveRef.current = true;
          persistGalleryVectorResults(mapped);
          setDisplayedRegions(mapped);
          return true;
        }
        window.alert('검색 결과가 없습니다. 다른 키워드를 시도해 보세요.');
        return false;
      } catch {
        if (seq === gallerySearchSeqRef.current) {
          window.alert('네트워크 오류입니다. 백엔드가 실행 중인지 확인해 주세요.');
        }
        return false;
      } finally {
        if (seq === gallerySearchSeqRef.current) {
          setGallerySearchBusy(false);
        }
      }
    },
    [regionMap],
  );

  const handleToggleScrap = regionId => {
    setScrappedIds(prev => {
      const exists = prev.includes(regionId);
      const next = exists ? prev.filter(id => id !== regionId) : [...prev, regionId];
      localStorage.setItem('lv_scraps', JSON.stringify(next));
      return next;
    });
  };

  const scrappedRegions = useMemo(
    () => regions.filter(region => scrappedIds.includes(region.id)),
    [regions, scrappedIds],
  );

  const handleGoogleCredential = async credential => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_token: credential }),
      });
      if (!response.ok) {
        throw new Error('google login failed');
      }
      const data = await response.json();
      const nextToken = String(data?.access_token || '');
      const nextUser = data?.user || null;
      if (!nextToken || !nextUser) {
        throw new Error('invalid auth response');
      }

      setAuthToken(nextToken);
      setCurrentUser(nextUser);
      localStorage.setItem('lv_access_token', nextToken);
      localStorage.setItem('lv_user', JSON.stringify(nextUser));
    } catch {
      setAuthToken('');
      setCurrentUser(null);
      localStorage.removeItem('lv_access_token');
      localStorage.removeItem('lv_user');
      window.alert('구글 로그인에 실패했습니다. 잠시 후 다시 시도해주세요.');
    }
  };

  const handleLogout = () => {
    setAuthToken('');
    setCurrentUser(null);
    localStorage.removeItem('lv_access_token');
    localStorage.removeItem('lv_user');
  };

  return (
    <div className="app-page">
      <TopHeader
        user={currentUser}
        authToken={authToken}
        onGoogleCredential={handleGoogleCredential}
        onLogout={handleLogout}
      />
      <div className="app-layout">
        <aside className="app-sidebar" style={{ width: sidebarWidth }}>
          <div className="sidebar-section-title">메인</div>
          {SIDEBAR_MENU.filter(item => item.section === '메인').map(item => (
            <button
              key={item.id}
              className={`sidebar-link ${activeTab === item.id ? 'active' : ''}`}
              onClick={() => setActiveTab(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}

          <div className="sidebar-section-title">지역</div>
          {SIDEBAR_MENU.filter(item => item.section === '지역').map(item => (
            <div key={item.id} className="sidebar-static-link">
              {item.label}
            </div>
          ))}

          <div className="sidebar-section-title">정보</div>
          {SIDEBAR_MENU.filter(item => item.section === '정보').map(item => (
            <div key={item.id} className="sidebar-static-link">
              {item.label}
            </div>
          ))}
        </aside>

        <div
          className="app-sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="사이드바 너비 조절"
          tabIndex={0}
          onPointerDown={handleSidebarResizePointerDown}
        />

        <main className="app-shell">
          {/* Conditional Content */}
          {activeTab === 'gallery' ? (
            <>
              <h1 className="top-title">로컬 바이브</h1>
              <p className="gallery-subtitle">
                검색어로 Pinecone 벡터 검색만 실행합니다. 대화형 추천은 트립 플래너에서 이용해 주세요.
              </p>
              <GallerySearchBox
                onSearch={handleGalleryVectorSearch}
                busy={gallerySearchBusy}
                placeholder="예: 해수욕장 근처 조용한 곳, 여수 야경 맛집"
              />
              <RegionGallery
                regions={galleryDisplayRegions.slice(0, FEED_SIZE)}
                scrappedIds={scrappedIds}
                onToggleScrap={handleToggleScrap}
                onSelect={region => {
                  setSelectedRegion(region);
                  setInsightRegion(null);
                }}
              />
            </>
          ) : activeTab === 'planner' ? (
            <TripPlannerPage regions={regions} />
          ) : (
            <MyPage
              scrappedRegions={scrappedRegions}
              onToggleScrap={handleToggleScrap}
              onOpenRegion={region => {
                setSelectedRegion(region);
                setInsightRegion(null);
              }}
            />
          )}

          <footer className="main-footer">
            <div className="main-footer-top">
              <div>
                <div className="main-footer-brand">LocalVibe</div>
                <div className="main-footer-desc">
                  Discover real local stories with AI and data-driven insights.
                </div>
              </div>
              <div className="main-footer-links">
                <span>Core Features</span>
                <span>Pro Experience</span>
                <span>Contact</span>
                <span>Join</span>
              </div>
            </div>
            <div className="main-footer-bottom">
              © 2026 LocalVibe. All rights reserved.
            </div>
          </footer>
        </main>
      </div>
      <RegionModal
        region={insightRegion || selectedRegion}
        isLoading={isInsightLoading}
        apiBaseUrl={API_BASE_URL}
        crawlImageUrls={modalCrawlImages}
        article={modalArticle}
        articleLoading={modalArticleLoading}
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
