/**
 * localStorage의 로그인 사용자 읽기 (단일 소스).
 *
 * `lv_user`에 picture가 비어 있는 경우가 있어(백엔드 응답의 필드명 차이, 예전 세션 등)
 * access token의 claims에서 꺼내 보완합니다. AuthContext와 헤더가 같은 값을 보도록
 * 이 함수만 사용합니다.
 */

export function readPictureFromToken(token) {
  try {
    const encoded = String(token || '').split('.')[1];
    if (!encoded) return '';
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(
      atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')),
    );
    return String(claims?.picture || '');
  } catch {
    return '';
  }
}

export function readStoredUser() {
  try {
    const raw = localStorage.getItem('lv_user');
    const user = raw ? JSON.parse(raw) : null;
    if (!user) return null;
    const picture =
      user.picture ||
      user.profile_image ||
      user.profileImage ||
      readPictureFromToken(localStorage.getItem('lv_access_token'));
    return picture && !user.picture ? { ...user, picture } : user;
  } catch {
    return null;
  }
}
