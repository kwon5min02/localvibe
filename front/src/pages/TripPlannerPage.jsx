import { useEffect, useMemo, useState } from 'react';
import RoadMap from '../components/RoadMap';
import TripChatPanel from '../components/TripChatPanel';
import RegionModal from '../components/RegionModal';
import ExportButton from '../components/ExportButton';

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

  // Selected region for detail modal
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [insightLocation, setInsightLocation] = useState(null);
  const [isInsightLoading, setIsInsightLoading] = useState(false);

  // Create a map of region ID -> full region data for quick lookup
  const regionMap = useMemo(() => {
    return new Map(regions.map(region => [region.id, region]));
  }, [regions]);

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
          setInsightLocation(data.region);
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
   * Handle AI recommendations from Trip Chat
   * Merges new recommended regions into roadmap locations
   */
  const handleTripLocationsChange = recommendedIds => {
    if (!Array.isArray(recommendedIds) || recommendedIds.length === 0) {
      return;
    }

    // Get full region objects from recommendedIds
    const newRegions = recommendedIds
      .map(id => regionMap.get(Number(id)))
      .filter(region => region !== undefined);

    if (newRegions.length === 0) {
      return;
    }

    // Merge with existing roadmap locations, avoiding duplicates
    const existingIds = new Set(roadmapLocations.map(loc => loc.id));
    const uniqueNewRegions = newRegions.filter(
      region => !existingIds.has(region.id),
    );

    // Append new regions to roadmap (preserve existing order)
    setRoadmapLocations(prev => [...prev, ...uniqueNewRegions]);
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

  /**
   * Clear entire roadmap
   */
  const handleClearRoadmap = () => {
    setRoadmapLocations([]);
    setSelectedLocation(null);
    setInsightLocation(null);
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
                selectedId={selectedLocation?.id}
              />
            )}

            {/* Export buttons */}
            <ExportButton roadmapLocations={roadmapLocations} />
          </div>
        </div>

        {/* Right: Trip Chat Panel */}
        <div className="trip-planner-right">
          <TripChatPanel
            onTripLocationsChange={handleTripLocationsChange}
            currentLocations={roadmapLocations}
          />
        </div>
      </div>

      {/* Modal for location details */}
      <RegionModal
        region={insightLocation || selectedLocation}
        isLoading={isInsightLoading}
        onClose={() => {
          setSelectedLocation(null);
          setInsightLocation(null);
        }}
      />
    </div>
  );
}
