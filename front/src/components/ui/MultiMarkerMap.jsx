import { useEffect, useMemo, useRef, useState } from 'react';
import { geocodeAddressesBatch } from '../../utils/geocodeApi';
import {
  buildKakaoMapCenterUrl,
  buildKakaoPlaceUrl,
  geocodeAddressWithKakao,
  loadKakaoSdk,
} from '../../utils/kakaoMapSdk';

function hasCoord(loc) {
  return (
    loc.latitude != null &&
    loc.longitude != null &&
    Number.isFinite(Number(loc.latitude)) &&
    Number.isFinite(Number(loc.longitude))
  );
}

function pickAddress(loc) {
  const a = String(loc.address || '').trim();
  if (a) return a;
  const blob = [loc.summary, loc.description].map(x => String(x || '')).join(' ');
  const m = blob.match(/주소[:\s]*([^\n]+?)(?:\n|$)/);
  return m ? m[1].trim() : '';
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

function paintMap(kakao, mapEl, plotPoints, onMarkerSelect) {
  mapEl.innerHTML = '';

  const map = new kakao.maps.Map(mapEl, {
    center: new kakao.maps.LatLng(36.5, 127.5),
    level: 10,
  });

  const bounds = new kakao.maps.LatLngBounds();
  let openInfoWindow = null;

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

    const rawName = String(loc.name || '장소');
    const name = rawName
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
    const dayLabel = loc.tripDay != null ? `${loc.tripDay}일차` : '';
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

  if (!bounds.isEmpty()) {
    map.setBounds(bounds);
  }

  return { map, bounds };
}

async function resolvePlotPoints(locations) {
  const withCoord = locations
    .filter(hasCoord)
    .map(l => ({
      ...l,
      latitude: Number(l.latitude),
      longitude: Number(l.longitude),
    }));

  const needAddr = locations.filter(l => !hasCoord(l) && pickAddress(l));
  if (!needAddr.length) {
    return { points: withCoord, skipped: 0 };
  }

  const byId = new Map(needAddr.map(l => [String(l.id), l]));
  let resolved = [];

  try {
    const batch = await geocodeAddressesBatch(
      needAddr.map(l => ({ id: l.id, address: pickAddress(l) })),
    );
    for (const row of batch) {
      if (row.ok && row.latitude != null && row.longitude != null) {
        const loc = byId.get(String(row.id));
        if (loc) {
          resolved.push({
            ...loc,
            latitude: row.latitude,
            longitude: row.longitude,
          });
          byId.delete(String(row.id));
        }
      }
    }
  } catch {
    /* REST 실패 시 클라이언트 지오코더로 폴백 */
  }

  if (byId.size > 0) {
    try {
      const kakao = await loadKakaoSdk();
      for (const loc of byId.values()) {
        const pos = await geocodeAddressWithKakao(kakao, pickAddress(loc));
        if (pos) {
          resolved.push({
            ...loc,
            latitude: pos.lat,
            longitude: pos.lng,
          });
        }
      }
    } catch {
      /* SDK도 실패하면 좌표 있는 것만 표시 */
    }
  }

  const points = [...withCoord, ...resolved];
  return {
    points,
    skipped: locations.length - points.length,
  };
}

export default function MultiMarkerMap({
  locations = [],
  onMarkerSelect,
}) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const boundsRef = useRef(null);
  const onMarkerSelectRef = useRef(onMarkerSelect);
  const [error, setError] = useState('');
  const [noCoordCount, setNoCoordCount] = useState(0);
  const [plotPoints, setPlotPoints] = useState([]);
  const [phase, setPhase] = useState('idle');
  const [useFallbackMap, setUseFallbackMap] = useState(false);

  onMarkerSelectRef.current = onMarkerSelect;

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
    setPlotPoints([]);
    setUseFallbackMap(false);

    (async () => {
      const { points, skipped } = await resolvePlotPoints(locations);
      if (cancelled) return;

      setNoCoordCount(skipped);
      setPlotPoints(points);

      if (!points.length) {
        setError('주소를 지도 위치로 찾지 못했습니다.');
        setPhase('empty');
        return;
      }

      setPhase('resolved');
    })();

    return () => {
      cancelled = true;
    };
  }, [locationsKey, locations]);

  const mapMarkersKey = useMemo(
    () =>
      plotPoints.map(l => `${Number(l.id)}:${l.latitude}:${l.longitude}`).join('|'),
    [plotPoints],
  );

  useEffect(() => {
    if (phase !== 'resolved' || !plotPoints.length) {
      return undefined;
    }

    let active = true;
    let relayoutTimer = null;

    const tryPaint = attempt => {
      if (!active) return;
      const el = mapRef.current;
      if (!el) {
        if (attempt < 20) {
          relayoutTimer = window.setTimeout(() => tryPaint(attempt + 1), 50);
        }
        return;
      }

      loadKakaoSdk()
        .then(kakao => {
          if (!active || !mapRef.current) return;
          setUseFallbackMap(false);
          const painted = paintMap(
            kakao,
            mapRef.current,
            plotPoints,
            id => onMarkerSelectRef.current?.(id),
          );
          mapInstanceRef.current = painted.map;
          boundsRef.current = painted.bounds;

          [0, 180, 420, 800].forEach(delay => {
            window.setTimeout(() => {
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
          if (plotPoints.length > 0 && buildKakaoMapCenterUrl(plotPoints)) {
            setUseFallbackMap(true);
            setError('');
            return;
          }
          const msg = String(err?.message || '');
          if (msg.includes('sdk_blocked')) {
            setError('카카오 SDK 로드가 차단되었습니다.');
          } else if (msg.includes('sdk_timeout')) {
            setError('카카오 SDK 로드 시간이 초과되었습니다.');
          } else {
            setError('지도를 불러오지 못했습니다.');
          }
        });
    };

    tryPaint(0);

    return () => {
      active = false;
      if (relayoutTimer) window.clearTimeout(relayoutTimer);
    };
  }, [mapMarkersKey, phase, plotPoints]);

  useEffect(() => {
    if (!mapRef.current || phase !== 'resolved') return undefined;

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
  }, [mapMarkersKey, phase]);

  const fallbackMapUrl = useMemo(
    () => buildKakaoMapCenterUrl(plotPoints),
    [plotPoints],
  );

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
          <p className="ui-empty">지도에 표시할 주소 정보가 없어요.</p>
        )}
      </div>
    );
  }

  return (
    <div className="multi-marker-map-wrap">
      <p className="multi-marker-map-title">
        📍 현재 일정 {plotPoints.length}개 장소
      </p>
      {useFallbackMap && fallbackMapUrl ? (
        <>
          <p className="multi-marker-map-skipped" style={{ marginBottom: 8 }}>
            앱 내 지도 대신 카카오맵 미리보기를 표시합니다. 장소별로 열려면 아래 링크를 눌러 주세요.
          </p>
          <div className="kakao-map-canvas kakao-map-fallback-viewport">
            <iframe
              src={fallbackMapUrl}
              title="일정 지도 미리보기"
              className="kakao-map-iframe"
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
          <ul className="multi-marker-map-fallback-list">
            {plotPoints.map(p => {
              const href = buildKakaoPlaceUrl(p);
              if (!href) return null;
              return (
                <li key={p.id ?? p.name}>
                  <a href={href} target="_blank" rel="noreferrer">
                    {p.name || '장소'}
                  </a>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <>
          {error ? (
            <p className="multi-marker-map-error">{error}</p>
          ) : null}
          <div ref={mapRef} className="multi-marker-map-canvas" />
        </>
      )}
      {noCoordCount > 0 ? (
        <p className="multi-marker-map-skipped">
          주소 검색으로 표시 못한 장소: {noCoordCount}개
        </p>
      ) : null}
    </div>
  );
}
