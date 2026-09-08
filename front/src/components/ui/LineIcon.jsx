/**
 * 선(stroke)만 쓰는 24px 그리드 아이콘.
 * 커뮤니티 액션 줄과 마이페이지 탭이 같은 모양을 공유합니다.
 */

const PATHS = {
  comment:
    'M21 11.5a8.4 8.4 0 0 1-9 8.4 9.6 9.6 0 0 1-2.6-.4L3 21l1.6-4.7A8.2 8.2 0 0 1 3.6 11.5a8.4 8.4 0 0 1 9-8.4 8.4 8.4 0 0 1 8.4 8.4z',
  share: 'M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 15V3m0 0L8 7m4-4 4 4',
  save: 'M6 4.5h12a1 1 0 0 1 1 1V20l-7-4-7 4V5.5a1 1 0 0 1 1-1z',
  report: 'M5 21V4.5m0 0h11l-2 3.5 2 3.5H5',
  heart:
    'M12 20.3s-7.5-4.6-7.5-9.6a4.3 4.3 0 0 1 7.5-2.9 4.3 4.3 0 0 1 7.5 2.9c0 5-7.5 9.6-7.5 9.6z',
  plane: 'M2.5 13.2 21 4.5l-8.7 18.5-2.4-7.4-7.4-2.4z',
  pencil:
    'M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3zM14.5 6.5l3 3',
  user: 'M12 12.2a4.1 4.1 0 1 0 0-8.2 4.1 4.1 0 0 0 0 8.2zM4.5 20.5a7.5 7.5 0 0 1 15 0',
  logout: 'M15 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2M10 12h10m0 0-3.2-3.2M20 12l-3.2 3.2',
  // 두 개의 화살표가 도는 새로고침 (Feather refresh-cw)
  refresh:
    'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
  close: 'M6 6l12 12M18 6L6 18',
  image:
    'M4 5.5h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1zM3 16l4.5-4.5a1.5 1.5 0 0 1 2.1 0L14 16m-2-2 2.2-2.2a1.5 1.5 0 0 1 2.1 0L21 15m-5.5-6.5h.01',
};

export default function LineIcon({ name, className = 'cm-icon' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
