const KAKAO_JS_KEY =
  import.meta.env.VITE_KAKAO_JS_KEY || '0da5b46d0248e671b357568d3720d935';
const KAKAO_SCRIPT_ID = 'kakao-map-sdk-script';

let sdkPromise = null;

function createSdkUrl() {
  return `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_JS_KEY}&autoload=false&libraries=services`;
}

function whenMapsReady(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();

    const tick = () => {
      if (window.kakao?.maps?.load) {
        window.kakao.maps.load(() => resolve(window.kakao));
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        reject(new Error('sdk_timeout'));
        return;
      }
      window.setTimeout(tick, 50);
    };

    tick();
  });
}

/** script 제거/재주입 없이 대기 — 갤러리 KakaoMap과 동일 흐름 */
export function loadKakaoSdk() {
  if (window.kakao?.maps?.load) {
    return whenMapsReady();
  }

  if (sdkPromise) {
    return sdkPromise;
  }

  sdkPromise = new Promise((resolve, reject) => {
    if (!KAKAO_JS_KEY) {
      reject(new Error('missing_key'));
      return;
    }

    const existing = document.getElementById(KAKAO_SCRIPT_ID);
    if (existing) {
      whenMapsReady()
        .then(resolve)
        .catch(reject);
      return;
    }

    const script = document.createElement('script');
    script.id = KAKAO_SCRIPT_ID;
    script.async = true;
    script.src = `${createSdkUrl()}&_ts=${Date.now()}`;
    script.onload = () => {
      whenMapsReady().then(resolve).catch(reject);
    };
    script.onerror = () => reject(new Error('sdk_blocked'));
    document.head.appendChild(script);
  }).finally(() => {
    sdkPromise = null;
  });

  return sdkPromise;
}

export function geocodeAddressWithKakao(kakao, address, timeoutMs = 6000) {
  const q = String(address || '').trim();
  if (!q) {
    return Promise.resolve(null);
  }
  return new Promise(resolve => {
    const timer = window.setTimeout(() => resolve(null), timeoutMs);
    try {
      const geocoder = new kakao.maps.services.Geocoder();
      geocoder.addressSearch(q, (result, status) => {
        window.clearTimeout(timer);
        if (status === kakao.maps.services.Status.OK && result?.[0]) {
          resolve({
            lat: parseFloat(result[0].y),
            lng: parseFloat(result[0].x),
          });
        } else {
          resolve(null);
        }
      });
    } catch (_) {
      window.clearTimeout(timer);
      resolve(null);
    }
  });
}

export function buildKakaoMapCenterUrl(points) {
  const list = (points || []).filter(
    p =>
      Number.isFinite(Number(p.latitude)) &&
      Number.isFinite(Number(p.longitude)),
  );
  if (!list.length) return '';
  const lat =
    list.reduce((sum, p) => sum + Number(p.latitude), 0) / list.length;
  const lng =
    list.reduce((sum, p) => sum + Number(p.longitude), 0) / list.length;
  return `https://map.kakao.com/link/map/${lat},${lng}`;
}

export function buildKakaoPlaceUrl(point) {
  if (
    Number.isFinite(Number(point?.latitude)) &&
    Number.isFinite(Number(point?.longitude))
  ) {
    return `https://map.kakao.com/link/map/${Number(point.latitude)},${Number(point.longitude)}`;
  }
  const addr = String(point?.address || '').trim();
  if (addr) {
    return `https://map.kakao.com/link/search/${encodeURIComponent(addr)}`;
  }
  return '';
}

export { KAKAO_JS_KEY };
