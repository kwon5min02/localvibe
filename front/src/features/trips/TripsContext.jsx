import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../shared/auth/AuthContext';
import { normalizeRegionMediaFields } from '../../utils/apiMediaUrl';
import {
  addPlaceToTrip,
  createTrip,
  deleteTrip,
  renameTrip,
  replaceTripPlaces,
  fetchMyTrips,
  removePlaceFromTrip,
  syncMyTrips,
} from './tripsApi';

const TripsContext = createContext(null);

function normalizePlaces(trip) {
  return {
    ...trip,
    places: (trip.places || []).map(p => normalizeRegionMediaFields({ ...p })),
  };
}

export function TripsProvider({ children }) {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [myTrips, setMyTrips] = useState([]);

  useEffect(() => {
    if (!currentUser) {
      setMyTrips([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        let localTrips = [];
        try {
          const raw = localStorage.getItem('lv_my_trips');
          const parsed = raw ? JSON.parse(raw) : [];
          if (Array.isArray(parsed)) localTrips = parsed;
        } catch {}
        const trips =
          localTrips.length > 0
            ? await syncMyTrips(localTrips)
            : await fetchMyTrips();
        if (cancelled) return;
        setMyTrips(trips.map(normalizePlaces));
        if (localTrips.length > 0) {
          try { localStorage.removeItem('lv_my_trips'); } catch {}
        }
      } catch (err) {
        if (!cancelled && err?.message !== 'not_logged_in')
          console.error('여행 일정 로드 실패', err);
      }
    })();
    return () => { cancelled = true; };
  }, [currentUser]);

  const requireLogin = useCallback(() => {
    window.alert('여행 일정은 로그인 후 저장됩니다.');
    navigate('/login');
  }, [navigate]);

  const handleCreateTrip = useCallback(
    async (name) => {
      if (!currentUser) { requireLogin(); return null; }
      const trip = await createTrip(name);
      const normalized = normalizePlaces(trip);
      setMyTrips(prev => [...prev, normalized]);
      return normalized;
    },
    [currentUser, requireLogin],
  );

  const handleDeleteTrip = useCallback(
    async (tripId) => {
      if (!currentUser) { requireLogin(); return; }
      await deleteTrip(tripId);
      setMyTrips(prev => prev.filter(t => t.id !== tripId));
    },
    [currentUser, requireLogin],
  );

  const handleRenameTrip = useCallback(
    async (tripId, name) => {
      if (!currentUser) { requireLogin(); return; }
      const updated = await renameTrip(tripId, name);
      setMyTrips(prev =>
        prev.map(t => (t.id === tripId ? normalizePlaces(updated) : t)),
      );
    },
    [currentUser, requireLogin],
  );

  const handleAddPlaceToTrip = useCallback(
    async (tripId, place) => {
      if (!currentUser) { requireLogin(); return; }
      const region = normalizeRegionMediaFields({ ...place });
      setMyTrips(prev => {
        const trip = prev.find(t => t.id === tripId);
        if (trip?.places?.some(p => p.id === region.id)) {
          window.alert('이미 담긴 장소예요!');
          return prev;
        }
        return prev;
      });
      const trip = myTrips.find(t => t.id === tripId);
      if (trip?.places?.some(p => p.id === region.id)) return;
      const updated = await addPlaceToTrip(tripId, region.id);
      setMyTrips(prev =>
        prev.map(t => (t.id === tripId ? normalizePlaces(updated) : t)),
      );
    },
    [currentUser, myTrips, requireLogin],
  );

  const handleReorderTripPlaces = useCallback(
    async (tripId, placeIds) => {
      if (!currentUser) { requireLogin(); return; }
      const updated = await replaceTripPlaces(tripId, placeIds);
      setMyTrips(prev =>
        prev.map(t => (t.id === tripId ? normalizePlaces(updated) : t)),
      );
    },
    [currentUser, requireLogin],
  );

  const handleRemovePlaceFromTrip = useCallback(
    async (tripId, placeId) => {
      if (!currentUser) { requireLogin(); return; }
      const updated = await removePlaceFromTrip(tripId, placeId);
      setMyTrips(prev =>
        prev.map(t => (t.id === tripId ? normalizePlaces(updated) : t)),
      );
    },
    [currentUser, requireLogin],
  );

  return (
    <TripsContext.Provider
      value={{
        myTrips,
        setMyTrips,
        requireLogin,
        onCreateTrip: handleCreateTrip,
        onDeleteTrip: handleDeleteTrip,
        onRenameTrip: handleRenameTrip,
        onReorderTripPlaces: handleReorderTripPlaces,
        onAddPlaceToTrip: handleAddPlaceToTrip,
        onRemovePlaceFromTrip: handleRemovePlaceFromTrip,
      }}
    >
      {children}
    </TripsContext.Provider>
  );
}

export function useTrips() {
  const ctx = useContext(TripsContext);
  if (!ctx) throw new Error('useTrips must be used inside TripsProvider');
  return ctx;
}
