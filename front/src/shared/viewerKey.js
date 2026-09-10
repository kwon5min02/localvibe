/**
 * 조회 중복 제거용 브라우저 키.
 * 로그인하지 않은 사람도 구분해야 해서 브라우저마다 하나 만들어 보관합니다.
 * 커뮤니티 글 조회수와 장소 열람 집계가 같은 키를 씁니다.
 */
export function getViewerKey() {
  try {
    let key = localStorage.getItem('lv_viewer_key');
    if (!key) {
      key = `g${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      localStorage.setItem('lv_viewer_key', key);
    }
    return key;
  } catch {
    // 사생활 보호 모드 등으로 저장소를 못 쓰면 집계를 포기합니다.
    return '';
  }
}
