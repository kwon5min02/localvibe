import { useEffect, useMemo, useRef, useState } from 'react';
import RoadMap from '../components/RoadMap';
import TripChatPanel from '../components/TripChatPanel';
import RegionModal from '../components/RegionModal';
import ExportButton from '../components/ExportButton';
import { normalizeRegionMediaFields, resolveBackendMediaUrl } from '../utils/apiMediaUrl';
import { syncTripFromPlanner } from '../utils/api';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

// ── localStorage 키 ──────────────────────────────────────────────────────────
const ROADMAP_STORAGE_KEY = 'lv_trip_roadmap';

function saveRoadmap(locations) {
  try {
    localStorage.setItem(ROADMAP_STORAGE_KEY, JSON.stringify(locations.map(l => l.id)));
  } catch {}
}

function loadRoadmapIds() {
  try {
    const raw = localStorage.getItem(ROADMAP_STORAGE_KEY);
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export default function TripPlannerPage({ regions = [], scrappedIds = [], onToggleScrap,onAddToTrip }) {
  // [수정] roadmapLocations를 localStorage에서 복원
  const [roadmapLocations, setRoadmapLocations] = useState(() => []);
  const [isRestoringRoadmap, setIsRestoringRoadmap] = useState(true);
  const chatResetRef = useRef(null);

  const [selectedLocation, setSelectedLocation] = useState(null);
  const [insightLocation, setInsightLocation] = useState(null);
  const [isInsightLoading, setIsInsightLoading] = useState(false);
  const [modalCrawlImages, setModalCrawlImages] = useState([]);
  const [modalArticle, setModalArticle] = useState(null);
  const [modalArticleLoading, setModalArticleLoading] = useState(false);

  // 저장 피드백 상태
  const [saveStatus, setSaveStatus] = useState(null); // null | 'saving' | 'saved' | 'error'

  const regionMap = useMemo(() => new Map(regions.map(r => [r.id, r])), [regions]);

  // [수정] regions 로드 후 localStorage에서 roadmap 복원
  useEffect(() => {
    if (!regions.length) return;
    const savedIds = loadRoadmapIds();
    if (savedIds.length > 0) {
      const restored = savedIds
        .map(id => regionMap.get(Number(id)))
        .filter(Boolean);
      if (restored.length > 0) setRoadmapLocations(restored);
    }
    setIsRestoringRoadmap(false);
  }, [regions]); // eslint-disable-line react-hooks/exhaustive-deps

  // [수정] roadmapLocations 변경 시 localStorage에 저장
  useEffect(() => {
    if (isRestoringRoadmap) return; // 복원 중엔 저장 안 함
    saveRoadmap(roadmapLocations);
  }, [roadmapLocations, isRestoringRoadmap]);

  useEffect(() => {
    let isMounted = true;
    if (!selectedLocation?.id) { setInsightLocation(null); return; }
    setIsInsightLoading(true);
    fetch(`${API_BASE_URL}/api/regions/${selectedLocation.id}/insight`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (isMounted && data?.region) setInsightLocation(normalizeRegionMediaFields({ ...data.region })); })
      .catch(() => {})
      .finally(() => { if (isMounted) setIsInsightLoading(false); });
    return () => { isMounted = false; };
  }, [selectedLocation]);

  useEffect(() => {
    const id = selectedLocation?.id;
    if (!id) { setModalCrawlImages([]); setModalArticle(null); setModalArticleLoading(false); return; }
    let cancelled = false;
    setModalCrawlImages([]); setModalArticle(null); setModalArticleLoading(true);
    (async () => {
      try {
        await fetch(`${API_BASE_URL}/api/places/${id}/crawl`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        if (cancelled) return;
        const imgRes = await fetch(`${API_BASE_URL}/api/places/${id}/images`);
        if (imgRes.ok && !cancelled) { const d = await imgRes.json(); setModalCrawlImages((d.images || []).map(x => x.url).filter(Boolean).map(u => resolveBackendMediaUrl(u))); }
        if (cancelled) return;
        const artRes = await fetch(`${API_BASE_URL}/api/places/${id}/article`);
        if (cancelled) return;
        if (artRes.ok) { const a = await artRes.json(); if (!cancelled) setModalArticle({ title: a.title || '', content: a.content || '' }); }
        else if (!cancelled) setModalArticle(null);
      } catch { if (!cancelled) setModalArticle(null); }
      finally { if (!cancelled) setModalArticleLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [selectedLocation?.id]);

  const modalRegion = useMemo(() => {
    if (!selectedLocation) return null;
    if (!insightLocation) return selectedLocation;
    return {
      ...selectedLocation, ...insightLocation,
      latitude: insightLocation.latitude ?? selectedLocation.latitude,
      longitude: insightLocation.longitude ?? selectedLocation.longitude,
      address: insightLocation.address || selectedLocation.address || '',
      imageUrl: insightLocation.imageUrl || selectedLocation.imageUrl,
      summary: insightLocation.summary || selectedLocation.summary,
    };
  }, [selectedLocation, insightLocation]);

  const handleReplaceLocation = (oldLocationId, newLocationId) => {
    const newRegion = regionMap.get(Number(newLocationId));
    if (!newRegion) return;
    setRoadmapLocations(prev => prev.map(loc => loc.id === oldLocationId ? newRegion : loc));
  };

  const resolveRegionName = regionId => regionMap.get(Number(regionId))?.name || null;

  const handleTripLocationsChange = (recommendedIds, options = {}) => {
    if (!Array.isArray(recommendedIds) || !recommendedIds.length) return;
    const maxLocations = Number.isFinite(options?.maxLocations) ? Number(options.maxLocations) : null;
    const newRegions = recommendedIds.map(id => regionMap.get(Number(id))).filter(Boolean);
    if (!newRegions.length) return;
    setRoadmapLocations(prev => {
      const existingIds = new Set(prev.map(loc => loc.id));
      const unique = newRegions.filter(r => !existingIds.has(r.id));
      if (!unique.length) return prev;
      const remaining = Number.isFinite(maxLocations) ? Math.max(0, maxLocations - prev.length) : unique.length;
      if (remaining <= 0) return prev;
      return [...prev, ...unique.slice(0, remaining)];
    });
  };

  const handleTripLocationsReplaceAll = recommendedIds => {
    if (!Array.isArray(recommendedIds) || !recommendedIds.length) return;
    const next = recommendedIds.map(id => regionMap.get(Number(id))).filter(Boolean);
    if (next.length) setRoadmapLocations(next);
  };

  const handleRemoveLocation = locationId => {
    setRoadmapLocations(prev => prev.filter(loc => loc.id !== locationId));
    if (selectedLocation?.id === locationId) { setSelectedLocation(null); setInsightLocation(null); }
  };

  const handleMoveLocation = (fromIndex, toIndex) => {
    setRoadmapLocations(prev => {
      if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex < 0 || toIndex < 0 || fromIndex >= prev.length || fromIndex === toIndex) return prev;
      const nextIndex = Math.max(0, Math.min(prev.length - 1, toIndex));
      if (nextIndex === fromIndex) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(nextIndex, 0, moved);
      return next;
    });
  };

  const handleClearRoadmap = () => {
    setRoadmapLocations([]);
    setSelectedLocation(null);
    setInsightLocation(null);
    chatResetRef.current?.();
    try { localStorage.removeItem(ROADMAP_STORAGE_KEY); } catch {}
  };

  // [추가] 여행플래너 → 마이페이지 일정 저장
  const handleSaveToMyPage = async () => {
    if (!roadmapLocations.length) return;
    const token = localStorage.getItem('lv_access_token');
    if (!token) {
      window.alert('로그인 후 이용할 수 있어요.');
      return;
    }
    const tripName = window.prompt(
      '마이페이지에 저장할 여행 이름을 입력하세요:',
      `여행 ${new Date().toLocaleDateString('ko-KR')}`,
    );
    if (!tripName?.trim()) return;
    setSaveStatus('saving');
    try {
      await syncTripFromPlanner(tripName.trim(), roadmapLocations.map(l => l.id));
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(null), 3000);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus(null), 3000);
    }
  };

  return (
    <div className="trip-planner-page">
      <div className="trip-planner-header">
        <h2>My Trip Planner</h2>
        <div className="trip-planner-stats">
          <span>{roadmapLocations.length} locations</span>
          {roadmapLocations.length > 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {/* [추가] 마이페이지 저장 버튼 */}
              <button
                className="trip-planner-save-btn"
                onClick={handleSaveToMyPage}
                disabled={saveStatus === 'saving'}
                title="이 일정을 마이페이지에 저장"
              >
                {saveStatus === 'saving' ? '저장 중…' : saveStatus === 'saved' ? '✓ 저장됨' : saveStatus === 'error' ? '저장 실패' : '📋 마이페이지에 저장'}
              </button>
              <button className="trip-planner-clear-btn" onClick={handleClearRoadmap}>
                Clear All
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="trip-planner-main">
        <div className="trip-planner-left">
          <div className="sroadmap-wrapper" id="roadmap-container">
            {roadmapLocations.length === 0 ? (
              <div className="sroadmap-empty">
                <p>👉 Start chatting to add locations to your itinerary</p>
              </div>
            ) : (
              <RoadMap
                locations={roadmapLocations}
                onNodeClick={locationId => {
                  const location = roadmapLocations.find(loc => loc.id === locationId);
                  if (location) { setSelectedLocation(location); setInsightLocation(null); }
                }}
                onRemoveNode={handleRemoveLocation}
                onMoveNode={handleMoveLocation}
                selectedId={selectedLocation?.id}
                isModalOpen={Boolean(selectedLocation)}
              />
            )}
            <ExportButton roadmapLocations={roadmapLocations} />
          </div>
        </div>

        <div className="trip-planner-right">
          <TripChatPanel
            onTripLocationsChange={handleTripLocationsChange}
            onTripLocationsReplaceAll={handleTripLocationsReplaceAll}
            onReplaceLocation={handleReplaceLocation}
            onRemoveLocation={handleRemoveLocation}
            resolveRegionName={resolveRegionName}
            currentLocations={roadmapLocations}
            onResetRef={chatResetRef}
          />
        </div>
      </div>

      <RegionModal
        region={modalRegion}
        isLoading={isInsightLoading}
        apiBaseUrl={API_BASE_URL}
        crawlImageUrls={modalCrawlImages}
        article={modalArticle}
        articleLoading={modalArticleLoading}
        scrappedIds={scrappedIds}
        onToggleScrap={onToggleScrap}
        onAddToTrip={onAddToTrip}   // ← 추가
        onClose={() => {
          setSelectedLocation(null); setInsightLocation(null);
          setModalCrawlImages([]); setModalArticle(null); setModalArticleLoading(false);
        }}
      />
    </div>
  );
}
