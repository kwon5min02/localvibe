import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { googleLogout } from '@react-oauth/google';
import CommonHeader from './components/CommonHeader';
import GallerySearchBox from './components/GallerySearchBox';
import RegionGallery from './components/RegionGallery';
import RegionModal from './components/RegionModal';
import { defaultRegions } from './data/defaultRegions';
import TripPlannerPage from './pages/TripPlannerPage';
import TripSelectModal from './components/TripSelectModal';
import MyPage from './pages/MyPage';
import {
  normalizeRegionMediaFields,
  resolveBackendMediaUrl,
} from './utils/apiMediaUrl';
import {
  addScrap,
  fetchMyScraps,
  removeScrap,
  syncMyScraps,
} from './utils/scrapsApi';
import {
  addPlaceToTrip,
  createTrip,
  deleteTrip,
  fetchMyTrips,
  removePlaceFromTrip,
  syncMyTrips,
} from './utils/tripsApi';
import { filterRegionsBySidebarLocation } from './utils/sidebarLocationFilter';
import ContactModal from './components/ContactModal';

const DEFAULT_REGIONS_NORMALIZED = defaultRegions.map(r =>
  normalizeRegionMediaFields({ ...r }),
);

const MemoTripPlannerPage = memo(TripPlannerPage);

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';
const FEED_SIZE = 9;
const GALLERY_VECTOR_ACTIVE_KEY = 'lv_gallery_vector_active';
const GALLERY_SEARCH_RESULTS_KEY = 'lv_gallery_search_results';
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
function isGalleryVectorFeedLocked() {
  try {
    return sessionStorage.getItem(GALLERY_VECTOR_ACTIVE_KEY) === '1';
  } catch {
    return false;
  }
}
function readPersistedGalleryRegions() {
  try {
    if (sessionStorage.getItem(GALLERY_VECTOR_ACTIVE_KEY) !== '1') return null;
    const raw = sessionStorage.getItem(GALLERY_SEARCH_RESULTS_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return pickOrderedFeedItems(
      arr.map(r => normalizeRegionMediaFields({ ...r })),
      FEED_SIZE,
    );
  } catch {
    return null;
  }
}
function persistGalleryVectorResults(mapped) {
  try {
    sessionStorage.setItem(GALLERY_VECTOR_ACTIVE_KEY, '1');
    sessionStorage.setItem(GALLERY_SEARCH_RESULTS_KEY, JSON.stringify(mapped));
  } catch {}
}

function clearGalleryVectorLock(lockRef) {
  try {
    sessionStorage.removeItem(GALLERY_VECTOR_ACTIVE_KEY);
    sessionStorage.removeItem(GALLERY_SEARCH_RESULTS_KEY);
  } catch {
    /* ignore */
  }
  if (lockRef) lockRef.current = false;
}

function dedupeFeedPick(source, picked, usedName, usedImg, size) {
  for (const item of source) {
    const nk = normalizeTextKey(item?.name);
    const ik = normalizeImageKey(item?.imageUrl);
    if (!nk || usedName.has(nk) || (ik && usedImg.has(ik))) continue;
    picked.push(item);
    usedName.add(nk);
    if (ik) usedImg.add(ik);
    if (picked.length >= size) return picked;
  }
  for (const item of source) {
    const nk = normalizeTextKey(item?.name);
    if (!nk || usedName.has(nk)) continue;
    picked.push(item);
    usedName.add(nk);
    if (picked.length >= size) break;
  }
  return picked.slice(0, size);
}

function feedHasDisplayImages(list) {
  return Array.isArray(list) && list.some((r) => String(r?.imageUrl || '').trim());
}

function readInitialDisplayedRegions() {
  if (isGalleryVectorFeedLocked()) {
    return readPersistedGalleryRegions() ?? [];
  }
  return [];
}

/** Fisher–Yates 셔플 후 피드용 N개 추출 (사이드바 지역마다 다른 9장) */
function pickFeedItems(items, size = FEED_SIZE) {
  if (!Array.isArray(items) || !items.length) return [];
  const withImg = items.filter((r) => String(r?.imageUrl || '').trim());
  const pool = withImg.length >= size ? withImg : items;
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return dedupeFeedPick(shuffled, [], new Set(), new Set(), size);
}

/** API 유사도·점수 순 유지, 상위 N개만 (갤러리 벡터 검색용 3×3) */
function pickOrderedFeedItems(items, size = FEED_SIZE) {
  if (!Array.isArray(items) || !items.length) return [];
  return dedupeFeedPick(items, [], new Set(), new Set(), size);
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

const PAGE_INFO = {
  gallery: {
    title: '갤러리',
    subtitle: 'AI 기반으로 숨은 로컬 스팟을 찾아드려요.',
  },
  planner: {
    title: '여행 플래너',
    subtitle:
      '챗봇과 함께 나만의 여행 일정을 만들어보세요. 채팅·검색으로 채우고 드래그로 순서·일차를 조정하세요.',
  },
  mypage: {
    title: '마이페이지',
    subtitle: '스크랩한 장소와 내 여행 일정을 관리하세요.',
  },
};

function normalizeTextKey(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .trim();
}
function normalizeImageKey(u) {
  const v = String(u || '')
    .trim()
    .toLowerCase();
  return v ? v.replace(/^https?:/, '') : '';
}

function mapSearchHitToRegion(row, regionMap) {
  const id = Number(row.place_id),
    base = regionMap.get(id);
  const sim =
    row.pinecone_similarity != null
      ? `유사도 ${Number(row.pinecone_similarity).toFixed(3)}`
      : '';
  const imageUrl = String(row.imageUrl || base?.imageUrl || '').trim();
  return {
    id,
    name: row.name || base?.name || '이름 없음',
    imageUrl,
    summary:
      base?.summary ||
      [row.category, row.region, sim].filter(Boolean).join(' · ') ||
      '상세 설명이 없습니다.',
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

// 사이드바 계정 영역
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
  // 미로그인 — 임시 프로필
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

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const raw = localStorage.getItem('lv_user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [regions, setRegions] = useState(DEFAULT_REGIONS_NORMALIZED);
  const [displayedRegions, setDisplayedRegions] = useState(readInitialDisplayedRegions);
  const [galleryFeedLoading, setGalleryFeedLoading] = useState(
    () => !isGalleryVectorFeedLocked(),
  );
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [insightRegion, setInsightRegion] = useState(null);
  const [isInsightLoading, setIsInsightLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('gallery');
  const [scrappedIds, setScrappedIds] = useState([]);
  const [myTrips, setMyTrips] = useState([]);
  const [contactOpen, setContactOpen] = useState(false);
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
  const [chatbotMessages, setChatbotMessages] = useState([
    {
      role: 'assistant',
      text: '안녕하세요! 어떤 장소를 찾고 계신가요?\n예: 여자친구랑 감성 카페, 가족 당일치기',
    },
  ]);
  const [chatbotInput, setChatbotInput] = useState('');
  const [chatbotBusy, setChatbotBusy] = useState(false);
  const chatMessagesRef = useRef(null);
  const accountAreaRef = useRef(null);
  const galleryVectorSearchActiveRef = useRef(isGalleryVectorFeedLocked());
  const gallerySearchSeqRef = useRef(0);
  /** 사이드바 지역 필터: 전체 후보 풀 + 라벨 (클릭·새로고침마다 랜덤 9개) */
  const [sidebarGalleryPool, setSidebarGalleryPool] = useState([]);
  const [sidebarGalleryLabel, setSidebarGalleryLabel] = useState('');

  useEffect(() => {
    const sync = () => {
      try {
        const raw = localStorage.getItem('lv_user');
        setCurrentUser(raw ? JSON.parse(raw) : null);
      } catch {
        setCurrentUser(null);
      }
    };
    window.addEventListener('lv-auth-changed', sync);
    return () => window.removeEventListener('lv-auth-changed', sync);
  }, []);

  useEffect(() => {
    if (!currentUser) {
      setScrappedIds([]);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        let localIds = [];
        try {
          const raw = localStorage.getItem('lv_scraps');
          const parsed = raw ? JSON.parse(raw) : [];
          if (Array.isArray(parsed)) {
            localIds = parsed.map(Number).filter(Number.isFinite);
          }
        } catch {
          /* ignore */
        }
        const result =
          localIds.length > 0
            ? await syncMyScraps(localIds)
            : await fetchMyScraps();
        if (cancelled) return;
        setScrappedIds(result.placeIds);
        if (localIds.length > 0) {
          try {
            localStorage.removeItem('lv_scraps');
          } catch {
            /* ignore */
          }
        }
      } catch (err) {
        if (!cancelled && err?.message !== 'not_logged_in') {
          console.error('스크랩 목록 로드 실패', err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) {
      setMyTrips([]);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        let localTrips = [];
        try {
          const raw = localStorage.getItem('lv_my_trips');
          const parsed = raw ? JSON.parse(raw) : [];
          if (Array.isArray(parsed)) localTrips = parsed;
        } catch {
          /* ignore */
        }
        const trips =
          localTrips.length > 0
            ? await syncMyTrips(localTrips)
            : await fetchMyTrips();
        if (cancelled) return;
        setMyTrips(
          trips.map(t => ({
            ...t,
            places: (t.places || []).map(p =>
              normalizeRegionMediaFields({ ...p }),
            ),
          })),
        );
        if (localTrips.length > 0) {
          try {
            localStorage.removeItem('lv_my_trips');
          } catch {
            /* ignore */
          }
        }
      } catch (err) {
        if (!cancelled && err?.message !== 'not_logged_in') {
          console.error('여행 일정 로드 실패', err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  useEffect(() => {
    let m = true;
    if (isGalleryVectorFeedLocked()) {
      try {
        const raw = sessionStorage.getItem(GALLERY_SEARCH_RESULTS_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        if (Array.isArray(arr) && arr.length > 0 && !arr.some((r) => String(r?.imageUrl || '').trim())) {
          clearGalleryVectorLock(galleryVectorSearchActiveRef);
        }
      } catch {
        clearGalleryVectorLock(galleryVectorSearchActiveRef);
      }
    }
    const vectorLocked = isGalleryVectorFeedLocked();
    galleryVectorSearchActiveRef.current = vectorLocked;

    const loadFeed = async () => {
      if (vectorLocked) {
        if (m) setGalleryFeedLoading(false);
        return;
      }
      try {
        const res = await fetch(`${API_BASE_URL}/api/regions/feed?limit=${FEED_SIZE}`);
        const data = res.ok ? await res.json() : null;
        if (!m || !Array.isArray(data?.regions) || !data.regions.length) return;
        const normalized = data.regions.map((r) => normalizeRegionMediaFields({ ...r }));
        setDisplayedRegions(normalized.slice(0, FEED_SIZE));
      } catch { /* ignore */ }
      finally {
        if (m) setGalleryFeedLoading(false);
      }
    };

    const loadAll = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/regions`);
        const data = res.ok ? await res.json() : null;
        if (!m || !Array.isArray(data?.regions) || !data.regions.length) return;
        const normalized = data.regions.map((r) => normalizeRegionMediaFields({ ...r }));
        setRegions(normalized);
        if (!galleryVectorSearchActiveRef.current && !isGalleryVectorFeedLocked()) {
          setDisplayedRegions((prev) => (
            feedHasDisplayImages(prev) ? prev : pickFeedItems(normalized, FEED_SIZE)
          ));
        }
      } catch {
        if (!m || galleryVectorSearchActiveRef.current || isGalleryVectorFeedLocked()) return;
        setDisplayedRegions((prev) => (
          feedHasDisplayImages(prev) ? prev : pickFeedItems(DEFAULT_REGIONS_NORMALIZED, FEED_SIZE)
        ));
      }
    };

    loadFeed();
    loadAll();
    return () => { m = false; };
  }, []);

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
          if (!cancelled) {
            setModalArticle({
              title: a.title || '',
              content: a.content || '',
              blocks: Array.isArray(a.blocks) ? a.blocks : [],
            });
          }
        } else if (!cancelled) setModalArticle(null); // 실패 시 null → 모달에서 하드코딩 아티클 표시
      } catch {
        if (!cancelled) setModalArticle(null);
      } finally {
        // 실패 시 null → 하드코딩 폴백
        if (!cancelled) setModalArticleLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedRegion?.id]);

  useEffect(() => {
    if (chatMessagesRef.current)
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
  }, [chatbotMessages, chatbotBusy]);

  useEffect(() => {
    if (!accountPopupOpen) return;
    const handler = e => {
      if (accountAreaRef.current && !accountAreaRef.current.contains(e.target))
        setAccountPopupOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [accountPopupOpen]);

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

  const regionMap = useMemo(() => {
    const map = new Map();
    for (const r of regions) {
      const id = Number(r?.id);
      if (Number.isFinite(id)) map.set(id, r);
    }
    return map;
  }, [regions]);

  /** regionMap·검색 API 로드 후 카드 imageUrl 보강 (7MB regions 대기 없이) */
  useEffect(() => {
    if (!regions.length || !displayedRegions.length) return;
    setDisplayedRegions((prev) => {
      let changed = false;
      const next = prev.map((r) => {
        const id = Number(r?.id);
        if (!Number.isFinite(id)) return r;
        const base = regionMap.get(id);
        const imageUrl = String(r.imageUrl || base?.imageUrl || '').trim();
        if (imageUrl === String(r.imageUrl || '').trim()) return r;
        changed = true;
        return { ...r, imageUrl };
      });
      return changed ? next : prev;
    });
  }, [regions, regionMap, displayedRegions.length]);

  useEffect(() => {
    const tab = location.state?.tab;
    if (tab === 'planner' || tab === 'gallery' || tab === 'mypage') {
      setActiveTab(tab);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, location.pathname, navigate]);

  useEffect(() => {
    if (activeTab === 'planner') {
      setSelectedRegion(null);
      setInsightRegion(null);
      setModalCrawlImages([]);
      setModalArticle(null);
      setModalArticleLoading(false);
      setChatbotOpen(false);
    }
  }, [activeTab]);

  const galleryDisplayRegions = useMemo(
    () =>
      displayedRegions.map(r => {
        const id = Number(r?.id);
        if (!Number.isFinite(id)) return r;
        const base = regionMap.get(id);
        if (!base) return r;
        const s =
          r.summary &&
          String(r.summary).trim() &&
          r.summary !== '상세 설명이 없습니다.'
            ? r.summary
            : base.summary || r.summary;
        return {
          ...r,
          imageUrl: base.imageUrl || r.imageUrl || '',
          summary: s,
          address: r.address || base.address,
          latitude: r.latitude ?? base.latitude,
          longitude: r.longitude ?? base.longitude,
          province: r.province || base.province,
        };
      }),
    [displayedRegions, regionMap],
  );

  const clearSidebarGalleryFilter = useCallback(() => {
    setSidebarGalleryPool([]);
    setSidebarGalleryLabel('');
  }, []);

  const applySidebarGalleryFeed = useCallback((list, label) => {
    const normalized = (Array.isArray(list) ? list : [])
      .map(r => normalizeRegionMediaFields(r))
      .filter(Boolean);
    if (normalized.length === 0) return false;
    setSidebarGalleryPool(normalized);
    setSidebarGalleryLabel(String(label || '').trim());
    setDisplayedRegions(pickFeedItems(normalized, FEED_SIZE));
    return true;
  }, []);

  const handleShuffleSidebarGallery = useCallback(() => {
    if (!sidebarGalleryPool.length) return;
    setDisplayedRegions(pickFeedItems(sidebarGalleryPool, FEED_SIZE));
  }, [sidebarGalleryPool]);

  const handleGalleryVectorSearch = useCallback(
    async q => {
      const trimmed = String(q || '').trim();
      if (!trimmed) return false;
      clearSidebarGalleryFilter();
      const seq = ++gallerySearchSeqRef.current;
      setGallerySearchBusy(true);
      try {
        const url = new URL(`${API_BASE_URL}/api/search`);
        url.searchParams.set('q', trimmed);
        const res = await fetch(url.toString());
        if (seq !== gallerySearchSeqRef.current) return false;
        if (!res.ok) {
          window.alert('검색 요청에 실패했습니다.');
          return false;
        }
        const data = await res.json();
        const mapped = (Array.isArray(data?.results) ? data.results : []).map(
          row =>
            normalizeRegionMediaFields(mapSearchHitToRegion(row, regionMap)),
        );
        if (seq !== gallerySearchSeqRef.current) return false;
        if (mapped.length > 0) {
          const feed = pickOrderedFeedItems(mapped, FEED_SIZE);
          galleryVectorSearchActiveRef.current = true;
          persistGalleryVectorResults(feed);
          setDisplayedRegions(feed);
          return true;
        }
        window.alert('검색 결과가 없습니다.');
        return false;
      } catch {
        if (seq === gallerySearchSeqRef.current)
          window.alert('네트워크 오류입니다.');
        return false;
      } finally {
        if (seq === gallerySearchSeqRef.current) setGallerySearchBusy(false);
      }
    },
    [regionMap, clearSidebarGalleryFilter],
  );

  const handleSidebarRegionClick = useCallback(
    async label => {
      const key = String(label || '').trim();
      if (!key) return;
      clearGalleryVectorLock(galleryVectorSearchActiveRef);
      clearSidebarGalleryFilter();
      setActiveTab('gallery');

      try {
        const res = await fetch(
          `${API_BASE_URL}/api/regions?place_in=${encodeURIComponent(key)}`,
        );
        if (res.ok) {
          const data = await res.json();
          if (applySidebarGalleryFeed(data?.regions, key)) return;
        }
      } catch {
        /* API 실패 시 로컬 필터 */
      }

      const local = filterRegionsBySidebarLocation(regions, key);
      if (applySidebarGalleryFeed(local, key)) return;

      window.alert(`"${key}" 지역(주소 기준)에 맞는 장소를 찾지 못했습니다.`);
    },
    [regions, applySidebarGalleryFeed, clearSidebarGalleryFilter],
  );

  const handleChatbotSubmit = async e => {
    e.preventDefault();
    const msg = chatbotInput.trim();
    if (!msg || chatbotBusy) return;
    setChatbotMessages(prev => [...prev, { role: 'user', text: msg }]);
    setChatbotInput('');
    setChatbotBusy(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setChatbotMessages(prev => [
        ...prev,
        { role: 'assistant', text: data.answer || '추천이 완료됐어요!' },
      ]);
      if (
        Array.isArray(data.recommendedRegionIds) &&
        data.recommendedRegionIds.length > 0
      ) {
        const newRegions = data.recommendedRegionIds
          .map(id => regionMap.get(Number(id)))
          .filter(Boolean);
        if (newRegions.length > 0) setDisplayedRegions(newRegions);
      }
    } catch {
      setChatbotMessages(prev => [
        ...prev,
        { role: 'assistant', text: '오류가 발생했어요.' },
      ]);
    } finally {
      setChatbotBusy(false);
    }
  };

  const handleToggleScrap = useCallback(
    async regionId => {
      const id = Number(regionId);
      if (!Number.isFinite(id)) return;
      if (!currentUser) {
        window.alert('스크랩은 로그인 후 이용할 수 있어요.');
        navigate('/login');
        return;
      }
      const wasScrapped = scrappedIds.includes(id);
      setScrappedIds(prev =>
        wasScrapped ? prev.filter(x => x !== id) : [...prev, id],
      );
      try {
        if (wasScrapped) await removeScrap(id);
        else await addScrap(id);
      } catch (err) {
        setScrappedIds(prev =>
          wasScrapped ? [...prev, id] : prev.filter(x => x !== id),
        );
        if (err?.message === 'not_logged_in') {
          window.alert('로그인이 만료되었어요. 다시 로그인해 주세요.');
          navigate('/login');
        } else {
          window.alert('스크랩 저장에 실패했습니다.');
        }
      }
    },
    [currentUser, scrappedIds, navigate],
  );

  const handleRequestAddToTrip = useCallback(region => {
    setTripSelectRegion(region);
  }, []);

  const requireLoginForTrips = useCallback(() => {
    window.alert('여행 일정은 로그인 후 저장됩니다.');
    navigate('/login');
    return false;
  }, [navigate]);

  const handleCreateTrip = useCallback(
    async name => {
      if (!currentUser) {
        requireLoginForTrips();
        return null;
      }
      const trip = await createTrip(name);
      const normalized = {
        ...trip,
        places: (trip.places || []).map(p =>
          normalizeRegionMediaFields({ ...p }),
        ),
      };
      setMyTrips(prev => [...prev, normalized]);
      return normalized;
    },
    [currentUser, requireLoginForTrips],
  );

  const handleDeleteTrip = useCallback(
    async tripId => {
      if (!currentUser) {
        requireLoginForTrips();
        return;
      }
      await deleteTrip(tripId);
      setMyTrips(prev => prev.filter(t => t.id !== tripId));
    },
    [currentUser, requireLoginForTrips],
  );

  const handleAddPlaceToTrip = useCallback(
    async (tripId, place) => {
      if (!currentUser) {
        requireLoginForTrips();
        return;
      }
      const region = normalizeRegionMediaFields({ ...place });
      const trip = myTrips.find(t => t.id === tripId);
      if (trip?.places?.some(p => p.id === region.id)) {
        window.alert('이미 담긴 장소예요!');
        return;
      }
      const updated = await addPlaceToTrip(tripId, region.id);
      setMyTrips(prev =>
        prev.map(t =>
          t.id === tripId
            ? {
                ...updated,
                places: (updated.places || []).map(p =>
                  normalizeRegionMediaFields({ ...p }),
                ),
              }
            : t,
        ),
      );
    },
    [currentUser, myTrips, requireLoginForTrips],
  );

  const handleRemovePlaceFromTrip = useCallback(
    async (tripId, placeId) => {
      if (!currentUser) {
        requireLoginForTrips();
        return;
      }
      const updated = await removePlaceFromTrip(tripId, placeId);
      setMyTrips(prev =>
        prev.map(t =>
          t.id === tripId
            ? {
                ...updated,
                places: (updated.places || []).map(p =>
                  normalizeRegionMediaFields({ ...p }),
                ),
              }
            : t,
        ),
      );
    },
    [currentUser, requireLoginForTrips],
  );

  const handleAddToSpecificTrip = useCallback(
    async tripId => {
      if (!tripSelectRegion) return;
      if (!currentUser) {
        requireLoginForTrips();
        return;
      }
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
    [tripSelectRegion, currentUser, handleAddPlaceToTrip, requireLoginForTrips],
  );

  const handleCreateNewTripAndAdd = useCallback(async () => {
    if (!tripSelectRegion) return;
    if (!currentUser) {
      requireLoginForTrips();
      return;
    }
    const region = tripSelectRegion;
    const tripName = prompt(
      '새 여행 이름을 입력하세요:',
      `여행 ${new Date().toLocaleDateString('ko-KR')}`,
    );
    if (!tripName?.trim()) return;
    try {
      const trip = await createTrip(tripName.trim());
      const updated = await addPlaceToTrip(trip.id, region.id);
      setMyTrips(prev => [
        ...prev,
        {
          ...updated,
          places: (updated.places || []).map(p =>
            normalizeRegionMediaFields({ ...p }),
          ),
        },
      ]);
      setTripSelectRegion(null);
      window.alert(`"${region.name}"을(를) "${tripName.trim()}"에 담았어요!`);
    } catch (err) {
      if (err?.message === 'not_logged_in') requireLoginForTrips();
      else window.alert('여행 만들기에 실패했습니다.');
    }
  }, [tripSelectRegion, currentUser, requireLoginForTrips]);

  const handleLogout = () => {
    googleLogout();
    localStorage.removeItem('lv_access_token');
    localStorage.removeItem('lv_user');
    setScrappedIds([]);
    setMyTrips([]);
    window.dispatchEvent(new Event('lv-auth-changed'));
    setAccountPopupOpen(false);
  };

  const scrappedRegions = useMemo(
    () => regions.filter(r => scrappedIds.includes(r.id)),
    [regions, scrappedIds],
  );
  const currentPage = PAGE_INFO[activeTab] || PAGE_INFO.gallery;
  const showSidebar = activeTab === 'gallery' && sidebarOpen;
  const effectiveSidebarWidth = showSidebar ? sidebarWidth : 0;

  return (
    <div className="app-page">
      <CommonHeader onTabChange={setActiveTab} />

      <div className="app-layout">
        {/* ── 사이드바 ── */}
        <aside
          className={`app-sidebar${showSidebar ? '' : ' collapsed'}`}
          style={{
            width: effectiveSidebarWidth,
            minWidth: showSidebar ? SIDEBAR_WIDTH_MIN : 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* 메뉴 */}
          <div className="sidebar-spacer" />
          <div className="sidebar-scroll-area">
            <div className="sidebar-section-title">지역</div>
            {REGION_TREE.map(r => (
              <div key={r.id}>
                {r.regionFilter ? (
                  <div style={{ display: 'flex', alignItems: 'stretch' }}>
                    <button
                      className="sidebar-link"
                      type="button"
                      style={{ flex: 1, textAlign: 'left' }}
                      onClick={() => {
                        void handleSidebarRegionClick(r.regionFilter);
                      }}
                    >
                      {r.label}
                    </button>
                    <button
                      type="button"
                      className="sidebar-link"
                      style={{ width: 28, padding: '8px 4px', flexShrink: 0 }}
                      aria-label={`${r.label} 시·군 목록`}
                      onClick={() =>
                        setOpenRegions(prev => ({
                          ...prev,
                          [r.id]: !prev[r.id],
                        }))
                      }
                    >
                      <span
                        style={{
                          fontSize: 9,
                          color: '#bbb',
                          display: 'inline-block',
                          transition: 'transform 150ms',
                          transform: openRegions[r.id]
                            ? 'rotate(180deg)'
                            : 'none',
                        }}
                      >
                        ▼
                      </span>
                    </button>
                  </div>
                ) : (
                  <button
                    className="sidebar-link"
                    type="button"
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                    onClick={() =>
                      setOpenRegions(prev => ({ ...prev, [r.id]: !prev[r.id] }))
                    }
                  >
                    <span>{r.label}</span>
                    <span
                      style={{
                        fontSize: 9,
                        color: '#bbb',
                        display: 'inline-block',
                        transition: 'transform 150ms',
                        transform: openRegions[r.id]
                          ? 'rotate(180deg)'
                          : 'none',
                      }}
                    >
                      ▼
                    </span>
                  </button>
                )}
                {openRegions[r.id] && (
                  <div style={{ paddingLeft: 8 }}>
                    {r.children.map(city => (
                      <button
                        key={city}
                        className="sidebar-link"
                        type="button"
                        style={{ fontSize: 12, color: '#777', paddingLeft: 18 }}
                        onClick={() => {
                          void handleSidebarRegionClick(city);
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
            <button type="button" className="sidebar-link" onClick={() => navigate('/')}>
              💡 서비스 소개
            </button>
            <button
              type="button"
              className="sidebar-link"
              onClick={() => setContactOpen(true)}
            >
              📬 문의하기
            </button>
          </div>
        </aside>

        {/* {sidebarOpen && (
          <div className="app-sidebar-resizer" role="separator" aria-orientation="vertical" tabIndex={0} onPointerDown={handleSidebarResizePointerDown} />
        )} */}

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
                <GallerySearchBox
                  onSearch={handleGalleryVectorSearch}
                  busy={gallerySearchBusy}
                  placeholder="예: 여수 야경 맛집, 조용한 감성 카페, 부산 당일치기"
                />
              </div>
              {gallerySearchBusy ? (
                <div className="gallery-pickle-loading">
                  <span className="gallery-pickle-emoji">🥒</span>
                  <p className="gallery-pickle-text">딱 맞는 스팟 찾는 중...</p>
                </div>
              ) : null}
              {!gallerySearchBusy && sidebarGalleryLabel ? (
                <div className="gallery-region-feed-bar">
                  <span className="gallery-region-feed-label">
                    📍 {sidebarGalleryLabel}
                    {sidebarGalleryPool.length > FEED_SIZE
                      ? ` · ${sidebarGalleryPool.length}곳 중 랜덤 ${FEED_SIZE}개`
                      : ` · ${sidebarGalleryPool.length}곳`}
                  </span>
                  {sidebarGalleryPool.length > FEED_SIZE ? (
                    <button
                      type="button"
                      className="gallery-region-feed-shuffle"
                      onClick={handleShuffleSidebarGallery}
                    >
                      다른 장소 보기 ↻
                    </button>
                  ) : null}
                </div>
              ) : null}
              {galleryFeedLoading && !gallerySearchBusy && !feedHasDisplayImages(galleryDisplayRegions) ? (
                <p className="gallery-feed-loading" aria-live="polite">장소를 불러오는 중…</p>
              ) : null}
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
          {activeTab === 'planner' && (
            <MemoTripPlannerPage
              regionMap={regionMap}
              scrappedIds={scrappedIds}
              onToggleScrap={handleToggleScrap}
              currentUser={currentUser}
              myTrips={myTrips}
              onMyTripsChange={setMyTrips}
              onRequireLogin={requireLoginForTrips}
            />
          )}
          {activeTab === 'mypage' && (
            <MyPage
              scrappedRegions={scrappedRegions}
              isLoggedIn={Boolean(currentUser)}
              myTrips={myTrips}
              onCreateTrip={handleCreateTrip}
              onDeleteTrip={handleDeleteTrip}
              onAddPlaceToTrip={handleAddPlaceToTrip}
              onRemovePlaceFromTrip={handleRemovePlaceFromTrip}
              onToggleScrap={handleToggleScrap}
              onOpenRegion={region => {
                setSelectedRegion(region);
                setInsightRegion(null);
              }}
              onAddToTrip={handleRequestAddToTrip}
              regionMap={regionMap}
              regions={regions}
            />
          )}

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
                <span>Contact</span>
                <span>Join</span>
              </div>
            </div>
            <div className="main-footer-bottom">
              © {new Date().getFullYear()} LocalVibe. All rights reserved.
            </div>
          </footer>
        </main>
      </div>

      {/* 플로팅 챗봇 */}
      {activeTab === 'gallery' && (
        <>
          {chatbotOpen && (
            <div className="chatbot-float-panel">
              <div className="chatbot-float-header">
                <span style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>
                  🤖 AI 장소 추천
                </span>
                <button
                  type="button"
                  onClick={() => setChatbotOpen(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#999',
                    fontSize: 15,
                    lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              </div>
              <div className="chatbot-float-messages" ref={chatMessagesRef}>
                {chatbotMessages.map((m, i) => (
                  <div key={i} className={`chatbot-float-msg ${m.role}`}>
                    {m.text}
                  </div>
                ))}
                {chatbotBusy && (
                  <div className="chatbot-float-msg assistant">
                    <span className="chatbot-skeleton-dot" />
                    <span className="chatbot-skeleton-dot" />
                    <span className="chatbot-skeleton-dot" />
                  </div>
                )}
              </div>
              <form
                className="chatbot-float-form"
                onSubmit={handleChatbotSubmit}
              >
                <input
                  className="chatbot-float-input"
                  type="text"
                  value={chatbotInput}
                  onChange={e => setChatbotInput(e.target.value)}
                  placeholder="분위기 좋은 카페..."
                  disabled={chatbotBusy}
                  autoFocus
                />
                <button
                  type="submit"
                  className="chatbot-float-send"
                  disabled={chatbotBusy || !chatbotInput.trim()}
                >
                  →
                </button>
              </form>
            </div>
          )}
          <button
            type="button"
            className="chatbot-fab"
            onClick={() => setChatbotOpen(o => !o)}
            aria-label="AI 추천"
          >
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

      <ContactModal isOpen={contactOpen} onClose={() => setContactOpen(false)} />
    </div>
  );
}
