import { apiFetch, optionalAuthFetch } from '../../shared/api/client';
import { getViewerKey } from '../../shared/viewerKey';

/**
 * 커뮤니티 API.
 * 목록·상세·댓글은 비로그인도 볼 수 있어야 하지만, 로그인했다면 saved/myVote/liked
 * 같은 사용자별 상태도 함께 받아야 하므로 optionalAuthFetch를 씁니다.
 * (publicFetch로 부르면 서버가 요청자를 몰라 이 값들이 항상 기본값으로 옵니다.)
 * 쓰기 동작은 apiFetch — 토큰이 없으면 'not_logged_in'을 던집니다.
 */

/** 서버 응답 → 화면이 쓰는 형태. author 객체를 평평하게 편다. */
export function normalizePost(raw) {
  if (!raw) return null;
  const author = raw.author || {};
  return {
    id: raw.id,
    boardId: raw.boardId,
    title: raw.title || '',
    body: raw.body || '',
    place: raw.place || '',
    placeId: raw.placeId ?? null,
    author: author.name || '',
    authorPicture: author.picture || '',
    anonymous: Boolean(author.anonymous),
    isMine: Boolean(author.isMine),
    createdAt: raw.createdAt || null,
    votes: Number(raw.votes || 0),
    comments: Number(raw.comments || 0),
    views: Number(raw.views || 0),
    myVote: Number(raw.myVote || 0),
    saved: Boolean(raw.saved),
    savedAt: raw.savedAt || null,
    images: (raw.images || []).map(img => ({
      url: img.url,
      thumbUrl: img.thumbUrl || img.url,
    })),
  };
}

export function normalizeComment(raw) {
  if (!raw) return null;
  const author = raw.author || {};
  return {
    id: raw.id,
    body: raw.body || '',
    author: author.name || '',
    authorPicture: author.picture || '',
    anonymous: Boolean(author.anonymous),
    isMine: Boolean(author.isMine),
    createdAt: raw.createdAt || null,
    likes: Number(raw.likes || 0),
    liked: Boolean(raw.liked),
    replies: (raw.replies || []).map(normalizeComment).filter(Boolean),
  };
}

function buildQuery(params) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  });
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export async function fetchPosts({
  board,
  placeId,
  sort,
  q,
  cursor,
  limit = 20,
} = {}) {
  const data = await optionalAuthFetch(
    `/api/community/posts${buildQuery({ board, placeId, sort, q, cursor, limit })}`,
  );
  return {
    posts: (data?.posts || []).map(normalizePost).filter(Boolean),
    nextCursor: data?.nextCursor || null,
  };
}

export async function fetchPost(postId) {
  const data = await optionalAuthFetch(
    `/api/community/posts/${postId}${buildQuery({ viewerKey: getViewerKey() })}`,
  );
  return normalizePost(data);
}

/** 이미지 한 장 업로드 → 저장된 URL. FormData라 Content-Type을 직접 정하지 않습니다. */
export async function uploadCommunityImage(file) {
  const form = new FormData();
  form.append('file', file);
  return apiFetch('/api/community/images', { method: 'POST', body: form });
}

export async function createPost({
  boardId,
  title,
  body,
  place,
  placeId,
  anonymous,
  images = [],
}) {
  const data = await apiFetch('/api/community/posts', {
    method: 'POST',
    body: JSON.stringify({
      boardId,
      title,
      body,
      place: place || null,
      placeId: placeId ?? null,
      anonymous: Boolean(anonymous),
      images,
    }),
  });
  return normalizePost(data);
}

export async function updatePost(
  postId,
  { boardId, title, body, place, placeId, anonymous, images },
) {
  const data = await apiFetch(`/api/community/posts/${postId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      boardId,
      title,
      body,
      place: place || null,
      placeId: placeId ?? null,
      anonymous: Boolean(anonymous),
      // undefined면 사진을 건드리지 않고, 배열이면 그 목록으로 교체된다.
      images: images ?? null,
    }),
  });
  return normalizePost(data);
}

export async function deletePost(postId) {
  await apiFetch(`/api/community/posts/${postId}`, { method: 'DELETE' });
}

export async function fetchComments(postId, { cursor, limit = 20 } = {}) {
  const data = await optionalAuthFetch(
    `/api/community/posts/${postId}/comments${buildQuery({ cursor, limit })}`,
  );
  return {
    comments: (data?.comments || []).map(normalizeComment).filter(Boolean),
    nextCursor: data?.nextCursor || null,
  };
}

export async function createComment(postId, { body, parentId, anonymous }) {
  const data = await apiFetch(`/api/community/posts/${postId}/comments`, {
    method: 'POST',
    body: JSON.stringify({
      body,
      parentId: parentId ?? null,
      anonymous: Boolean(anonymous),
    }),
  });
  return normalizeComment(data);
}

export async function updateComment(commentId, { body, anonymous }) {
  const data = await apiFetch(`/api/community/comments/${commentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ body, anonymous: anonymous ?? null }),
  });
  return normalizeComment(data);
}

export async function likeComment(commentId) {
  return apiFetch(`/api/community/comments/${commentId}/like`, { method: 'PUT' });
}

export async function deleteComment(commentId) {
  await apiFetch(`/api/community/comments/${commentId}`, { method: 'DELETE' });
}

export async function votePost(postId, value) {
  return apiFetch(`/api/community/posts/${postId}/vote`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  });
}

export async function toggleSavePost(postId) {
  return apiFetch(`/api/community/posts/${postId}/save`, { method: 'PUT' });
}

/** 글쓰기 장소 입력 자동완성. */
export async function fetchPlaceSuggestions(q, { limit = 8 } = {}) {
  if (!q || !q.trim()) return [];
  const data = await optionalAuthFetch(
    `/api/community/place-suggestions${buildQuery({ q: q.trim(), limit })}`,
  );
  return (data?.places || []).map(p => ({
    id: p.id,
    name: p.name || '',
    region: p.region || '',
    address: p.address || '',
  }));
}

/** 최근 글에 많이 등장한 장소. */
export async function fetchTrendingPlaces({ days = 30, limit = 5 } = {}) {
  const data = await optionalAuthFetch(
    `/api/community/trending${buildQuery({ days, limit })}`,
  );
  return (data?.places || []).map(p => ({
    label: p.label,
    count: Number(p.count || 0),
  }));
}

// ── 마이페이지 ────────────────────────────────────────────────────────────────

export async function fetchMyPosts() {
  const data = await apiFetch('/api/me/community/posts');
  return (data?.posts || []).map(normalizePost).filter(Boolean);
}

export async function fetchMyComments() {
  const data = await apiFetch('/api/me/community/comments');
  return (data?.comments || []).map(c => ({
    id: c.id,
    postId: c.postId,
    postTitle: c.postTitle || '',
    body: c.body || '',
    createdAt: c.createdAt || null,
    anonymous: Boolean(c.anonymous),
    likes: Number(c.likes || 0),
  }));
}

export async function fetchMySavedPosts() {
  const data = await apiFetch('/api/me/community/saves');
  return (data?.posts || []).map(normalizePost).filter(Boolean);
}
