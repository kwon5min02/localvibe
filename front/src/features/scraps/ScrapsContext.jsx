import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../shared/auth/AuthContext';
import { addScrap, fetchMyScraps, removeScrap, syncMyScraps } from './scrapsApi';

const ScrapsContext = createContext(null);

export function ScrapsProvider({ children }) {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [scrappedIds, setScrappedIds] = useState([]);

  useEffect(() => {
    if (!currentUser) {
      setScrappedIds([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        let localIds = [];
        try {
          const raw = localStorage.getItem('lv_scraps');
          const parsed = raw ? JSON.parse(raw) : [];
          if (Array.isArray(parsed))
            localIds = parsed.map(Number).filter(Number.isFinite);
        } catch {}
        const result =
          localIds.length > 0
            ? await syncMyScraps(localIds)
            : await fetchMyScraps();
        if (cancelled) return;
        setScrappedIds(result.placeIds);
        if (localIds.length > 0) {
          try { localStorage.removeItem('lv_scraps'); } catch {}
        }
      } catch (err) {
        if (!cancelled && err?.message !== 'not_logged_in')
          console.error('스크랩 목록 로드 실패', err);
      }
    })();
    return () => { cancelled = true; };
  }, [currentUser]);

  const toggleScrap = useCallback(
    async (regionId) => {
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

  return (
    <ScrapsContext.Provider value={{ scrappedIds, toggleScrap }}>
      {children}
    </ScrapsContext.Provider>
  );
}

export function useScraps() {
  const ctx = useContext(ScrapsContext);
  if (!ctx) throw new Error('useScraps must be used inside ScrapsProvider');
  return ctx;
}
