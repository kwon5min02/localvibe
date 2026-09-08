import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import RoadMap from '../components/RoadMap';
import TripChatPanel from '../components/TripChatPanel';
import TripSelectModal from '../components/TripSelectModal';
import RegionModal from '../components/RegionModal';
import { normalizeRegionMediaFields, resolveBackendMediaUrl } from '../utils/apiMediaUrl';
import { createTrip, replaceTripPlaces } from '../features/trips/tripsApi';
import {
  applyScheduleToRegions,
  recomputeScheduleForOrderedLocations,
  TRIP_ITEMS_PER_DAY_DEFAULT,
} from '../utils/tripSchedule';
import {
  clearGuestPlannerDraft,
  clearTripPlannerDraft,
  getPlannerUserId,
  hydratePlannerPlaces,
  readTripPlannerDraft,
  restorePlannerMessages,
  saveTripPlannerDraft,
  serializePlannerMessages,
  serializePlannerPlaces,
} from '../utils/tripPlannerPersist';

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
  const plannerUserId = getPlannerUserId(currentUser);
  const plannerDraftRef = useRef(null);
  const persistReadyRef = useRef(false);
  const persistTimerRef = useRef(null);
  const messagesForPersistRef = useRef(null);
  const roadmapLocationsRef = useRef([]);
  const tripDurationRef = useRef(null);
  const chatResetRef = useRef(null);
  const chatNewRef = useRef(null);
  const [chatSessionKey, setChatSessionKey] = useState(0);
  const [saveModalOpen, setSaveModalOpen] = useState(false);

  const [roadmapLocations, setRoadmapLocations] = useState([]);
  const [tripDuration, setTripDuration] = useState(null);

  const chatInitialMessages = useMemo(() => {
    if (!plannerUserId) return null;
    const draft = readTripPlannerDraft(plannerUserId);
    return restorePlannerMessages(draft?.messages);
  }, [plannerUserId, chatSessionKey]);

  const flushPersist = useCallback(() => {
    if (!plannerUserId || !persistReadyRef.current) {
      return;
    }
    const serializedPlaces = serializePlannerPlaces(roadmapLocationsRef.current);
    const fallbackPlaces = plannerDraftRef.current?.placeEntries ?? [];
    saveTripPlannerDraft(plannerUserId, {
      placeEntries:
        serializedPlaces.length > 0 ? serializedPlaces : fallbackPlaces,
      tripDuration: tripDurationRef.current,
      messages: serializePlannerMessages(messagesForPersistRef.current),
    });
    plannerDraftRef.current = readTripPlannerDraft(plannerUserId);
  }, [plannerUserId]);

  const schedulePersist = useCallback(() => {
    if (!plannerUserId || !persistReadyRef.current) {
      return;
    }
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = setTimeout(flushPersist, 300);
  }, [plannerUserId, flushPersist]);

  const handleMessagesChange = useCallback(
    messages => {
      messagesForPersistRef.current = messages;
      if (!persistReadyRef.current) {
        return;
      }
      schedulePersist();
    },
    [schedulePersist],
  );

  useEffect(() => {
    clearGuestPlannerDraft();
    persistReadyRef.current = false;

    if (!plannerUserId) {
      plannerDraftRef.current = null;
      setRoadmapLocations([]);
      setTripDuration(null);
      setChatSessionKey(k => k + 1);
      return undefined;
    }

    const draft = readTripPlannerDraft(plannerUserId);
    plannerDraftRef.current = draft;

    if (draft?.placeEntries?.length) {
      const hydrated = hydratePlannerPlaces(draft.placeEntries, EMPTY_REGION_MAP).map(
        r => normalizeRegionMediaFields(r),
      );
      setRoadmapLocations(hydrated);
    } else {
      setRoadmapLocations([]);
    }
    setTripDuration(draft?.tripDuration ?? null);
    setChatSessionKey(k => k + 1);

    const t = setTimeout(() => {
      persistReadyRef.current = true;
      flushPersist();
    }, 400);
    return () => clearTimeout(t);
  }, [plannerUserId, flushPersist]);

  useEffect(() => {
    if (!plannerUserId || map.size === 0) {
      return;
    }
    const draft = plannerDraftRef.current;
    if (!draft?.placeEntries?.length) {
      return;
    }
    const hydrated = hydratePlannerPlaces(draft.placeEntries, map).map(r =>
      normalizeRegionMediaFields(r),
    );
    if (hydrated.length === 0) {
      return;
    }
    setRoadmapLocations(prev => {
      if (prev.length === 0) {
        return hydrated;
      }
      const prevIds = prev.map(l => l.id).join(',');
      const nextIds = hydrated.map(l => l.id).join(',');
      return prevIds === nextIds ? prev : hydrated;
    });
  }, [map, plannerUserId]);

  useEffect(() => {
    roadmapLocationsRef.current = roadmapLocations;
    schedulePersist();
  }, [roadmapLocations, schedulePersist]);

  useEffect(() => {
    tripDurationRef.current = tripDuration;
    schedulePersist();
  }, [tripDuration, schedulePersist]);

  useEffect(
    () => () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
      }
    },
    [],
  );

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
    if (plannerUserId) {
      clearTripPlannerDraft(plannerUserId);
    }
    plannerDraftRef.current = null;
    chatResetRef.current?.();
  };

  const handleNewChat = useCallback(() => {
    setRoadmapLocations([]);
    setTripDuration(null);
    setSelectedLocation(null);
    setInsightLocation(null);
    chatNewRef.current?.();
    if (plannerUserId && persistReadyRef.current) {
      window.setTimeout(() => flushPersist(), 80);
    }
  }, [plannerUserId, flushPersist]);

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
        </div>
        {/* 장소가 없어도 자리를 유지해 레이아웃이 튀지 않게 한다. */}
        <div className="trip-planner-stats">
          <button
            type="button"
            className="trip-planner-save-btn"
            disabled={roadmapLocations.length === 0}
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
            disabled={roadmapLocations.length === 0}
            onClick={handleClearRoadmap}
            title="일정 전체 삭제"
          >
            전체 삭제
          </button>
        </div>
      </div>

      <div className="trip-planner-main">
        <div className="trip-planner-left">
          <div className="sroadmap-wrapper" id="roadmap-container">
            {roadmapLocations.length === 0 ? (
              <div className="sroadmap-empty">
                <p>오른쪽 채팅으로 여행 조건과 장소를 넣어 보세요.</p>
                <p className="sroadmap-empty-hint">
                  예: &quot;여수 1박 2일, 친구랑 바다 보면서 여유롭게&quot;
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
            key={`${plannerUserId ?? 'guest'}-${chatSessionKey}`}
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
            onNewChatRef={chatNewRef}
            onNewChat={handleNewChat}
            initialMessages={chatInitialMessages}
            onMessagesChange={handleMessagesChange}
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
