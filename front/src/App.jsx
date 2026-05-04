import { useEffect, useMemo, useState } from 'react';
import TopHeader from './components/TopHeader';
import ChatbotPanel from './components/ChatbotPanel';
import RegionGallery from './components/RegionGallery';
import RegionModal from './components/RegionModal';
import { defaultRegions } from './data/defaultRegions';
import TripPlannerPage from './pages/TripPlannerPage';
import MyPage from './pages/MyPage';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';
const FEED_SIZE = 9;
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
  const [regions, setRegions] = useState(defaultRegions);
  const [displayedRegions, setDisplayedRegions] = useState(defaultRegions);
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
          setRegions(data.regions);
          setDisplayedRegions(pickFeedItems(data.regions));
        }
      } catch {
        // 백엔드 미실행 상태에서도 UI 초안이 보이도록 기본 데이터를 유지합니다.
        setDisplayedRegions(pickFeedItems(defaultRegions));
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
          setInsightRegion(data.region);
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

  const regionMap = useMemo(() => {
    return new Map(regions.map(region => [region.id, region]));
  }, [regions]);

  const handleRecommendFeed = recommendedIds => {
    if (!Array.isArray(recommendedIds) || recommendedIds.length === 0) {
      return;
    }

    const selected = recommendedIds
      .map(id => regionMap.get(Number(id)))
      .filter(Boolean);
    if (selected.length === 0) {
      return;
    }
    const uniqueSelected = [];
    const selectedIdSet = new Set();
    for (const item of selected) {
      if (selectedIdSet.has(item.id)) {
        continue;
      }
      uniqueSelected.push(item);
      selectedIdSet.add(item.id);
      if (uniqueSelected.length >= FEED_SIZE) {
        break;
      }
    }

    if (uniqueSelected.length >= FEED_SIZE) {
      setDisplayedRegions(uniqueSelected.slice(0, FEED_SIZE));
      return;
    }

    const remaining = regions.filter(item => !selectedIdSet.has(item.id));
    const fillCount = FEED_SIZE - uniqueSelected.length;
    const filler = pickFeedItems(remaining, fillCount);
    setDisplayedRegions([...uniqueSelected, ...filler].slice(0, FEED_SIZE));
  };

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
        <aside className="app-sidebar">
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

        <main className="app-shell">
          {/* Conditional Content */}
          {activeTab === 'gallery' ? (
            <>
              <h1 className="top-title">로컬 바이브</h1>
              <p className="gallery-subtitle">
                광주·전남의 숨겨진 명소를 AI로 발견해보세요
              </p>
              <ChatbotPanel onRecommendFeed={handleRecommendFeed} />
              <RegionGallery
                regions={displayedRegions.slice(0, FEED_SIZE)}
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
        onClose={() => {
          setSelectedRegion(null);
          setInsightRegion(null);
        }}
      />
    </div>
  );
}
