import { useEffect, useRef, useState } from "react";
import { geocodeAddressWithKakao, KAKAO_JS_KEY, loadKakaoSdk } from "../utils/kakaoMapSdk";

const MARKER_IMAGE_URL = "https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/marker_red.png";

function hasValidCoord(latitude, longitude) {
  return Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude));
}

function buildKakaoMapUrl(address, latitude, longitude) {
  if (hasValidCoord(latitude, longitude)) {
    return `https://map.kakao.com/link/map/${Number(latitude)},${Number(longitude)}`;
  }
  if (!address) {
    return "";
  }
  return `https://map.kakao.com/link/search/${encodeURIComponent(address)}`;
}

export default function KakaoMap({ address, latitude, longitude }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const mapCenterRef = useRef(null);
  const [error, setError] = useState("");
  const mapUrl = buildKakaoMapUrl(address, latitude, longitude);
  const addr = String(address || "").trim();

  useEffect(() => {
    let active = true;

    if (!KAKAO_JS_KEY) {
      setError("카카오 JavaScript 키가 설정되지 않았습니다.");
      return () => {
        active = false;
      };
    }

    if (!hasValidCoord(latitude, longitude) && !addr) {
      setError("좌표나 주소가 없어 지도를 표시할 수 없습니다.");
      return () => {
        active = false;
      };
    }

    setError("");

    loadKakaoSdk()
      .then((kakao) => {
        if (!active || !mapRef.current) {
          return;
        }

        const paint = (lat, lng) => {
          if (!active || !mapRef.current) {
            return;
          }
          const coords = new kakao.maps.LatLng(lat, lng);
          mapRef.current.innerHTML = "";
          const map = new kakao.maps.Map(mapRef.current, { center: coords, level: 4 });
          const markerImage = new kakao.maps.MarkerImage(
            MARKER_IMAGE_URL,
            new kakao.maps.Size(40, 42),
          );
          new kakao.maps.Marker({ map, position: coords, image: markerImage });
          mapInstanceRef.current = map;
          mapCenterRef.current = coords;

          [0, 180, 420, 800].forEach((delay) => {
            setTimeout(() => {
              if (!active || !mapInstanceRef.current || !mapCenterRef.current) {
                return;
              }
              mapInstanceRef.current.relayout();
              mapInstanceRef.current.setCenter(mapCenterRef.current);
            }, delay);
          });
        };

        if (hasValidCoord(latitude, longitude)) {
          paint(Number(latitude), Number(longitude));
          return;
        }

        geocodeAddressWithKakao(kakao, addr).then(pos => {
          if (!active) return;
          if (pos) {
            paint(pos.lat, pos.lng);
          } else {
            setError("주소를 지도 위치로 찾지 못했습니다.");
          }
        });
      })
      .catch((err) => {
        if (!active) {
          return;
        }
        const message = String(err?.message || "");
        if (message.includes("sdk_blocked")) {
          setError("카카오 SDK 로드가 차단되었습니다. 브라우저 확장/보안 설정을 확인해주세요.");
          return;
        }
        if (message.includes("sdk_timeout")) {
          setError("카카오 SDK 로드 시간이 초과되었습니다. 새로고침 후 다시 시도해주세요.");
          return;
        }
        setError("카카오 지도를 불러오지 못했습니다.");
      });

    return () => {
      active = false;
    };
  }, [latitude, longitude, addr]);

  useEffect(() => {
    if (!mapRef.current) {
      return undefined;
    }

    const relayoutNow = () => {
      if (!mapInstanceRef.current || !mapCenterRef.current) {
        return;
      }
      mapInstanceRef.current.relayout();
      mapInstanceRef.current.setCenter(mapCenterRef.current);
    };

    const observer = new ResizeObserver(() => relayoutNow());
    observer.observe(mapRef.current);
    window.addEventListener("resize", relayoutNow);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", relayoutNow);
    };
  }, []);

  return (
    <section className="kakao-map-wrapper">
      <h3>위치 지도</h3>
      {addr ? <p className="kakao-map-address">{addr}</p> : null}
      {error ? (
        <>
          {mapUrl ? (
            <div className="kakao-map-canvas kakao-map-fallback-viewport">
              <iframe
                src={mapUrl}
                title="카카오 지도 폴백"
                className="kakao-map-iframe"
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
          ) : (
            <p className="kakao-map-error">{error}</p>
          )}
          {mapUrl ? <p className="kakao-map-error kakao-map-error-secondary">{error}</p> : null}
        </>
      ) : (
        <div ref={mapRef} className="kakao-map-canvas" />
      )}
      {mapUrl ? (
        <a className="kakao-map-link" href={mapUrl} target="_blank" rel="noreferrer">
          카카오맵에서 위치 열기
        </a>
      ) : null}
    </section>
  );
}
