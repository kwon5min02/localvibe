import { useEffect, useMemo, useRef, useState } from 'react';

const KAKAO_JS_KEY =
  import.meta.env.VITE_KAKAO_JS_KEY || '0da5b46d0248e671b357568d3720d935';
const KAKAO_SCRIPT_ID = 'kakao-map-sdk-script';

function loadKakaoSdk() {
  return new Promise((resolve, reject) => {
    if (!KAKAO_JS_KEY) {
      reject(new Error('sdk_blocked'));
      return;
    }

    const hasGeocoder = Boolean(window.kakao?.maps?.services?.Geocoder);
    if (window.kakao?.maps?.load && hasGeocoder) {
      window.kakao.maps.load(() => resolve(window.kakao));
      return;
    }

    if (
      document.getElementById(KAKAO_SCRIPT_ID) &&
      window.kakao?.maps?.load &&
      !window.kakao?.maps?.services?.Geocoder
    ) {
      const stale = document.getElementById(KAKAO_SCRIPT_ID);
      if (stale) stale.remove();
      try {
        delete window.kakao;
      } catch (_) {
        window.kakao = undefined;
      }
    }

    if (window.kakao?.maps?.load && window.kakao?.maps?.services?.Geocoder) {
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
      existing.addEventListener('error', () => reject(new Error('sdk_blocked')), {
        once: true,
      });
      return;
    }

    const script = document.createElement('script');
    script.id = KAKAO_SCRIPT_ID;
    script.async = true;
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_JS_KEY}&autoload=false&libraries=services`;
    script.onload = () => {
      if (!window.kakao?.maps?.load) {
        reject(new Error('sdk_blocked'));
        return;
      }
      window.kakao.maps.load(() => resolve(window.kakao));
    };
    script.onerror = () => reject(new Error('sdk_blocked'));
    document.head.appendChild(script);
    setTimeout(() => reject(new Error('sdk_timeout')), 8000);
  });
}

function hasCoord(loc) {
  return (
    loc.latitude != null &&
    loc.longitude != null &&
    Number.isFinite(Number(loc.latitude)) &&
    Number.isFinite(Number(loc.longitude))
  );
}

/** API에 address가 비어 있고 본문에만 주소가 있는 경우 */
function pickAddress(loc) {
  const a = String(loc.address || '').trim();
  if (a) {
    return a;
  }
  const blob = [loc.summary, loc.description]
    .map(x => String(x || ''))
    .join(' ');
  const m = blob.match(/주소[:\s]*([^\n]+?)(?:\n|$)/);
  if (m) {
    return m[1].trim();
  }
  return '';
}

function geocodeAddress(kakao, address) {
  const q = String(address || '').trim();
  if (!q) {
    return Promise.resolve(null);
  }
  return new Promise(resolve => {
    const geocoder = new kakao.maps.services.Geocoder();
    geocoder.addressSearch(q, (result, status) => {
      if (status === kakao.maps.services.Status.OK && result?.[0]) {
        resolve({
          lat: parseFloat(result[0].y),
          lng: parseFloat(result[0].x),
        });
      } else {
        resolve(null);
      }
    });
  });
}

const DAY_MARKER_COLORS = [
  '#4f6ef7',
  '#e05b6f',
  '#0d9488',
  '#d97706',
  '#7c3aed',
  '#0891b2',
];

function dayColor(day) {
  const d = Math.max(1, Number(day) || 1);
  return DAY_MARKER_COLORS[(d - 1) % DAY_MARKER_COLORS.length];
}

export default function MultiMarkerMap({
  locations = [],
  onMarkerSelect,
}) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const boundsRef = useRef(null);
  const [error, setError] = useState('');
  const [noCoordCount, setNoCoordCount] = useState(0);
  /** 좌표 보유 + 주소 지오코딩 성공분 */
  const [plotPoints, setPlotPoints] = useState([]);
  const [phase, setPhase] = useState('idle');

  const locationsKey = useMemo(
    () =>
      locations
        .map(
          l =>
            `${l.id ?? ''}\t${pickAddress(l)}\t${l.latitude ?? ''}\t${l.longitude ?? ''}`,
        )
        .join('\n'),
    [locations],
  );

  useEffect(() => {
    let cancelled = false;

    if (!locations.length) {
      setPlotPoints([]);
      setPhase('empty');
      setNoCoordCount(0);
      setError('');
      return () => {
        cancelled = true;
      };
    }

    setPhase('resolving');
    setError('');

    (async () => {
      const withCoord = locations
        .filter(hasCoord)
        .map(l => ({
          ...l,
          latitude: Number(l.latitude),
          longitude: Number(l.longitude),
        }));

      const needAddr = locations.filter(l => !hasCoord(l) && pickAddress(l));

      let points = [...withCoord];

      try {
        if (needAddr.length) {
          const kakao = await loadKakaoSdk();
          if (cancelled) return;
          for (const loc of needAddr) {
            const pos = await geocodeAddress(kakao, pickAddress(loc));
            if (cancelled) return;
            if (pos) {
              points.push({
                ...loc,
                latitude: pos.lat,
                longitude: pos.lng,
              });
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          setPlotPoints(withCoord);
          setPhase(withCoord.length ? 'resolved' : 'empty');
          setNoCoordCount(locations.length - withCoord.length);
          if (!withCoord.length) {
            const msg = String(err?.message || '');
            if (msg.includes('sdk_blocked')) {
              setError('카카오 SDK 로드가 차단되었습니다.');
            } else if (msg.includes('sdk_timeout')) {
              setError('카카오 SDK 로드 시간이 초과되었습니다.');
            } else {
              setError('지도를 준비하지 못했습니다.');
            }
          }
        }
        return;
      }

      if (cancelled) return;
      setNoCoordCount(locations.length - points.length);
      setPlotPoints(points);
      setPhase(points.length ? 'resolved' : 'empty');
    })();

    return () => {
      cancelled = true;
    };
  }, [locationsKey]);

  const mapMarkersKey = useMemo(
    () =>
      plotPoints.map(l => `${Number(l.id)}:${l.latitude}:${l.longitude}`).join('|'),
    [plotPoints],
  );

  useEffect(() => {
    if (phase !== 'resolved' || !plotPoints.length || error) {
      return;
    }

    let active = true;

    loadKakaoSdk()
      .then(kakao => {
        if (!active || !mapRef.current) return;

        mapRef.current.innerHTML = '';

        const map = new kakao.maps.Map(mapRef.current, {
          center: new kakao.maps.LatLng(36.5, 127.5),
          level: 10,
        });
        mapInstanceRef.current = map;

        const bounds = new kakao.maps.LatLngBounds();
        let openInfoWindow = null;

        const overlays = [];

        plotPoints.forEach(loc => {
          const position = new kakao.maps.LatLng(
            Number(loc.latitude),
            Number(loc.longitude),
          );
          bounds.extend(position);

          const order = loc.mapOrder != null ? String(loc.mapOrder) : '';
          const bg = dayColor(loc.tripDay);
          const el = document.createElement('div');
          el.className = 'trip-map-marker-pin';
          el.style.cssText = [
            'width:28px;height:28px;border-radius:50%',
            `background:${bg}`,
            'color:#fff;font-size:12px;font-weight:800',
            'display:flex;align-items:center;justify-content:center',
            'border:2px solid #fff',
            'box-shadow:0 2px 8px rgba(0,0,0,0.25)',
            'cursor:pointer',
            'font-family:inherit',
          ].join(';');
          el.textContent = order || '•';

          const overlay = new kakao.maps.CustomOverlay({
            position,
            content: el,
            yAnchor: 1.1,
            zIndex: Number(loc.mapOrder) || 1,
          });
          overlay.setMap(map);
          overlays.push(overlay);

          const rawName = String(loc.name || '장소');
          const name = rawName
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/"/g, '&quot;');
          const dayLabel =
            loc.tripDay != null ? `${loc.tripDay}일차` : '';
          const info = new kakao.maps.InfoWindow({
            content: `<div style="padding:6px 10px;font-size:13px;font-weight:600;white-space:nowrap">${order ? `${order}. ` : ''}${name}${dayLabel ? `<span style="font-weight:500;color:#666;margin-left:6px">${dayLabel}</span>` : ''}</div>`,
          });

          kakao.maps.event.addListener(el, 'click', () => {
            if (openInfoWindow) openInfoWindow.close();
            info.open(map, overlay);
            openInfoWindow = info;
            onMarkerSelect?.(loc.id);
          });
        });

        mapInstanceRef.current._tripOverlays = overlays;

        boundsRef.current = bounds;
        if (!bounds.isEmpty()) map.setBounds(bounds);

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

    return () => {
      active = false;
    };
  }, [mapMarkersKey, plotPoints, phase, error]);

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
  }, [mapMarkersKey]);

  if (!locations.length) {
    return <p className="ui-empty">표시할 장소가 없어요.</p>;
  }

  if (phase === 'idle' || phase === 'resolving') {
    return (
      <div className="multi-marker-map-wrap">
        <p className="multi-marker-map-title">📍 일정 지도</p>
        <p className="multi-marker-map-loading">
          주소에서 위치를 찾는 중입니다…
        </p>
        <div className="multi-marker-map-canvas multi-marker-map-canvas--placeholder" />
      </div>
    );
  }

  if (phase === 'empty' && !plotPoints.length) {
    return (
      <div className="multi-marker-map-wrap">
        <p className="multi-marker-map-title">📍 일정 지도</p>
        {error ? (
          <p className="multi-marker-map-error">{error}</p>
        ) : (
          <p className="ui-empty">
            지도에 표시할 좌표·주소 정보가 없어요. 장소 데이터에 주소가 있는지 확인해
            주세요.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="multi-marker-map-wrap">
      <p className="multi-marker-map-title">
        📍 현재 일정 {plotPoints.length}개 장소
      </p>
      {error ? (
        <p className="multi-marker-map-error">{error}</p>
      ) : (
        <div ref={mapRef} className="multi-marker-map-canvas" />
      )}
      {noCoordCount > 0 && (
        <p className="multi-marker-map-skipped">
          좌표·주소 검색으로 표시 못한 장소: {noCoordCount}개
        </p>
      )}
    </div>
  );
}
