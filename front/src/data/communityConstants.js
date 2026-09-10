/**
 * 커뮤니티 화면 상수.
 *
 * 글·댓글·투표·저장은 /api/community/* 에서 가져오므로 여기에는 목업이 없습니다.
 * 게시판 목록은 백엔드 app/modules/community/boards.py 의 BOARDS 와 id가 같아야 합니다.
 */

export const COMMUNITY_BOARDS = [
  { id: 'all', name: '전체', desc: '광주·전남 모든 글' },
  { id: 'gwangju-dong', name: '광주 동구', desc: '충장로·양림동·국립아시아문화전당' },
  { id: 'gwangju-seo', name: '광주 서구', desc: '상무지구·풍암' },
  { id: 'gwangju-nam', name: '광주 남구', desc: '양림역사문화마을·백운동' },
  { id: 'gwangju-buk', name: '광주 북구', desc: '전남대·용봉동·무등산' },
  { id: 'gwangju-gwangsan', name: '광주 광산구', desc: '수완지구·첨단·송정' },
  { id: 'yeosu', name: '여수', desc: '돌산·오동도·낭만포차' },
  { id: 'suncheon', name: '순천', desc: '순천만·드라마촬영장' },
  { id: 'mokpo', name: '목포', desc: '근대역사거리·유달산' },
  { id: 'damyang', name: '담양', desc: '죽녹원·메타세쿼이아길' },
  { id: 'boseong', name: '보성', desc: '녹차밭·율포해수욕장' },
  { id: 'wando', name: '완도', desc: '청산도·신지명사십리' },
];

export const COMMUNITY_SORTS = [
  { id: 'new', label: '최신', icon: '✦' },
  { id: 'hot', label: '인기', icon: '△' },
  { id: 'top', label: '베스트', icon: '↑' },
  { id: 'comments', label: '댓글순', icon: '○' },
];

export const COMMUNITY_RULES = [
  '광주·전남 지역의 장소에 대한 글만 올려주세요.',
  '방문한 날짜와 장소 이름을 함께 적으면 도움이 됩니다.',
  '광고·홍보성 글과 반복 게시는 삭제됩니다.',
  '사진 속 타인의 얼굴은 가려주세요.',
  '서로의 취향을 존중하는 댓글을 부탁드립니다.',
];
