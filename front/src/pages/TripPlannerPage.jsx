import { useEffect, useMemo, useRef, useState } from 'react';
import RoadMap from '../components/RoadMap';
import TripChatPanel from '../components/TripChatPanel';
import RegionModal from '../components/RegionModal';
import ExportButton from '../components/ExportButton';
import MultiMarkerMap from '../components/ui/MultiMarkerMap';
import { normalizeRegionMediaFields } from '../utils/apiMediaUrl';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

/**
 * TripPlannerPage Component
 * Split-screen layout: Left (RoadMap with locations), Right (TripChatPanel)
 * Shows a dynamic travel itinerary built through AI recommendations
 */
export default function TripPlannerPage({ regions = [] }) {
  // Roadmap locations (user's selected trip itinerary)
  const [roadmapLocations, setRoadmapLocations] = useState([]);
  const chatResetRef = useRef(null);

  // Selected region for detail modal
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [insightLocation, setInsightLocation] = useState(null);
  const [isInsightLoading, setIsInsightLoading] = useState(false);

  // Create a map of region ID -> full region data for quick lookup
  const regionMap = useMemo(() => {
    return new Map(regions.map(region => [region.id, region]));
  }, [regions]);

  /** 모달: 인사이트가 좌표를 비우는 경우에도 로드맵에 있던 주소·좌표 유지 */
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

  // Fetch detailed insight for selected location
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

  /**
   * Handle location replacement in roadmap
   * Replaces old location with new one at the same position
   */
  const handleReplaceLocation = (oldLocationId, newLocationId) => {
    const newRegion = regionMap.get(Number(newLocationId));
    if (!newRegion) {
      return;
    }

    setRoadmapLocations(prev =>
      prev.map(loc => (loc.id === oldLocationId ? newRegion : loc)),
    );
  };

  const resolveRegionName = regionId => {
    const region = regionMap.get(Number(regionId));
    return region?.name || null;
  };

  /**
   * Handle AI recommendations from Trip Chat
   * Merges new recommended regions into roadmap locations
   */
  const handleTripLocationsChange = (recommendedIds, options = {}) => {
    if (!Array.isArray(recommendedIds) || recommendedIds.length === 0) {
      return;
    }

    const maxLocations = Number.isFinite(options?.maxLocations)
      ? Number(options.maxLocations)
      : null;
    const requestedAddCount = Number.isFinite(options?.requestedAddCount)
      ? Number(options.requestedAddCount)
      : null;

    // Get full region objects from recommendedIds
    const newRegions = recommendedIds
      .map(id => regionMap.get(Number(id)))
      .filter(region => region !== undefined);

    if (newRegions.length === 0) {
      return;
    }

    setRoadmapLocations(prev => {
      const existingIds = new Set(prev.map(loc => loc.id));
      const uniqueNewRegions = newRegions.filter(
        region => !existingIds.has(region.id),
      );

      if (uniqueNewRegions.length === 0) {
        return prev;
      }

      const remainingSlots = Number.isFinite(maxLocations)
        ? Math.max(0, maxLocations - prev.length)
        : uniqueNewRegions.length;
      if (remainingSlots <= 0) {
        return prev;
      }

      // 추가하려던 개수 만큼만 가져오기
      // (이미 존재하는 것들이 필터링되었으므로)
      const addCount = Math.min(uniqueNewRegions.length, remainingSlots);
      if (addCount <= 0) {
        return prev;
      }

      return [...prev, ...uniqueNewRegions.slice(0, addCount)];
    });
  };

  /**
   * 전체 재계획(replan): 추천 id 순서대로 로드맵을 통째로 교체
   */
  const handleTripLocationsReplaceAll = recommendedIds => {
    if (!Array.isArray(recommendedIds) || recommendedIds.length === 0) {
      return;
    }
    const next = recommendedIds
      .map(id => regionMap.get(Number(id)))
      .filter(region => region !== undefined);
    if (next.length === 0) {
      return;
    }
    setRoadmapLocations(next);
  };

  /**
   * Remove a location from the roadmap
   */
  const handleRemoveLocation = locationId => {
    setRoadmapLocations(prev => prev.filter(loc => loc.id !== locationId));
    if (selectedLocation?.id === locationId) {
      setSelectedLocation(null);
      setInsightLocation(null);
    }
  };

  const handleMoveLocation = (fromIndex, toIndex) => {
    setRoadmapLocations(prev => {
      if (
        !Number.isInteger(fromIndex) ||
        !Number.isInteger(toIndex) ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= prev.length ||
        fromIndex === toIndex
      ) {
        return prev;
      }

      const nextIndex = Math.max(0, Math.min(prev.length - 1, toIndex));
      if (nextIndex === fromIndex) {
        return prev;
      }

      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(nextIndex, 0, moved);
      return next;
    });
  };

  /**
   * Clear entire roadmap
   */
  const handleClearRoadmap = () => {
    setRoadmapLocations([]);
    setSelectedLocation(null);
    setInsightLocation(null);
    chatResetRef.current?.();
  };

  return (
    <div className="trip-planner-page">
      {/* Header section */}
      <div className="trip-planner-header">
        <h2>My Trip Planner</h2>
        <div className="trip-planner-stats">
          <span>{roadmapLocations.length} locations</span>
          {roadmapLocations.length > 0 && (
            <button
              className="trip-planner-clear-btn"
              onClick={handleClearRoadmap}
              title="Clear all locations"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Main split-screen container */}
      <div className="trip-planner-main">
        {/* Left: Roadmap */}
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
                  const location = roadmapLocations.find(
                    loc => loc.id === locationId,
                  );
                  if (location) {
                    setSelectedLocation(location);
                    setInsightLocation(null);
                  }
                }}
                onRemoveNode={handleRemoveLocation}
                onMoveNode={handleMoveLocation}
                selectedId={selectedLocation?.id}
                isModalOpen={Boolean(selectedLocation)}
              />
            )}

            {roadmapLocations.length > 0 && (
              <section
                className="trip-planner-route-map"
                aria-label="일정 전체 지도"
              >
                <h3 className="trip-planner-route-map-title">일정 지도</h3>
                <MultiMarkerMap locations={roadmapLocations} />
              </section>
            )}

            {/* Export buttons */}
            <ExportButton roadmapLocations={roadmapLocations} />
          </div>
        </div>

        {/* Right: Trip Chat Panel */}
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

      {/* Modal for location details */}
      <RegionModal
        region={modalRegion}
        isLoading={isInsightLoading}
        apiBaseUrl={API_BASE_URL}
        onClose={() => {
          setSelectedLocation(null);
          setInsightLocation(null);
        }}
      />
    </div>
  );
}
