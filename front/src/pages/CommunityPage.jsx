import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  COMMUNITY_BOARDS,
  COMMUNITY_RULES,
  COMMUNITY_SORTS,
} from '../data/communityConstants';
import Avatar from '../components/ui/Avatar';
import LineIcon from '../components/ui/LineIcon';
import { timeAgo } from '../utils/timeAgo';
import { resolveBackendMediaUrl } from '../utils/apiMediaUrl';
import {
  createComment,
  createPost,
  deletePost,
  fetchComments,
  fetchPlaceSuggestions,
  fetchPost,
  fetchPosts,
  fetchTrendingPlaces,
  deleteComment,
  likeComment,
  updateComment,
  updatePost,
  uploadCommunityImage,
  toggleSavePost,
  votePost,
} from '../features/community/communityApi';

/**
 * 커뮤니티 — 광주·전남 장소 이야기를 쓰는 공간.
 * 글·댓글·투표·저장은 /api/community/* 로 서버에 저장됩니다.
 * (사진 첨부는 UI만 있고 아직 업로드하지 않습니다.)
 */

/** 댓글 입력 글자 수 상한. */
const COMMENT_MAX = 500;

/** 글 하나에 첨부할 수 있는 사진 수. */
const PHOTO_MAX = 5;

/** 무한 스크롤에서 한 번에 더 불러오는 글 수. */
const PAGE_SIZE = 20;

/** 로딩 표시를 최소 이만큼은 띄운다. 응답이 빠를 때 깜빡이는 것을 막는 용도. */
const LOADER_MIN_MS = 300;

/** 인기 장소 집계 설명 — 백엔드 list_trending_places와 내용이 어긋나지 않게 함께 고칠 것. */
const TRENDING_HELP_TEXT = `최근 30일 동안의 관심을 점수로 매겨 보여줘요.

• 장소 상세를 연 횟수 1점
• 그 장소로 쓴 글 1개 10점

같은 사람이 같은 날 여러 번 열어도 한 번만 세요. 글쓰기에서 자동완성으로 고른 장소만 집계돼요.`;

/** 내용 입력 안내 — 커뮤니티 규칙을 그대로 옮겨 적습니다. */
const BODY_PLACEHOLDER = [
  '방문 시기, 가는 방법, 좋았던 점을 적어주세요.',
  '',
  ...COMMUNITY_RULES.map(rule => `· ${rule}`),
].join('\n');

const boardName = id =>
  COMMUNITY_BOARDS.find(b => b.id === id)?.name || '전체';

/** 작성 중인 글 임시 저장 — 실수로 나가도 돌아오면 이어서 쓸 수 있게. */
const draftKey = id => `lv_write_draft_${id}`;

function readDraft(id) {
  try {
    const raw = sessionStorage.getItem(draftKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveDraft(id, draft) {
  try {
    sessionStorage.setItem(draftKey(id), JSON.stringify(draft));
  } catch {
    /* 저장 공간이 없으면 그냥 넘어간다 */
  }
}

function clearDraft(id) {
  try {
    sessionStorage.removeItem(draftKey(id));
  } catch {
    /* noop */
  }
}

/** 글 주소 — 받은 사람이 그 글로 바로 들어옵니다. */
function postShareUrl(postId) {
  const { origin } = window.location;
  return `${origin}/main?tab=community&post=${postId}`;
}

/**
 * 공유 — 지원하면 네이티브 공유 시트, 아니면 링크 복사.
 * 성공 시 안내 문구를 돌려줍니다(취소는 빈 문자열).
 */
async function sharePost(post) {
  const url = postShareUrl(post.id);
  if (navigator.share) {
    try {
      await navigator.share({ title: post.title, url });
      return '';
    } catch (err) {
      // 사용자가 취소하면 조용히 넘어가고, 그 외에는 복사로 넘어간다.
      if (err?.name === 'AbortError') return '';
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return '링크를 복사했어요.';
  } catch {
    return '링크 복사에 실패했습니다.';
  }
}

/** 익명 글은 이름 대신 '익명'으로 표시합니다. */
const authorLabel = post => (post.anonymous ? '익명' : post.author || '사용자');

/** 하단 액션 줄에 들어가는 알약형 투표 버튼. */
function VotePill({ votes, myVote, onVote }) {
  // 서버가 주는 votes에는 내 표가 이미 반영돼 있으므로 그대로 보여준다.
  return (
    <div className="cm-vote">
      <button
        type="button"
        className={`cm-vote-btn is-up${myVote === 1 ? ' up' : ''}`}
        onClick={e => {
          e.stopPropagation();
          onVote(myVote === 1 ? 0 : 1);
        }}
        aria-label="추천"
      >
        <LineIcon name="thumbUp" />
      </button>
      <span className={`cm-vote-score${myVote === 1 ? ' up' : ''}${myVote === -1 ? ' down' : ''}`}>
        {votes}
      </span>
      <button
        type="button"
        className={`cm-vote-btn is-down${myVote === -1 ? ' down' : ''}`}
        onClick={e => {
          e.stopPropagation();
          onVote(myVote === -1 ? 0 : -1);
        }}
        aria-label="비추천"
      >
        <LineIcon name="thumbDown" />
      </button>
    </div>
  );
}

/**
 * 목록에서 하나를 고르는 드롭다운 — 바깥 클릭 시 닫힙니다.
 * options: [{ id, label }]
 */
function Dropdown({ value, options, onChange, className = '', ariaLabel }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handler = e => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = options.find(o => o.id === value);

  return (
    <div className={`cm-dropdown ${className}`.trim()} ref={ref}>
      <button
        type="button"
        className={`cm-dropdown-trigger${open ? ' open' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-label={ariaLabel}
      >
        {current?.label}
        <span className="cm-caret" aria-hidden="true">
          ⌄
        </span>
      </button>
      {open && (
        <ul className="cm-dropdown-menu">
          {options.map(o => (
            <li key={o.id}>
              <button
                type="button"
                className={`cm-dropdown-item${value === o.id ? ' active' : ''}`}
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                }}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 글쓰기의 '아직 고르지 않음' 상태. */
const BOARD_UNSET = '';

/** 게시판 선택용 옵션 (전체 제외) — 맨 앞에 미선택 항목을 둔다. */
const BOARD_OPTIONS = [
  { id: BOARD_UNSET, label: '선택 안 함' },
  ...COMMUNITY_BOARDS.filter(b => b.id !== 'all').map(b => ({
    id: b.id,
    label: b.name,
  })),
];

/** 우측 상단 ⋯ 메뉴 — 내 글·댓글에만 붙는다. 바깥 클릭 시 닫힌다. */
function KebabMenu({ onEdit, onDelete, label = '메뉴' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handler = e => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="cm-kebab" ref={ref} onClick={e => e.stopPropagation()}>
      <button
        type="button"
        className="cm-kebab-btn"
        onClick={() => setOpen(o => !o)}
        aria-label={label}
      >
        ⋯
      </button>
      {open && (
        <div className="cm-kebab-menu">
          <button
            type="button"
            className="cm-kebab-item"
            onClick={() => {
              setOpen(false);
              onEdit?.();
            }}
          >
            수정하기
          </button>
          <button
            type="button"
            className="cm-kebab-item cm-kebab-item--danger"
            onClick={() => {
              setOpen(false);
              onDelete?.();
            }}
          >
            삭제하기
          </button>
        </div>
      )}
    </div>
  );
}

function PostCard({ post, onVote, onOpen, onSave, onShare, onEdit, onDelete }) {
  return (
    <article className="cm-post" onClick={() => onOpen(post)}>
      <div className="cm-post-body">
        {post.isMine && (
          <KebabMenu
            label="글 메뉴"
            onEdit={() => onEdit?.(post)}
            onDelete={() => onDelete?.(post.id)}
          />
        )}
        <div className="cm-post-meta">
          <span className="cm-board-chip">{boardName(post.boardId)}</span>
          <span className="cm-dot">·</span>
          <span className="cm-post-author">{authorLabel(post)}</span>
          <span className="cm-dot">·</span>
          <span>{timeAgo(post.createdAt)}</span>
          {post.place && (
            <>
              <span className="cm-bar">|</span>
              <span className="cm-meta-place">{post.place}</span>
            </>
          )}
          <span className="cm-dot">·</span>
          <span className="cm-meta-views">
            <LineIcon name="eye" className="cm-meta-icon" /> {post.views}
          </span>
        </div>
        <div className="cm-post-main">
          <div className="cm-post-text">
            <h3 className="cm-post-title">{post.title}</h3>
            <p className="cm-post-excerpt">{post.body}</p>
          </div>
          {post.images?.length > 0 && (
            <div className="cm-post-thumb">
              <img
                src={resolveBackendMediaUrl(
                  post.images[0].thumbUrl || post.images[0].url,
                )}
                alt=""
                loading="lazy"
              />
              {post.images.length > 1 && (
                <span className="cm-post-thumb-count">
                  +{post.images.length - 1}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="cm-post-actions">
          <VotePill
            votes={post.votes}
            myVote={post.myVote}
            onVote={v => onVote(post.id, v)}
          />
          <span className="cm-bar">|</span>
          <span className="cm-post-action">
            <LineIcon name="comment" /> 댓글 {post.comments}
          </span>

          <span className="cm-bar">|</span>
          <span
            className="cm-post-action"
            onClick={e => {
              e.stopPropagation();
              onShare?.(post);
            }}
          >
            <LineIcon name="share" /> 공유
          </span>
          <span className="cm-bar">|</span>
          <span
            className={`cm-post-action${post.saved ? ' active' : ''}`}
            onClick={e => {
              e.stopPropagation();
              onSave?.(post.id);
            }}
          >
            <LineIcon name="save" /> {post.saved ? '저장됨' : '저장'}
          </span>

        </div>
      </div>
    </article>
  );
}

function Comment({ comment, depth = 0, onReply, onLike, onEdit, onDelete }) {
  const replies = comment.replies || [];
  // 기본은 접힌 상태 — 목록이 길어지지 않게 한다.
  const [showReplies, setShowReplies] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyDraft, setReplyDraft] = useState('');
  const [replyAnonymous, setReplyAnonymous] = useState(false);
  const [sending, setSending] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editDraft, setEditDraft] = useState(comment.body);
  const [savingEdit, setSavingEdit] = useState(false);

  const submitEdit = async () => {
    const body = editDraft.trim();
    if (!body || savingEdit) return;
    setSavingEdit(true);
    const ok = await onEdit?.(comment.id, body);
    setSavingEdit(false);
    if (ok) setEditOpen(false);
  };

  const submitReply = async () => {
    const body = replyDraft.trim();
    if (!body || sending) return;
    setSending(true);
    const ok = await onReply?.(comment.id, {
      body,
      anonymous: replyAnonymous,
    });
    setSending(false);
    if (ok) {
      setReplyDraft('');
      setReplyOpen(false);
      setShowReplies(true);
    }
  };

  return (
    <li className="cm-comment" style={{ marginLeft: depth ? 24 : 0 }}>
      {comment.isMine && (
        <KebabMenu
          label="댓글 메뉴"
          onEdit={() => {
            setEditDraft(comment.body);
            setEditOpen(true);
          }}
          onDelete={() => onDelete?.(comment.id)}
        />
      )}
      <div className="cm-comment-head">
        {comment.anonymous ? (
          <span className="cm-comment-avatar" aria-hidden="true">
            ?
          </span>
        ) : (
          <Avatar
            src={comment.authorPicture}
            name={comment.author}
            className="cm-comment-avatar"
          />
        )}
        <span className="cm-post-author">{authorLabel(comment)}</span>
        <span className="cm-dot">·</span>
        <span>{timeAgo(comment.createdAt)}</span>
      </div>
      {editOpen ? (
        <div className="cm-reply-box">
          <div className="cm-comment-box">
            <textarea
              className="cm-comment-input"
              rows={2}
              maxLength={COMMENT_MAX}
              value={editDraft}
              onChange={e => setEditDraft(e.target.value)}
            />
            <div className="cm-comment-input-actions">
              <span className="cm-comment-count">
                {editDraft.length}/{COMMENT_MAX}
              </span>
              <button
                type="button"
                className="cm-post-action cm-post-action--btn"
                onClick={() => {
                  setEditDraft(comment.body);
                  setEditOpen(false);
                }}
              >
                취소
              </button>
              <button
                type="button"
                className="cm-send-btn"
                disabled={!editDraft.trim() || savingEdit}
                onClick={submitEdit}
                aria-label="수정 저장"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M3.6 4.3 20.5 11.5c.7.3.7 1.3 0 1.6L3.6 20.3c-.7.3-1.4-.4-1.1-1.1l2.3-6.1c.1-.2.3-.4.6-.4l7.3-.6c.4 0 .4-.6 0-.6l-7.3-.6c-.3 0-.5-.2-.6-.4L2.5 5.4c-.3-.7.4-1.4 1.1-1.1z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <p className="cm-comment-body">{comment.body}</p>
      )}
      <div className="cm-comment-actions">
        <button
          type="button"
          className={`cm-like-btn${comment.liked ? ' liked' : ''}`}
          onClick={() => onLike?.(comment.id)}
          aria-pressed={comment.liked}
          aria-label="좋아요"
        >
          <LineIcon name="thumbUp" className="cm-icon" />
          {comment.likes > 0 && <span>{comment.likes}</span>}
        </button>
        {/* 답글은 한 단계까지만. 답글에 또 답글을 달면 멘션 표시가 없어
            누구에게 한 말인지 알 수 없고, 서버도 원 댓글로 평탄화한다. */}
        {depth === 0 && (
          <>
            <span className="cm-bar">|</span>
            <button
              type="button"
              className="cm-post-action cm-post-action--btn"
              onClick={() => setReplyOpen(v => !v)}
            >
              답글
            </button>
          </>
        )}

      </div>

      {replyOpen && (
        <div className="cm-reply-box">
          <div className="cm-comment-box">
            <textarea
              className="cm-comment-input"
              placeholder={`${authorLabel(comment)}님에게 답글`}
              rows={2}
              maxLength={COMMENT_MAX}
              value={replyDraft}
              onChange={e => setReplyDraft(e.target.value)}
            />
            <div className="cm-comment-input-actions">
              <label className="cm-switch cm-switch--sm">
                <input
                  type="checkbox"
                  checked={replyAnonymous}
                  onChange={e => setReplyAnonymous(e.target.checked)}
                />
                <span className="cm-switch-track" aria-hidden="true">
                  <span className="cm-switch-thumb" />
                </span>
                <span className="cm-switch-label">익명</span>
              </label>
              <span className="cm-comment-count">
                {replyDraft.length}/{COMMENT_MAX}
              </span>
              <button
                type="button"
                className="cm-send-btn"
                disabled={!replyDraft.trim() || sending}
                onClick={submitReply}
                aria-label="답글 등록"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M3.6 4.3 20.5 11.5c.7.3.7 1.3 0 1.6L3.6 20.3c-.7.3-1.4-.4-1.1-1.1l2.3-6.1c.1-.2.3-.4.6-.4l7.3-.6c.4 0 .4-.6 0-.6l-7.3-.6c-.3 0-.5-.2-.6-.4L2.5 5.4c-.3-.7.4-1.4 1.1-1.1z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
      {replies.length > 0 && (
        <>
          {showReplies && (
            <ul className="cm-comment-list cm-comment-list--nested">
              {replies.map(reply => (
                <Comment
                  key={reply.id}
                  comment={reply}
                  depth={depth + 1}
                  onReply={onReply}
                  onLike={onLike}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              ))}
            </ul>
          )}
          <button
            type="button"
            className="cm-replies-toggle"
            onClick={() => setShowReplies(v => !v)}
          >
            {showReplies ? '답글 숨기기' : `답글 ${replies.length}개`}
            <span
              className={`cm-caret${showReplies ? ' up' : ''}`}
              aria-hidden="true"
            >
              ⌄
            </span>
          </button>
        </>
      )}
    </li>
  );
}

/** 글 상세의 사진 — 옆으로 넘겨 봅니다(스크롤 스냅 + 좌우 버튼). */
function PostImages({ images }) {
  const stripRef = useRef(null);
  const [index, setIndex] = useState(0);
  const total = images.length;

  const scrollTo = next => {
    const el = stripRef.current;
    if (!el) return;
    const target = Math.max(0, Math.min(total - 1, next));
    el.scrollTo({ left: el.clientWidth * target, behavior: 'smooth' });
  };

  return (
    <div className="cm-gallery">
      <div
        className="cm-gallery-strip"
        ref={stripRef}
        onScroll={e => {
          const el = e.currentTarget;
          setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
      >
        {images.map(img => (
          <div className="cm-gallery-item" key={img.url}>
            <img src={resolveBackendMediaUrl(img.url)} alt="" loading="lazy" />
          </div>
        ))}
      </div>

      {total > 1 && (
        <>
          <button
            type="button"
            className="cm-gallery-nav prev"
            onClick={() => scrollTo(index - 1)}
            disabled={index === 0}
            aria-label="이전 사진"
          >
            ‹
          </button>
          <button
            type="button"
            className="cm-gallery-nav next"
            onClick={() => scrollTo(index + 1)}
            disabled={index === total - 1}
            aria-label="다음 사진"
          >
            ›
          </button>
          <span className="cm-gallery-count">
            {index + 1} / {total}
          </span>
          <div className="cm-gallery-dots" aria-hidden="true">
            {images.map((img, i) => (
              <span
                key={img.url}
                className={`cm-gallery-dot${i === index ? ' active' : ''}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PostDetail({
  post,
  onVote,
  onSave,
  onBack,
  onCommentAdded,
  onCommentRemoved,
  onShare,
  onEditPost,
  onDeletePost,
}) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [anonymousComment, setAnonymousComment] = useState(false);
  const [sending, setSending] = useState(false);
  // 서버가 준 커서만 보관한다. 내가 방금 쓴 댓글을 목록 끝에 붙여도
  // 다음 페이지 요청 위치가 밀리지 않게 하기 위해서다.
  const [commentCursor, setCommentCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const commentSentinelRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setCommentCursor(null);
    fetchComments(post.id)
      .then(({ comments: list, nextCursor }) => {
        if (cancelled) return;
        setComments(list);
        setCommentCursor(nextCursor);
      })
      .catch(() => {
        if (!cancelled) setError('댓글을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [post.id]);

  // 댓글 무한 스크롤 — 목록 바닥이 보이면 다음 커서로 이어 붙인다.
  useEffect(() => {
    const el = commentSentinelRef.current;
    if (!el || !commentCursor || loadingMore) return undefined;
    const observer = new IntersectionObserver(
      async entries => {
        if (!entries[0].isIntersecting) return;
        setLoadingMore(true);
        const startedAt = Date.now();
        try {
          const { comments: more, nextCursor } = await fetchComments(post.id, {
            cursor: commentCursor,
          });
          // 응답이 너무 빠르면 로딩 표시가 깜빡 스치고 만다. 서버가 느릴 때는
          // 기다림이 이미 지났으므로 아무것도 더하지 않는다.
          const rest = LOADER_MIN_MS - (Date.now() - startedAt);
          if (rest > 0) await new Promise(r => setTimeout(r, rest));
          // 이미 있는 id는 거른다(페이지 사이에 댓글이 지워졌을 때의 중복 방지).
          setComments(prev => {
            const seen = new Set(prev.map(c => c.id));
            return [...prev, ...more.filter(c => !seen.has(c.id))];
          });
          setCommentCursor(nextCursor);
        } catch {
          // 더 못 불러오면 조용히 멈춘다. 이미 읽은 댓글은 그대로 남는다.
          setCommentCursor(null);
        } finally {
          setLoadingMore(false);
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [commentCursor, loadingMore, post.id]);

  /** 댓글 수정 — 트리 어디에 있든 찾아 바꾼다. */
  const handleEditComment = async (commentId, body) => {
    try {
      const updated = await updateComment(commentId, { body });
      const patch = list =>
        list.map(c =>
          c.id === commentId
            ? { ...c, body: updated.body }
            : { ...c, replies: patch(c.replies || []) },
        );
      setComments(prev => patch(prev));
      return true;
    } catch (err) {
      window.alert(
        err?.message === 'not_logged_in'
          ? '로그인이 필요합니다.'
          : '댓글 수정에 실패했습니다.',
      );
      return false;
    }
  };

  const handleDeleteComment = async commentId => {
    if (!window.confirm('이 댓글을 삭제할까요?')) return;
    try {
      await deleteComment(commentId);
      const strip = list =>
        list
          .filter(c => c.id !== commentId)
          .map(c => ({ ...c, replies: strip(c.replies || []) }));
      setComments(prev => strip(prev));
      onCommentRemoved?.(post.id);
    } catch {
      window.alert('댓글 삭제에 실패했습니다.');
    }
  };

  /** 따봉 토글 — 낙관적으로 반영하고 실패하면 되돌린다. */
  const handleLike = async commentId => {
    const patch = (list, updater) =>
      list.map(c =>
        c.id === commentId
          ? updater(c)
          : { ...c, replies: patch(c.replies || [], updater) },
      );
    const bump = c => ({
      ...c,
      liked: !c.liked,
      likes: c.likes + (c.liked ? -1 : 1),
    });
    setComments(prev => patch(prev, bump));
    try {
      const result = await likeComment(commentId);
      setComments(prev =>
        patch(prev, c => ({ ...c, liked: result.liked, likes: result.likes })),
      );
    } catch (err) {
      setComments(prev => patch(prev, bump));
      window.alert(
        err?.message === 'not_logged_in'
          ? '좋아요는 로그인 후 이용할 수 있어요.'
          : '좋아요에 실패했습니다.',
      );
    }
  };

  /** 답글 등록 — 성공하면 해당 부모 아래에 끼워 넣는다. */
  const handleReply = async (parentId, { body, anonymous }) => {
    try {
      const created = await createComment(post.id, {
        body,
        parentId,
        anonymous,
      });
      setComments(prev =>
        prev.map(c =>
          c.id === parentId ? { ...c, replies: [...c.replies, created] } : c,
        ),
      );
      onCommentAdded?.(post.id);
      return true;
    } catch (err) {
      window.alert(
        err?.message === 'not_logged_in'
          ? '답글은 로그인 후 남길 수 있어요.'
          : '답글 등록에 실패했습니다.',
      );
      return false;
    }
  };

  const handleSubmit = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const created = await createComment(post.id, {
        body,
        anonymous: anonymousComment,
      });
      setComments(prev => [...prev, created]);
      setDraft('');
      onCommentAdded?.(post.id);
    } catch (err) {
      window.alert(
        err?.message === 'not_logged_in'
          ? '댓글은 로그인 후 남길 수 있어요.'
          : '댓글 등록에 실패했습니다.',
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="cm-detail">
      <button type="button" className="cm-back-btn" onClick={onBack}>
        ← 목록으로
      </button>
      <article className="cm-post cm-post--detail">
        <div className="cm-post-body">
          {post.isMine && (
            <KebabMenu
              label="글 메뉴"
              onEdit={() => onEditPost?.(post)}
              onDelete={() => onDeletePost?.(post.id)}
            />
          )}
          <div className="cm-post-meta">
            <span className="cm-board-chip">{boardName(post.boardId)}</span>
            <span className="cm-dot">·</span>
            <span className="cm-post-author">{authorLabel(post)}</span>
            <span className="cm-dot">·</span>
            <span>{timeAgo(post.createdAt)}</span>
            {post.place && (
              <>
                <span className="cm-bar">|</span>
                <span className="cm-meta-place">{post.place}</span>
              </>
            )}
            <span className="cm-dot">·</span>
            <span className="cm-meta-views">
              <LineIcon name="eye" className="cm-meta-icon" /> {post.views}
            </span>
          </div>
          <h2 className="cm-detail-title">{post.title}</h2>
          {post.images?.length > 0 && <PostImages images={post.images} />}
          <p className="cm-detail-text">{post.body}</p>
          <div className="cm-post-actions">
            <VotePill
              votes={post.votes}
              myVote={post.myVote}
              onVote={v => onVote(post.id, v)}
            />
            <span className="cm-bar">|</span>
            <span className="cm-post-action">
              <LineIcon name="comment" /> 댓글 {post.comments}
            </span>

            <span className="cm-bar">|</span>
            <span className="cm-post-action" onClick={() => onShare?.(post)}>
              <LineIcon name="share" /> 공유
            </span>
            <span className="cm-bar">|</span>
            <span
              className={`cm-post-action${post.saved ? ' active' : ''}`}
              onClick={() => onSave?.(post.id)}
            >
              <LineIcon name="save" /> {post.saved ? '저장됨' : '저장'}
            </span>
          </div>
        </div>
      </article>

      <section className="cm-comment-section">
        {/* 카운터와 전송 버튼은 입력창 안쪽 우측 하단에 겹쳐둡니다. */}
        <div className="cm-comment-box">
          <textarea
            className="cm-comment-input"
            placeholder="댓글을 남겨보세요"
            rows={3}
            maxLength={COMMENT_MAX}
            value={draft}
            onChange={e => setDraft(e.target.value)}
          />
          <div className="cm-comment-input-actions">
            <label className="cm-switch cm-switch--sm">
              <input
                type="checkbox"
                checked={anonymousComment}
                onChange={e => setAnonymousComment(e.target.checked)}
              />
              <span className="cm-switch-track" aria-hidden="true">
                <span className="cm-switch-thumb" />
              </span>
              <span className="cm-switch-label">익명</span>
            </label>
            <span className="cm-comment-count">
              {draft.length}/{COMMENT_MAX}
            </span>
            <button
              type="button"
              className="cm-send-btn"
              disabled={!draft.trim() || sending}
              onClick={handleSubmit}
              aria-label="댓글 등록"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M3.6 4.3 20.5 11.5c.7.3.7 1.3 0 1.6L3.6 20.3c-.7.3-1.4-.4-1.1-1.1l2.3-6.1c.1-.2.3-.4.6-.4l7.3-.6c.4 0 .4-.6 0-.6l-7.3-.6c-.3 0-.5-.2-.6-.4L2.5 5.4c-.3-.7.4-1.4 1.1-1.1z" />
              </svg>
            </button>
          </div>
        </div>

        {loading ? (
          <p className="cm-empty">댓글을 불러오는 중…</p>
        ) : error ? (
          <p className="cm-empty">{error}</p>
        ) : comments.length === 0 ? (
          <p className="cm-empty">아직 댓글이 없습니다. 첫 댓글을 남겨보세요.</p>
        ) : (
          <ul className="cm-comment-list">
            {comments.map(c => (
              <Comment
                key={c.id}
                comment={c}
                onReply={handleReply}
                onLike={handleLike}
                onEdit={handleEditComment}
                onDelete={handleDeleteComment}
              />
            ))}
          </ul>
        )}
        {commentCursor && (
          <div ref={commentSentinelRef} className="cm-loading-more">
            댓글 더 불러오는 중…
          </div>
        )}
      </section>
    </div>
  );
}

/** 글쓰기 — 모달이 아니라 커뮤니티 안의 전용 화면. */
function WritePage({ onCancel, onSubmit, editing = null, draftId = 'new' }) {
  // 임시 저장본이 있으면 그걸 먼저, 없으면 수정 대상 글의 값으로 시작한다.
  const saved = readDraft(draftId);
  const [boardId, setBoardId] = useState(
    saved?.boardId ?? editing?.boardId ?? BOARD_UNSET,
  );
  const [title, setTitle] = useState(saved?.title ?? editing?.title ?? '');
  const [place, setPlace] = useState(saved?.place ?? editing?.place ?? '');
  // 갤러리 장소를 고르면 placeId가 채워집니다. 직접 입력한 값은 이름만 저장됩니다.
  const [placeId, setPlaceId] = useState(saved?.placeId ?? editing?.placeId ?? null);
  const [suggestions, setSuggestions] = useState([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const placeBoxRef = useRef(null);
  const [body, setBody] = useState(saved?.body ?? editing?.body ?? '');
  // 수정 모드에서 이미 올라가 있는 사진 — 여기서 빼면 저장할 때 삭제됩니다.
  const [keptImages, setKeptImages] = useState(editing?.images || []);
  // 새로 고른 사진은 등록할 때 업로드해 URL을 함께 저장합니다.
  const [photos, setPhotos] = useState([]);
  const [photoMsg, setPhotoMsg] = useState('');
  const [dragging, setDragging] = useState(false);
  const [anonymous, setAnonymous] = useState(
    Boolean(saved?.anonymous ?? editing?.anonymous),
  );
  const fileInputRef = useRef(null);
  const photosRef = useRef(photos);
  photosRef.current = photos;

  // 장소 자동완성 — 입력이 멈추면 조회한다.
  useEffect(() => {
    const q = place.trim();
    if (!q || placeId) {
      setSuggestions([]);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      fetchPlaceSuggestions(q)
        .then(rows => {
          if (!cancelled) setSuggestions(rows);
        })
        .catch(() => {
          if (!cancelled) setSuggestions([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [place, placeId]);

  useEffect(() => {
    if (!suggestOpen) return undefined;
    const handler = e => {
      if (placeBoxRef.current && !placeBoxRef.current.contains(e.target)) {
        setSuggestOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [suggestOpen]);

  // 처음 값과 달라졌는지 — 나갈 때 물어볼지 판단하는 기준
  const isDirty =
    boardId !== (editing?.boardId || BOARD_UNSET) ||
    title !== (editing?.title || '') ||
    place !== (editing?.place || '') ||
    body !== (editing?.body || '') ||
    anonymous !== Boolean(editing?.anonymous) ||
    photos.length > 0 ||
    keptImages.length !== (editing?.images?.length || 0);

  // 입력을 임시 저장해 둔다 — 실수로 나가도 돌아오면 이어서 쓸 수 있다.
  useEffect(() => {
    if (!isDirty) {
      clearDraft(draftId);
      return;
    }
    saveDraft(draftId, { boardId, title, place, placeId, body, anonymous });
  }, [draftId, isDirty, boardId, title, place, placeId, body, anonymous]);

  // 새로고침·탭 닫기에는 브라우저 기본 경고를 띄운다.
  useEffect(() => {
    if (!isDirty) return undefined;
    const handler = e => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const handleCancel = () => {
    if (isDirty && !window.confirm('작성 중인 내용이 있어요. 나가시겠어요?')) {
      return;
    }
    clearDraft(draftId);
    onCancel?.();
  };

  // 언마운트 시 남은 objectURL 회수 (해제하지 않으면 메모리에 계속 남음)
  useEffect(
    () => () => {
      photosRef.current.forEach(p => URL.revokeObjectURL(p.url));
    },
    [],
  );

  const addFiles = fileList => {
    const images = Array.from(fileList || []).filter(f =>
      f.type.startsWith('image/'),
    );
    if (!images.length) {
      setPhotoMsg('이미지 파일만 첨부할 수 있어요.');
      return;
    }
    const room = PHOTO_MAX - photos.length - keptImages.length;
    if (room <= 0) {
      setPhotoMsg(`사진은 최대 ${PHOTO_MAX}장까지 첨부할 수 있어요.`);
      return;
    }
    setPhotoMsg(
      images.length > room
        ? `사진은 최대 ${PHOTO_MAX}장까지예요. ${room}장만 추가했어요.`
        : '',
    );
    setPhotos(prev => [
      ...prev,
      ...images.slice(0, room).map(file => ({
        id: `${file.name}-${file.lastModified}-${Math.random()}`,
        file,
        url: URL.createObjectURL(file),
      })),
    ]);
  };

  const removePhoto = id => {
    setPhotos(prev => {
      const target = prev.find(p => p.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter(p => p.id !== id);
    });
    setPhotoMsg('');
  };

  const [submitting, setSubmitting] = useState(false);
  const canSubmit =
    Boolean(boardId) && title.trim() && body.trim() && !submitting;

  return (
    <div className="cm-write">
      <div className="cm-write-main">
        <button type="button" className="cm-back-btn" onClick={handleCancel}>
          ← 목록으로
        </button>

        <div className="cm-write-board-row">
          <span className="cm-write-board-label">게시판</span>
          <Dropdown
            value={boardId}
            options={BOARD_OPTIONS}
            onChange={setBoardId}
            className={`cm-dropdown--board${boardId ? '' : ' cm-dropdown--required'}`}
            ariaLabel="게시판"
          />
          {!boardId && (
            <span className="cm-write-required">게시판을 골라주세요</span>
          )}

          <label className="cm-switch">
            <input
              type="checkbox"
              checked={anonymous}
              onChange={e => setAnonymous(e.target.checked)}
            />
            <span className="cm-switch-track" aria-hidden="true">
              <span className="cm-switch-thumb" />
            </span>
            <span className="cm-switch-label">익명으로 작성</span>
          </label>
        </div>

        <input
          className="cm-write-title-input"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="제목"
          aria-label="제목"
        />

        <div className="cm-write-place-box" ref={placeBoxRef}>
          <input
            className="cm-write-place"
            value={place}
            onChange={e => {
              setPlace(e.target.value);
              setPlaceId(null); // 직접 고친 순간 연결을 끊는다
              setSuggestOpen(true);
            }}
            onFocus={() => setSuggestOpen(true)}
            placeholder="장소 추가 (선택) — 갤러리에서 찾기"
            aria-label="장소"
            autoComplete="off"
          />
          {placeId && (
            <span className="cm-place-linked" title="갤러리 장소와 연결됨">
              연결됨
            </span>
          )}
          {suggestOpen && suggestions.length > 0 && (
            <ul className="cm-suggest-list">
              {suggestions.map(item => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="cm-suggest-item"
                    onClick={() => {
                      setPlace(item.name);
                      setPlaceId(item.id);
                      setSuggestOpen(false);
                    }}
                  >
                    <span className="cm-suggest-name">{item.name}</span>
                    <span className="cm-suggest-sub">
                      {item.region || item.address}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <textarea
          className="cm-write-body"
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={14}
          placeholder={BODY_PLACEHOLDER}
          aria-label="내용"
        />

        <div className="cm-write-photos">
          <button
            type="button"
            className={`cm-dropzone${dragging ? ' dragging' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => {
              e.preventDefault();
              setDragging(false);
              addFiles(e.dataTransfer.files);
            }}
          >
            <LineIcon name="image" />
            <span className="cm-dropzone-text">
              사진을 끌어다 놓거나 클릭해 선택하세요
            </span>
            <span className="cm-dropzone-hint">
              {keptImages.length + photos.length}/{PHOTO_MAX}장
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={e => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          {photoMsg && <p className="cm-photo-msg">{photoMsg}</p>}
          {(keptImages.length > 0 || photos.length > 0) && (
            <ul className="cm-photo-grid">
              {keptImages.map((img, i) => (
                <li key={img.url} className="cm-photo">
                  <img src={resolveBackendMediaUrl(img.thumbUrl || img.url)} alt="" />
                  {i === 0 && <span className="cm-photo-badge">대표</span>}
                  <button
                    type="button"
                    className="cm-photo-remove"
                    onClick={() =>
                      setKeptImages(prev => prev.filter(x => x.url !== img.url))
                    }
                    aria-label="사진 삭제"
                  >
                    ✕
                  </button>
                </li>
              ))}
              {photos.map((p, i) => (
                <li key={p.id} className="cm-photo">
                  <img src={p.url} alt="" />
                  {keptImages.length === 0 && i === 0 && (
                    <span className="cm-photo-badge">대표</span>
                  )}
                  <button
                    type="button"
                    className="cm-photo-remove"
                    onClick={() => removePhoto(p.id)}
                    aria-label="사진 삭제"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="cm-write-actions">
          <button type="button" className="cm-btn" onClick={handleCancel}>
            취소
          </button>
          <button
            type="button"
            className="cm-btn cm-btn--primary"
            disabled={!canSubmit}
            onClick={async () => {
              setSubmitting(true);
              try {
                // 사진을 먼저 올리고, 받은 URL을 글과 함께 저장한다.
                const uploaded = [];
                for (const photo of photos) {
                  uploaded.push(await uploadCommunityImage(photo.file));
                }
                await onSubmit({
                  boardId,
                  title,
                  place,
                  placeId,
                  body,
                  anonymous,
                  images: [
                    ...keptImages.map(img => ({
                      url: img.url,
                      thumbUrl: img.thumbUrl,
                    })),
                    ...uploaded,
                  ],
                });
                clearDraft(draftId);
              } catch (err) {
                window.alert(
                  err?.message === 'not_logged_in'
                    ? '글쓰기는 로그인 후 이용할 수 있어요.'
                    : `사진 업로드에 실패했습니다. ${err?.message || ''}`.trim(),
                );
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting ? '올리는 중…' : editing ? '수정 완료' : '등록'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CommunityPage() {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [trending, setTrending] = useState([]);

  // 상세 글은 URL(?post=)이 단일 소스 — 새로고침·뒤로가기·공유가 그대로 동작한다.
  const [searchParams, setSearchParams] = useSearchParams();
  const openPostId = Number(searchParams.get('post')) || null;

  // ?q=는 밖에서 들어올 때만 쓰는 입력값이다(장소 상세의 "커뮤니티에서 더 보기" 등).
  // 검색창을 고칠 때 URL에 되쓰지 않는다 — 두 방향으로 동기화하면 서로를 덮어써
  // 무한 렌더로 이어진다.
  const queryParam = searchParams.get('q') || '';

  const [activeBoard, setActiveBoard] = useState('all');
  const [sort, setSort] = useState('new');
  const [query, setQuery] = useState(queryParam);
  // 입력할 때마다 서버를 부르지 않도록 검색어만 잠시 늦춘다.
  const [debouncedQuery, setDebouncedQuery] = useState(queryParam);

  // 같은 화면에 머문 채 ?q=만 바뀌는 경우(장소를 연달아 열어볼 때)를 위해 따라간다.
  const prevQueryParam = useRef(queryParam);
  useEffect(() => {
    if (queryParam !== prevQueryParam.current) {
      prevQueryParam.current = queryParam;
      setQuery(queryParam);
    }
  }, [queryParam]);

  /**
   * 글을 열 때는 히스토리에 쌓고(push), 목록으로 돌아올 때는 그 기록을 대체(replace)한다.
   * → 브라우저 뒤로가기가 상세에서 목록으로 오고, 목록에서 다시 뒤로 가면 이전 화면으로 간다.
   */
  const setOpenPostId = (id, { replace = false } = {}) => {
    const next = new URLSearchParams(searchParams);
    if (id == null) next.delete('post');
    else next.set('post', String(id));
    setSearchParams(next, { replace });
  };

  /**
   * 글쓰기도 URL(?write=)에 담는다 — 브라우저 뒤로가기로 닫히게 하기 위해서다.
   * write=new 는 새 글, write=<id> 는 그 글 수정.
   */
  const writeParam = searchParams.get('write');
  const isWriteOpen = Boolean(writeParam);

  const setWriteParam = (value, { replace = false } = {}) => {
    const next = new URLSearchParams(searchParams);
    if (value == null) next.delete('write');
    else next.set('write', String(value));
    if (value != null) next.delete('post'); // 글쓰기 중에는 상세를 닫는다
    setSearchParams(next, { replace });
  };

  // 수정할 글 — 있으면 글쓰기 화면이 수정 모드로 열린다.
  const [editingPost, setEditingPost] = useState(null);

  // 새로고침·딥링크로 write=<id> 로 들어온 경우 글을 채워 넣는다.
  useEffect(() => {
    if (!writeParam || writeParam === 'new') {
      setEditingPost(null);
      return undefined;
    }
    const id = Number(writeParam);
    const known = posts.find(p => p.id === id) || null;
    if (known) {
      setEditingPost(known);
      return undefined;
    }
    let cancelled = false;
    fetchPost(id)
      .then(detail => {
        if (!cancelled) setEditingPost(detail);
      })
      .catch(() => {
        if (!cancelled) setWriteParam(null, { replace: true });
      });
    return () => {
      cancelled = true;
    };
    // posts 변화로 매번 다시 부르지 않도록 writeParam 만 본다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writeParam]);
  // 공유 결과 등 짧은 안내
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 2000);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleShare = async post => {
    const message = await sharePost(post);
    if (message) setToast(message);
  };
  // 목록 → 상세로 갈 때 스크롤이 그대로 남지 않도록.
  // 돌아올 때는 보던 위치로 되돌린다.
  const listScrollY = useRef(0);
  const sentinelRef = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // 조건이 바뀌면 첫 페이지부터 다시 불러온다.
  const reload = useCallback(async ({ silent = false } = {}) => {
    // silent: 목록으로 돌아올 때 등 화면을 비우지 않고 갱신만 한다.
    if (!silent) setLoading(true);
    setLoadError('');
    try {
      const { posts: rows, nextCursor: cursor } = await fetchPosts({
        board: activeBoard,
        sort,
        q: debouncedQuery,
        limit: PAGE_SIZE,
      });
      setPosts(rows);
      setNextCursor(cursor);
    } catch {
      // 조용한 갱신이 실패하면 보고 있던 목록을 그대로 둔다.
      if (!silent) {
        setLoadError('글을 불러오지 못했습니다.');
        setPosts([]);
        setNextCursor(null);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [activeBoard, sort, debouncedQuery]);

  useEffect(() => {
    reload();
  }, [reload]);

  // 인기 장소 — 글이 추가·삭제되면 다시 집계되도록 posts 길이에 맞춰 갱신한다.
  useEffect(() => {
    let cancelled = false;
    fetchTrendingPlaces()
      .then(rows => {
        if (!cancelled) setTrending(rows);
      })
      .catch(() => {
        if (!cancelled) setTrending([]);
      });
    return () => {
      cancelled = true;
    };
  }, [posts.length]);

  // 무한 스크롤 — 바닥이 보이면 다음 커서로 이어 붙인다.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !nextCursor || loadingMore) return undefined;
    const observer = new IntersectionObserver(
      async entries => {
        if (!entries[0].isIntersecting) return;
        setLoadingMore(true);
        try {
          const { posts: rows, nextCursor: cursor } = await fetchPosts({
            board: activeBoard,
            sort,
            q: debouncedQuery,
            cursor: nextCursor,
            limit: PAGE_SIZE,
          });
          // 같은 글이 두 번 들어오지 않도록 id로 거른다.
          setPosts(prev => {
            const seen = new Set(prev.map(p => p.id));
            return [...prev, ...rows.filter(p => !seen.has(p.id))];
          });
          setNextCursor(cursor);
        } catch {
          setNextCursor(null);
        } finally {
          setLoadingMore(false);
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [nextCursor, loadingMore, activeBoard, sort, debouncedQuery]);

  const openPostDetail = id => {
    listScrollY.current = window.scrollY;
    setOpenPostId(id);
    window.scrollTo({ top: 0 });
  };

  const backToList = () => {
    setOpenPostId(null, { replace: true });
  };

  // 상세 → 목록으로 돌아오면(버튼이든 브라우저 뒤로가기든) 보던 위치로 복원한다.
  // 글쓰기 화면을 벗어나면(취소·뒤로가기) 보던 위치로 되돌린다.
  const prevWriteParam = useRef(writeParam);
  useEffect(() => {
    if (prevWriteParam.current && !writeParam) {
      requestAnimationFrame(() => {
        window.scrollTo({ top: listScrollY.current });
      });
    }
    prevWriteParam.current = writeParam;
  }, [writeParam]);

  const prevOpenPostId = useRef(openPostId);
  useEffect(() => {
    if (prevOpenPostId.current != null && openPostId == null) {
      // 상세에서 달린 댓글·투표나 그 사이 올라온 글이 목록에도 보이도록 다시 불러온다.
      reload({ silent: true });
      requestAnimationFrame(() => {
        window.scrollTo({ top: listScrollY.current });
      });
    }
    prevOpenPostId.current = openPostId;
  }, [openPostId, reload]);

  const requireLogin = message => {
    window.alert(message);
  };

  const patchPost = (postId, patch) => {
    setPosts(prev => prev.map(p => (p.id === postId ? { ...p, ...patch } : p)));
    setOpenPost(prev => (prev && prev.id === postId ? { ...prev, ...patch } : prev));
  };

  const handleVote = async (postId, myVote) => {
    const before =
      posts.find(p => p.id === postId) ||
      (openPost?.id === postId ? openPost : null);
    if (!before) return;
    // 낙관적 반영 후 실패하면 되돌린다.
    const delta = myVote - before.myVote;
    patchPost(postId, { myVote, votes: before.votes + delta });
    try {
      const result = await votePost(postId, myVote);
      patchPost(postId, { votes: result.votes, myVote: result.myVote });
    } catch (err) {
      patchPost(postId, { myVote: before.myVote, votes: before.votes });
      requireLogin(
        err?.message === 'not_logged_in'
          ? '추천은 로그인 후 이용할 수 있어요.'
          : '투표에 실패했습니다.',
      );
    }
  };

  const handleToggleSave = async postId => {
    const before =
      posts.find(p => p.id === postId) ||
      (openPost?.id === postId ? openPost : null);
    if (!before) return;
    patchPost(postId, { saved: !before.saved });
    try {
      const result = await toggleSavePost(postId);
      patchPost(postId, { saved: result.saved });
    } catch (err) {
      patchPost(postId, { saved: before.saved });
      requireLogin(
        err?.message === 'not_logged_in'
          ? '저장은 로그인 후 이용할 수 있어요.'
          : '저장에 실패했습니다.',
      );
    }
  };

  const handleDeletePost = async postId => {
    if (!window.confirm('이 글을 삭제할까요?')) return;
    try {
      await deletePost(postId);
      setPosts(prev => prev.filter(p => p.id !== postId));
      if (openPostId === postId) setOpenPostId(null, { replace: true });
    } catch {
      window.alert('글 삭제에 실패했습니다.');
    }
  };

  const startEditPost = post => {
    listScrollY.current = window.scrollY;
    setEditingPost(post);
    setWriteParam(post.id);
    window.scrollTo({ top: 0 });
  };

  const handleUpdate = async draft => {
    try {
      const updated = await updatePost(editingPost.id, {
        boardId: draft.boardId,
        title: draft.title,
        body: draft.body,
        place: draft.place,
        placeId: draft.placeId,
        anonymous: draft.anonymous,
        images: draft.images || [],
      });
      setPosts(prev => prev.map(p => (p.id === updated.id ? updated : p)));
      setOpenPost(prev => (prev && prev.id === updated.id ? updated : prev));
      setWriteParam(null, { replace: true });
      setEditingPost(null);
    } catch (err) {
      window.alert(
        err?.message === 'not_logged_in'
          ? '로그인이 필요합니다.'
          : '글 수정에 실패했습니다.',
      );
    }
  };

  const handleCreate = async draft => {
    try {
      const created = await createPost({
        boardId: draft.boardId,
        title: draft.title,
        body: draft.body,
        place: draft.place,
        placeId: draft.placeId,
        anonymous: draft.anonymous,
        images: draft.images || [],
      });
      setWriteParam(null, { replace: true });
      // 어느 게시판을 보고 있었든 전체 목록으로 옮긴다. 최신순이라 방금 쓴 글이
      // 무슨 게시판이든 맨 위에 오므로, 등록됐는지 바로 확인할 수 있다.
      setActiveBoard('all');
      setSort('new');
      // 게시판·정렬이 그대로면 재조회가 걸리지 않으므로, 새 글은 여기서 직접 얹는다.
      // 상태가 바뀌어 재조회가 돌면 서버 목록이 이 배열을 대체한다.
      setPosts(prev => [created, ...prev.filter(p => p.id !== created.id)]);
      window.scrollTo({ top: 0 });
    } catch (err) {
      window.alert(
        err?.message === 'not_logged_in'
          ? '글쓰기는 로그인 후 이용할 수 있어요.'
          : '글 등록에 실패했습니다.',
      );
    }
  };

  const shownPosts = posts;
  const hasMore = Boolean(nextCursor);

  // 상세는 서버에서 단건으로 가져온다.
  // 목록 첫 페이지에 없는 글(마이페이지 딥링크 등)도 열리고, 이때 조회수가 올라간다.
  const [openPost, setOpenPost] = useState(null);
  const [openPostError, setOpenPostError] = useState('');

  useEffect(() => {
    if (openPostId == null) {
      setOpenPost(null);
      setOpenPostError('');
      return undefined;
    }
    let cancelled = false;
    setOpenPostError('');
    fetchPost(openPostId)
      .then(detail => {
        if (cancelled) return;
        setOpenPost(detail);
        // 목록에도 최신 수치를 반영
        setPosts(prev =>
          prev.map(p => (p.id === detail.id ? { ...p, ...detail } : p)),
        );
      })
      .catch(() => {
        if (!cancelled) setOpenPostError('글을 찾을 수 없습니다.');
      });
    return () => {
      cancelled = true;
    };
  }, [openPostId]);

  // 글쓰기는 목록/상세를 덮는 전용 화면
  if (isWriteOpen) {
    // write=<id> 로 들어왔는데 아직 글을 못 받았으면 잠시 기다린다.
    if (writeParam !== 'new' && !editingPost) {
      return <p className="cm-empty">글을 불러오는 중…</p>;
    }
    return (
      <WritePage
        key={writeParam}
        draftId={writeParam}
        editing={editingPost}
        onCancel={() => {
          setWriteParam(null, { replace: true });
          setEditingPost(null);
          requestAnimationFrame(() => {
            window.scrollTo({ top: listScrollY.current });
          });
        }}
        onSubmit={editingPost ? handleUpdate : handleCreate}
      />
    );
  }

  return (
    <div className="cm-page">
      {/* ── 좌측: 게시판 목록 ── */}
      <aside className="cm-side cm-side--left">
        <ul className="cm-board-list">
          {COMMUNITY_BOARDS.map(b => (
            <li key={b.id}>
              <button
                type="button"
                className={`cm-board-item${activeBoard === b.id ? ' active' : ''}`}
                onClick={() => {
                  setActiveBoard(b.id);
                  setOpenPostId(null, { replace: true });
                }}
              >
                <span className="cm-board-name">{b.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* ── 중앙: 피드 ── */}
      <section className="cm-feed">
        {/* key가 바뀌면 다시 마운트되면서 등장 애니메이션이 재생된다. */}
        <div
          className={`cm-view cm-view--${openPost ? 'detail' : 'list'}`}
          key={openPost ? `post-${openPost.id}` : 'list'}
        >
        {openPostId != null && !openPost ? (
          <p className="cm-empty">
            {openPostError || '글을 불러오는 중…'}
          </p>
        ) : openPost ? (
          <PostDetail
            post={openPost}
            onVote={handleVote}
            onSave={handleToggleSave}
            onBack={backToList}
            onCommentAdded={postId =>
              patchPost(postId, {
                comments:
                  (posts.find(p => p.id === postId)?.comments || 0) + 1,
              })
            }
            onCommentRemoved={postId =>
              patchPost(postId, {
                comments: Math.max(
                  0,
                  (posts.find(p => p.id === postId)?.comments || 0) - 1,
                ),
              })
            }
            onShare={handleShare}
            onEditPost={startEditPost}
            onDeletePost={handleDeletePost}
          />
        ) : (
          <>
            <div className="cm-toolbar">
              <Dropdown
                value={sort}
                options={COMMUNITY_SORTS}
                onChange={setSort}
                ariaLabel="정렬 기준"
              />
              <div className="cm-toolbar-right">
                {/* 우측 사이드바가 숨는 좁은 화면에서만 노출되는 글쓰기 버튼 */}
                <button
                  type="button"
                  className="cm-btn cm-btn--primary cm-toolbar-write"
                  onClick={() => {
                    listScrollY.current = window.scrollY;
                    setWriteParam('new');
                    window.scrollTo({ top: 0 });
                  }}
                >
                  글 쓰기
                </button>
                <input
                  className="cm-search"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="커뮤니티 검색"
                />
              </div>
            </div>

            {loading ? (
              <div className="cm-post-list">
                {Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="cm-post-skeleton">
                    <div className="cm-skeleton-line cm-skeleton-line--meta" />
                    <div className="cm-skeleton-line cm-skeleton-line--title" />
                    <div className="cm-skeleton-line" />
                    <div className="cm-skeleton-line cm-skeleton-line--short" />
                  </div>
                ))}
              </div>
            ) : loadError ? (
              <div className="cm-empty">
                <p>{loadError}</p>
                <button type="button" className="cm-btn" onClick={reload}>
                  다시 시도
                </button>
              </div>
            ) : shownPosts.length === 0 ? (
              <p className="cm-empty">아직 글이 없습니다. 첫 글을 남겨보세요.</p>
            ) : (
              <>
                <div className="cm-post-list">
                  {shownPosts.map(post => (
                    <PostCard
                      key={post.id}
                      post={post}
                      onVote={handleVote}
                      onSave={handleToggleSave}
                      onShare={handleShare}
                      onEdit={startEditPost}
                      onDelete={handleDeletePost}
                      onOpen={p => openPostDetail(p.id)}
                    />
                  ))}
                </div>
                {hasMore && (
                  <div ref={sentinelRef} className="cm-loading-more">
                    글 더 불러오는 중…
                  </div>
                )}
              </>
            )}
          </>
        )}
        </div>
      </section>

      {toast && <div className="cm-toast">{toast}</div>}

      {/* ── 우측: 정보 사이드바 ── */}
      <aside className="cm-side cm-side--right">
        <div className="cm-card">
          <p className="cm-card-title">커뮤니티 소개</p>
          <p className="cm-card-text">
            광주광역시와 전라남도의 장소에 대한 후기·질문·추천을 나누는
            공간입니다.
          </p>
          <div className="cm-stats">
            <div>
              <strong>{posts.length}</strong>
              <span>불러온 글</span>
            </div>
          </div>
          <button
            type="button"
            className="cm-btn cm-btn--primary cm-btn--block"
            onClick={() => {
              listScrollY.current = window.scrollY;
              setWriteParam('new');
              window.scrollTo({ top: 0 });
            }}
          >
            글 쓰기
          </button>
        </div>

        <div className="cm-card">
          <div className="cm-card-title-row">
            <p className="cm-card-title">지금 많이 찾는 장소</p>
            <div className="cm-help-btn" aria-label="집계 방식">
              ?
              <div className="cm-help-tooltip">{TRENDING_HELP_TEXT}</div>
            </div>
          </div>
          {trending.length === 0 && (
            <p className="cm-card-text">아직 집계된 장소가 없어요.</p>
          )}
          <ul className="cm-trend-list">
            {trending.map((t, i) => (
              // 위에서부터 차례로 나타나게 — 순서를 지연으로 넘긴다
              <li key={t.label} style={{ '--i': i }}>
                <button
                  type="button"
                  className="cm-trend-item"
                  onClick={() => {
                    // 보고 있던 게시판은 그대로 두고 검색어만 채운다.
                    setQuery(t.label);
                    setOpenPostId(null, { replace: true });
                    window.scrollTo({ top: 0 });
                  }}
                >
                  <span className="cm-trend-rank">{i + 1}</span>
                  <span className="cm-trend-label">{t.label}</span>
                  <span className="cm-trend-count">{t.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="cm-card">
          <p className="cm-card-title">커뮤니티 규칙</p>
          <ol className="cm-rule-list">
            {COMMUNITY_RULES.map((rule, i) => (
              <li key={i}>{rule}</li>
            ))}
          </ol>
        </div>
      </aside>

    </div>
  );
}
