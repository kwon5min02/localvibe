import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import RoadMap from '../components/RoadMap';
import TripChatPanel from '../components/TripChatPanel';
import TripPlaceSearch from '../components/TripPlaceSearch';
import TripSelectModal from '../components/TripSelectModal';
import RegionModal from '../components/RegionModal';
import { normalizeRegionMediaFields, resolveBackendMediaUrl } from '../utils/apiMediaUrl';
import { createTrip, replaceTripPlaces } from '../utils/tripsApi';
import {
  applyScheduleToRegions,
  recomputeScheduleForOrderedLocations,
  TRIP_ITEMS_PER_DAY_DEFAULT,
} from '../utils/tripSchedule';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

const EMPTY_REGION_MAP = new Map();

function TripPlannerPage({
  regionMap,
  scrappedIds = [],
  onToggleScrap,
  currentUser = null,
  myTrips = [],
  onMyTripsChange,
  onRequireLogin,
}) {
  const map = regionMap instanceof Map ? regionMap : EMPTY_REGION_MAP;
  const lookupRegion = id => map.get(Number(id));
  const [roadmapLocations, setRoadmapLocations] = useState([]);
  const [tripDuration, setTripDuration] = useState(null);
  const chatResetRef = useRef(null);
  const [saveModalOpen, setSaveModalOpen] = useState(false);

  const [selectedLocation, setSelectedLocation] = useState(null);
  const [insightLocation, setInsightLocation] = useState(null);
  const [isInsightLoading, setIsInsightLoading] = useState(false);
  const [modalCrawlImages, setModalCrawlImages] = useState([]);
  const [modalArticle, setModalArticle] = useState(null);
  const [modalArticleLoading, setModalArticleLoading] = useState(false);

  const itemsPerDay =
    tripDuration?.itemsPerDay ?? TRIP_ITEMS_PER_DAY_DEFAULT;
  const maxLocations =
    tripDuration?.maxLocations ??
    (tripDuration?.days
      ? tripDuration.days * itemsPerDay
      : null);

  const modalRegion = useMemo(() => {
    if (!selectedLocation) {
      return null;
    }
    if (!insightLocation) {
      return selectedLocation;
    }
    return {
      ...selectedLocation,
      ...insightLocation,
      latitude: insightLocation.latitude ?? selectedLocation.latitude,
      longitude: insightLocation.longitude ?? selectedLocation.longitude,
      address: insightLocation.address || selectedLocation.address || '',
      imageUrl: insightLocation.imageUrl || selectedLocation.imageUrl,
      summary: insightLocation.summary || selectedLocation.summary,
      summaryShort:
        insightLocation.summaryShort || selectedLocation.summaryShort,
    };
  }, [selectedLocation, insightLocation]);

  useEffect(() => {
    let isMounted = true;
    async function fetchLocationInsight() {
      if (!selectedLocation?.id) {
        setInsightLocation(null);
        return;
      }
      setIsInsightLoading(true);
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/regions/${selectedLocation.id}/insight`,
        );
        if (!response.ok) {
          return;
        }
        const data = await response.json();
        if (isMounted && data?.region) {
          setInsightLocation(normalizeRegionMediaFields({ ...data.region }));
        }
      } catch (error) {
        console.error('Failed to fetch location insight:', error);
      } finally {
        if (isMounted) {
          setIsInsightLoading(false);
        }
      }
    }
    fetchLocationInsight();
    return () => {
      isMounted = false;
    };
  }, [selectedLocation]);

  useEffect(() => {
    const id = selectedLocation?.id;
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
        if (cancelled) {
          return;
        }
        const artRes = await fetch(`${API_BASE_URL}/api/places/${id}/article`);
        if (cancelled) {
          return;
        }
        if (artRes.ok) {
          const a = await artRes.json();
          if (!cancelled) {
            setModalArticle({
              title: a.title || '',
              content: a.content || '',
              blocks: Array.isArray(a.blocks) ? a.blocks : [],
            });
          }
        } else if (!cancelled) {
          setModalArticle(null);
        }
      } catch {
        if (!cancelled) {
          setModalArticle(null);
        }
      } finally {
        if (!cancelled) {
          setModalArticleLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedLocation?.id]);

  const handleReplaceLocation = (oldLocationId, newLocationId, schedule = null) => {
    const newRegion = lookupRegion(newLocationId);
    if (!newRegion) {
      return;
    }
    setRoadmapLocations(prev => {
      const next = prev.map(loc =>
        loc.id === oldLocationId ? newRegion : loc,
      );
      const days =
        tripDuration?.days ?? Math.max(1, Math.ceil(next.length / itemsPerDay));
      if (schedule?.length) {
        return applyScheduleToRegions(next, schedule);
      }
      return recomputeScheduleForOrderedLocations(next, days, itemsPerDay);
    });
  };

  const handleTripLocationsChange = (recommendedIds, options = {}) => {
    if (!Array.isArray(recommendedIds) || recommendedIds.length === 0) {
      return;
    }
    const cap = Number.isFinite(options?.maxLocations)
      ? Number(options.maxLocations)
      : null;
    const newRegions = recommendedIds
      .map(id => lookupRegion(id))
      .filter(region => region !== undefined);
    if (newRegions.length === 0) {
      return;
    }

    setRoadmapLocations(prev => {
      const existingIds = new Set(prev.map(loc => loc.id));
      const uniqueNew = newRegions.filter(r => !existingIds.has(r.id));
      const remaining = Number.isFinite(cap)
        ? Math.max(0, cap - prev.length)
        : uniqueNew.length;
      if (remaining <= 0) {
        return prev;
      }
      const merged = [...prev, ...uniqueNew.slice(0, remaining)];
      let withSchedule = applyScheduleToRegions(merged, options.schedule);
      if (!options.schedule?.length && tripDuration?.days) {
        withSchedule = recomputeScheduleForOrderedLocations(
          withSchedule,
          tripDuration.days,
          itemsPerDay,
        );
      }
      return withSchedule;
    });
  };

  const handleTripLocationsReplaceAll = (recommendedIds, schedule = null) => {
    if (!Array.isArray(recommendedIds) || recommendedIds.length === 0) {
      return;
    }
    const next = recommendedIds
      .map(id => lookupRegion(id))
      .filter(region => region !== undefined);
    if (next.length === 0) {
      return;
    }
    let withSchedule = applyScheduleToRegions(next, schedule);
    if (!schedule?.length && tripDuration?.days) {
      withSchedule = recomputeScheduleForOrderedLocations(
        withSchedule,
        tripDuration.days,
        itemsPerDay,
      );
    }
    setRoadmapLocations(withSchedule);
  };

  const handleAddPlaceToRoadmap = region => {
    if (!region?.id) {
      return;
    }
    if (
      Number.isFinite(maxLocations) &&
      roadmapLocations.length >= maxLocations
    ) {
      window.alert('일정이 가득 찼어요. 기간을 늘리거나 장소를 삭제해 주세요.');
      return;
    }
    handleTripLocationsChange([region.id], {
      maxLocations,
      schedule: null,
    });
  };

  const handleRemoveLocation = locationId => {
    setRoadmapLocations(prev => {
      const next = prev.filter(loc => loc.id !== locationId);
      const days =
        tripDuration?.days ?? Math.max(1, Math.ceil(next.length / itemsPerDay));
      return recomputeScheduleForOrderedLocations(next, days, itemsPerDay);
    });
    if (selectedLocation?.id === locationId) {
      setSelectedLocation(null);
      setInsightLocation(null);
    }
  };

  const handleItineraryChange = nextLocations => {
    if (!Array.isArray(nextLocations)) {
      return;
    }
    setRoadmapLocations(nextLocations);
  };

  const handleClearRoadmap = () => {
    if (roadmapLocations.length === 0) {
      return;
    }
    const ok = window.confirm(
      '로드맵의 모든 장소와 채팅을 지울까요? 이 작업은 되돌릴 수 없습니다.',
    );
    if (!ok) {
      return;
    }
    setRoadmapLocations([]);
    setTripDuration(null);
    setSelectedLocation(null);
    setInsightLocation(null);
    chatResetRef.current?.();
  };

  const handleTripMetaChange = meta => {
    if (meta?.duration) {
      setTripDuration(meta.duration);
    }
  };

  const roadmapPlaceIds = useMemo(
    () => roadmapLocations.map(loc => loc.id).filter(id => Number.isFinite(Number(id))),
    [roadmapLocations],
  );

  const mergeTripIntoMyTrips = (updatedTrip) => {
    if (!updatedTrip) return;
    onMyTripsChange?.(prev => {
      const list = Array.isArray(prev) ? prev : myTrips;
      const idx = list.findIndex(t => t.id === updatedTrip.id);
      const normalized = {
        ...updatedTrip,
        places: (updatedTrip.places || []).map(p =>
          normalizeRegionMediaFields({ ...p }),
        ),
      };
      if (idx >= 0) {
        const next = [...list];
        next[idx] = normalized;
        return next;
      }
      return [...list, normalized];
    });
  };

  const handleSaveToExistingTrip = async tripId => {
    if (!currentUser) {
      onRequireLogin?.();
      return;
    }
    if (roadmapLocations.length === 0) {
      window.alert('저장할 장소가 없어요.');
      return;
    }
    try {
      const updated = await replaceTripPlaces(tripId, roadmapPlaceIds);
      mergeTripIntoMyTrips(updated);
      setSaveModalOpen(false);
      window.alert('마이페이지 여행에 일정을 저장했어요.');
    } catch (err) {
      if (err?.message === 'not_logged_in') {
        onRequireLogin?.();
      } else {
        window.alert('저장에 실패했습니다.');
      }
    }
  };

  const handleCreateTripAndSave = async () => {
    if (!currentUser) {
      onRequireLogin?.();
      return;
    }
    if (roadmapLocations.length === 0) {
      window.alert('저장할 장소가 없어요.');
      return;
    }
    const label =
      tripDuration?.days && tripDuration?.nights != null
        ? `${tripDuration.nights}박 ${tripDuration.days}일 여행`
        : `여행 ${new Date().toLocaleDateString('ko-KR')}`;
    const tripName = window.prompt('새 여행 이름', label);
    if (!tripName?.trim()) {
      return;
    }
    try {
      const created = await createTrip(tripName.trim());
      const updated = await replaceTripPlaces(created.id, roadmapPlaceIds);
      mergeTripIntoMyTrips(updated);
      setSaveModalOpen(false);
      window.alert(`"${tripName.trim()}"에 일정을 저장했어요.`);
    } catch (err) {
      if (err?.message === 'not_logged_in') {
        onRequireLogin?.();
      } else {
        window.alert('여행 만들기에 실패했습니다.');
      }
    }
  };

  return (
    <div className="trip-planner-page">
      <div className="trip-planner-header">
        <div>
          <h2>여행 플래너</h2>
          <p className="trip-planner-subtitle">
            채팅·검색으로 채우고, 드래그로 순서·일차를 조정하세요.
          </p>
        </div>
        <div className="trip-planner-stats">
          {tripDuration ? (
            <span className="trip-planner-chip">
              {tripDuration.nights}박 {tripDuration.days}일
              {Number.isFinite(maxLocations)
                ? ` · ${roadmapLocations.length}/${maxLocations}곳`
                : ` · ${roadmapLocations.length}곳`}
            </span>
          ) : (
            <span className="trip-planner-chip">
              {roadmapLocations.length > 0
                ? `${roadmapLocations.length}곳`
                : '일정 없음'}
            </span>
          )}
          {roadmapLocations.length > 0 ? (
            <>
              <button
                type="button"
                className="trip-planner-save-btn"
                onClick={() => {
                  if (!currentUser) {
                    onRequireLogin?.();
                    return;
                  }
                  setSaveModalOpen(true);
                }}
              >
                마이페이지에 저장
              </button>
              <button
                type="button"
                className="trip-planner-clear-btn"
                onClick={handleClearRoadmap}
                title="일정 전체 삭제"
              >
                전체 삭제
              </button>
            </>
          ) : null}
        </div>
      </div>

      <div className="trip-planner-main">
        <div className="trip-planner-left">
          <TripPlaceSearch
            regionMap={map}
            currentLocationIds={roadmapLocations.map(l => l.id)}
            maxLocations={maxLocations}
            onAddPlace={handleAddPlaceToRoadmap}
          />

          <div className="sroadmap-wrapper" id="roadmap-container">
            {roadmapLocations.length === 0 ? (
              <div className="sroadmap-empty">
                <p>채팅이나 위 검색으로 여행 조건·장소를 넣어 보세요.</p>
                <p className="sroadmap-empty-hint">
                  예: &quot;부산 2박 3일, 친구랑 트렌디하게, 절은 빼고&quot;
                </p>
              </div>
            ) : (
              <RoadMap
                locations={roadmapLocations}
                tripDayCount={tripDuration?.days ?? 1}
                itemsPerDay={itemsPerDay}
                onItineraryChange={handleItineraryChange}
                onNodeClick={locationId => {
                  const location = roadmapLocations.find(
                    loc => loc.id === locationId,
                  );
                  if (location) {
                    setSelectedLocation(location);
                    setInsightLocation(null);
                  }
                }}
                onRemoveNode={handleRemoveLocation}
                selectedId={selectedLocation?.id}
                isModalOpen={Boolean(selectedLocation)}
              />
            )}
          </div>
        </div>

        <div className="trip-planner-right">
          <TripChatPanel
            onTripLocationsChange={handleTripLocationsChange}
            onTripLocationsReplaceAll={handleTripLocationsReplaceAll}
            onReplaceLocation={handleReplaceLocation}
            onRemoveLocation={handleRemoveLocation}
            resolveRegionName={id => lookupRegion(id)?.name || null}
            onComparePlaceSelect={id => {
              const region = lookupRegion(id);
              if (region) {
                setSelectedLocation(region);
                setInsightLocation(null);
              }
            }}
            currentLocations={roadmapLocations}
            tripDuration={tripDuration}
            onTripMetaChange={handleTripMetaChange}
            onResetRef={chatResetRef}
          />
        </div>
      </div>

      {saveModalOpen ? (
        <TripSelectModal
          title="어느 여행에 이 일정을 저장할까요?"
          myTrips={myTrips}
          onSelect={handleSaveToExistingTrip}
          onCreateNew={handleCreateTripAndSave}
          onClose={() => setSaveModalOpen(false)}
        />
      ) : null}

      <RegionModal
        region={modalRegion}
        isLoading={isInsightLoading}
        apiBaseUrl={API_BASE_URL}
        crawlImageUrls={modalCrawlImages}
        article={modalArticle}
        articleLoading={modalArticleLoading}
        scrappedIds={scrappedIds}
        onToggleScrap={onToggleScrap}
        onAddToTrip={handleAddPlaceToRoadmap}
        onClose={() => {
          setSelectedLocation(null);
          setInsightLocation(null);
          setModalCrawlImages([]);
          setModalArticle(null);
          setModalArticleLoading(false);
        }}
      />
    </div>
  );
}

export default memo(TripPlannerPage);
