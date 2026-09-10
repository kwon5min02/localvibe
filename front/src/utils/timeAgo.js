/**
 * 서버가 주는 ISO 시각을 '3시간 전' 형태로 바꿉니다.
 * 백엔드는 UTC 기준 naive datetime(isoformat)을 보내므로 Z가 없으면 붙여 해석합니다.
 */
export function timeAgo(iso) {
  if (!iso) return '';
  const then = new Date(
    /[Z+]|-\d{2}:\d{2}$/.test(iso) ? iso : `${iso}Z`,
  ).getTime();
  if (Number.isNaN(then)) return '';

  const diff = Math.max(0, Date.now() - then);
  const minute = 60000;
  if (diff < minute) return '방금 전';
  if (diff < 60 * minute) return `${Math.floor(diff / minute)}분 전`;
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))}시간 전`;

  const days = Math.floor(diff / (24 * 60 * minute));
  if (days < 7) return `${days}일 전`;
  if (days < 30) return `${Math.floor(days / 7)}주 전`;
  return new Date(then).toLocaleDateString('ko-KR');
}
