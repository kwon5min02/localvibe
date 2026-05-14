import { useEffect, useRef, useState } from 'react';

const KAKAO_JS_KEY =
  import.meta.env.VITE_KAKAO_JS_KEY || '0da5b46d0248e671b357568d3720d935';
const KAKAO_SCRIPT_ID = 'kakao-map-sdk-script';

function loadKakaoSdk() {
  return new Promise((resolve, reject) => {
    if (window.kakao?.maps?.load) {
      window.kakao.maps.load(() => resolve(window.kakao));
      return;
    }

    const existing = document.getElementById(KAKAO_SCRIPT_ID);
    if (existing) {
      existing.addEventListener(
        'load',
        () => {
          window.kakao?.maps?.load(() => resolve(window.kakao));
        },
        { once: true },
      );
      existing.addEventListener('error', () => reject(new Error('sdk_blocked')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = KAKAO_SCRIPT_ID;
    script.async = true;
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_JS_KEY}&autoload=false`;
    script.onload = () => {
      if (!window.kakao?.maps?.load) { reject(new Error('sdk_blocked')); return; }
      window.kakao.maps.load(() => resolve(window.kakao));
    };
    script.onerror = () => reject(new Error('sdk_blocked'));
    document.head.appendChild(script);
    setTimeout(() => reject(new Error('sdk_timeout')), 5000);
  });
}

export default function MultiMarkerMap({ locations = [] }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const boundsRef = useRef(null);
  const [error, setError] = useState('');
  const [noCoordCount, setNoCoordCount] = useState(0);

  const validLocations = locations.filter(
    loc =>
      loc.latitude != null &&
      loc.longitude != null &&
      Number.isFinite(Number(loc.latitude)) &&
      Number.isFinite(Number(loc.longitude)),
  );

  useEffect(() => {
    if (!validLocations.length) return;
    let active = true;

    console.log('[MultiMarkerMap] validLocations:', validLocations);

    loadKakaoSdk()
      .then(kakao => {
        if (!active || !mapRef.current) return;
        console.log('[MultiMarkerMap] SDK loaded, container size:', mapRef.current.offsetWidth, 'x', mapRef.current.offsetHeight);

        mapRef.current.innerHTML = '';

        const map = new kakao.maps.Map(mapRef.current, {
          center: new kakao.maps.LatLng(36.5, 127.5),
          level: 10,
        });
        mapInstanceRef.current = map;

        const bounds = new kakao.maps.LatLngBounds();
        let openInfoWindow = null;

        validLocations.forEach(loc => {
          const position = new kakao.maps.LatLng(
            Number(loc.latitude),
            Number(loc.longitude),
          );
          bounds.extend(position);

          const marker = new kakao.maps.Marker({ map, position });
          const info = new kakao.maps.InfoWindow({
            content: `<div style="padding:6px 10px;font-size:13px;font-weight:600;white-space:nowrap">${loc.name}</div>`,
          });

          kakao.maps.event.addListener(marker, 'click', () => {
            if (openInfoWindow) openInfoWindow.close();
            info.open(map, marker);
            openInfoWindow = info;
          });
        });

        boundsRef.current = bounds;
        if (!bounds.isEmpty()) map.setBounds(bounds);
        setNoCoordCount(locations.length - validLocations.length);

        [0, 180, 420, 800].forEach(delay => {
          setTimeout(() => {
            if (!active || !mapInstanceRef.current) return;
            mapInstanceRef.current.relayout();
            if (boundsRef.current && !boundsRef.current.isEmpty()) {
              mapInstanceRef.current.setBounds(boundsRef.current);
            }
          }, delay);
        });
      })
      .catch(err => {
        if (!active) return;
        const msg = String(err?.message || '');
        if (msg.includes('sdk_blocked')) setError('카카오 SDK 로드가 차단되었습니다.');
        else if (msg.includes('sdk_timeout')) setError('카카오 SDK 로드 시간이 초과되었습니다.');
        else setError('지도를 불러오지 못했습니다.');
      });

    return () => { active = false; };
  }, []);

  // ResizeObserver: 팝업 크기 변화 시 relayout
  useEffect(() => {
    if (!mapRef.current) return undefined;

    const relayout = () => {
      if (!mapInstanceRef.current) return;
      mapInstanceRef.current.relayout();
      if (boundsRef.current && !boundsRef.current.isEmpty()) {
        mapInstanceRef.current.setBounds(boundsRef.current);
      }
    };

    const ro = new ResizeObserver(relayout);
    ro.observe(mapRef.current);
    window.addEventListener('resize', relayout);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', relayout);
    };
  }, []);

  if (!validLocations.length) {
    return <p className="ui-empty">지도에 표시할 좌표 정보가 없어요.</p>;
  }

  return (
    <div className="multi-marker-map-wrap">
      <p className="multi-marker-map-title">
        📍 현재 일정 {validLocations.length}개 장소
      </p>
      {error ? (
        <p className="multi-marker-map-error">{error}</p>
      ) : (
        <div ref={mapRef} className="multi-marker-map-canvas" />
      )}
      {noCoordCount > 0 && (
        <p className="multi-marker-map-skipped">
          좌표 정보 없어 표시 못한 장소: {noCoordCount}개
        </p>
      )}
    </div>
  );
}
