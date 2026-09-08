import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  COMMUNITY_BOARDS,
  COMMUNITY_COMMENTS,
  COMMUNITY_POSTS,
  COMMUNITY_RULES,
  COMMUNITY_SORTS,
  COMMUNITY_TRENDING,
} from '../data/communityMock';
import LineIcon from '../components/ui/LineIcon';

/**
 * 커뮤니티 — 광주·전남 장소 이야기를 쓰는 공간.
 * 현재는 UI 전용이며 모든 데이터는 communityMock.js 목업입니다.
 * (투표·글쓰기·댓글은 로컬 state에만 반영되고 서버로 전송되지 않습니다.)
 */

/** 댓글 입력 글자 수 상한. */
const COMMENT_MAX = 500;

/** 글 하나에 첨부할 수 있는 사진 수. */
const PHOTO_MAX = 5;

/** 무한 스크롤에서 한 번에 더 불러오는 글 수. */
const PAGE_SIZE = 20;

/** 내용 입력 안내 — 커뮤니티 규칙을 그대로 옮겨 적습니다. */
const BODY_PLACEHOLDER = [
  '방문 시기, 가는 방법, 좋았던 점을 적어주세요.',
  '',
  ...COMMUNITY_RULES.map(rule => `· ${rule}`),
].join('\n');

const boardName = id =>
  COMMUNITY_BOARDS.find(b => b.id === id)?.name || '전체';

/** 익명 글은 아이디 대신 '익명'으로 표시합니다. */
const authorLabel = post => (post.anonymous ? '익명' : `u/${post.author}`);

/** 하단 액션 줄에 들어가는 알약형 투표 버튼. */
function VotePill({ votes, myVote, onVote }) {
  const score = votes + (myVote === 1 ? 1 : 0) - (myVote === -1 ? 1 : 0);
  return (
    <div className="cm-vote">
      <button
        type="button"
        className={`cm-vote-btn${myVote === 1 ? ' up' : ''}`}
        onClick={e => {
          e.stopPropagation();
          onVote(myVote === 1 ? 0 : 1);
        }}
        aria-label="추천"
      >
        ▲
      </button>
      <span className={`cm-vote-score${myVote === 1 ? ' up' : ''}${myVote === -1 ? ' down' : ''}`}>
        {score}
      </span>
      <button
        type="button"
        className={`cm-vote-btn${myVote === -1 ? ' down' : ''}`}
        onClick={e => {
          e.stopPropagation();
          onVote(myVote === -1 ? 0 : -1);
        }}
        aria-label="비추천"
      >
        ▼
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

/** 게시판 선택용 옵션 (전체 제외). */
const BOARD_OPTIONS = COMMUNITY_BOARDS.filter(b => b.id !== 'all').map(b => ({
  id: b.id,
  label: b.name,
}));

function PostCard({ post, onVote, onOpen }) {
  return (
    <article className="cm-post" onClick={() => onOpen(post)}>
      <div className="cm-post-body">
        <div className="cm-post-meta">
          <span className="cm-board-chip">{boardName(post.boardId)}</span>
          <span className="cm-dot">·</span>
          <span className="cm-post-author">{authorLabel(post)}</span>
          <span className="cm-dot">·</span>
          <span>{post.createdAt}</span>
          {post.place && (
            <>
              <span className="cm-bar">|</span>
              <span className="cm-meta-place">{post.place}</span>
            </>
          )}
        </div>
        <h3 className="cm-post-title">{post.title}</h3>
        <p className="cm-post-excerpt">{post.body}</p>
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
          <span className="cm-post-action">
            <LineIcon name="share" /> 공유
          </span>
          <span className="cm-bar">|</span>
          <span className="cm-post-action">
            <LineIcon name="save" /> 저장
          </span>
        </div>
      </div>
    </article>
  );
}

function Comment({ comment, depth = 0 }) {
  const replies = comment.replies || [];
  const [showReplies, setShowReplies] = useState(true);

  return (
    <li className="cm-comment" style={{ marginLeft: depth ? 24 : 0 }}>
      <div className="cm-comment-head">
        <span className="cm-comment-avatar" aria-hidden="true">
          {comment.anonymous ? '?' : comment.author.slice(0, 1).toUpperCase()}
        </span>
        <span className="cm-post-author">{authorLabel(comment)}</span>
        <span className="cm-dot">·</span>
        <span>{comment.createdAt}</span>
      </div>
      <p className="cm-comment-body">{comment.body}</p>
      <div className="cm-comment-actions">
        <span className="cm-post-action">▲ {comment.votes}</span>
        <span className="cm-bar">|</span>
        <span className="cm-post-action">답글</span>
        <span className="cm-bar">|</span>
        <span className="cm-post-action">공유</span>
      </div>
      {replies.length > 0 && (
        <>
          {showReplies && (
            <ul className="cm-comment-list cm-comment-list--nested">
              {replies.map(reply => (
                <Comment key={reply.id} comment={reply} depth={depth + 1} />
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

function PostDetail({ post, onVote, onBack }) {
  const comments = COMMUNITY_COMMENTS[post.id] || [];
  const [draft, setDraft] = useState('');
  const [anonymousComment, setAnonymousComment] = useState(false);
  return (
    <div className="cm-detail">
      <button type="button" className="cm-back-btn" onClick={onBack}>
        ← 목록으로
      </button>
      <article className="cm-post cm-post--detail">
        <div className="cm-post-body">
          <div className="cm-post-meta">
            <span className="cm-board-chip">{boardName(post.boardId)}</span>
            <span className="cm-dot">·</span>
            <span className="cm-post-author">{authorLabel(post)}</span>
            <span className="cm-dot">·</span>
            <span>{post.createdAt}</span>
            {post.place && (
              <>
                <span className="cm-bar">|</span>
                <span className="cm-meta-place">{post.place}</span>
              </>
            )}
          </div>
          <h2 className="cm-detail-title">{post.title}</h2>
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
            <span className="cm-post-action">
              <LineIcon name="share" /> 공유
            </span>
            <span className="cm-bar">|</span>
            <span className="cm-post-action">
              <LineIcon name="save" /> 저장
            </span>
            <span className="cm-bar">|</span>
            <span className="cm-post-action">
              <LineIcon name="report" /> 신고
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
              disabled={!draft.trim()}
              aria-label="댓글 등록"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M3.6 4.3 20.5 11.5c.7.3.7 1.3 0 1.6L3.6 20.3c-.7.3-1.4-.4-1.1-1.1l2.3-6.1c.1-.2.3-.4.6-.4l7.3-.6c.4 0 .4-.6 0-.6l-7.3-.6c-.3 0-.5-.2-.6-.4L2.5 5.4c-.3-.7.4-1.4 1.1-1.1z" />
              </svg>
            </button>
          </div>
        </div>

        {comments.length === 0 ? (
          <p className="cm-empty">아직 댓글이 없습니다. 첫 댓글을 남겨보세요.</p>
        ) : (
          <ul className="cm-comment-list">
            {comments.map(c => (
              <Comment key={c.id} comment={c} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** 글쓰기 — 모달이 아니라 커뮤니티 안의 전용 화면. */
function WritePage({ onCancel, onSubmit }) {
  const [boardId, setBoardId] = useState('gwangju-dong');
  const [title, setTitle] = useState('');
  const [place, setPlace] = useState('');
  const [body, setBody] = useState('');
  // 사진은 브라우저 안에서만 미리보기로 살아 있고 서버로 전송하지 않습니다.
  const [photos, setPhotos] = useState([]);
  const [photoMsg, setPhotoMsg] = useState('');
  const [dragging, setDragging] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const fileInputRef = useRef(null);
  const photosRef = useRef(photos);
  photosRef.current = photos;

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
    const room = PHOTO_MAX - photos.length;
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

  const canSubmit = title.trim() && body.trim();

  return (
    <div className="cm-write">
      <div className="cm-write-main">
        <button type="button" className="cm-back-btn" onClick={onCancel}>
          ← 목록으로
        </button>

        <div className="cm-write-board-row">
          <span className="cm-write-board-label">게시판</span>
          <Dropdown
            value={boardId}
            options={BOARD_OPTIONS}
            onChange={setBoardId}
            className="cm-dropdown--board"
            ariaLabel="게시판"
          />

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

        <input
          className="cm-write-place"
          value={place}
          onChange={e => setPlace(e.target.value)}
          placeholder="장소 추가 (선택)"
          aria-label="장소"
        />

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
              {photos.length}/{PHOTO_MAX}장
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
          {photos.length > 0 && (
            <ul className="cm-photo-grid">
              {photos.map((p, i) => (
                <li key={p.id} className="cm-photo">
                  <img src={p.url} alt="" />
                  {i === 0 && <span className="cm-photo-badge">대표</span>}
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
          <button type="button" className="cm-btn" onClick={onCancel}>
            취소
          </button>
          <button
            type="button"
            className="cm-btn cm-btn--primary"
            disabled={!canSubmit}
            onClick={() =>
              // 백엔드가 붙으면 여기서 photos를 업로드한 뒤 URL을 함께 보내면 됩니다.
              onSubmit({
                boardId,
                title,
                place,
                body,
                anonymous,
                photoCount: photos.length,
              })
            }
          >
            등록
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CommunityPage() {
  const [posts, setPosts] = useState(COMMUNITY_POSTS);
  const [activeBoard, setActiveBoard] = useState('all');
  const [sort, setSort] = useState('hot');
  const [query, setQuery] = useState('');
  // 상세 글은 URL(?post=)이 단일 소스 — 새로고침·뒤로가기·공유가 그대로 동작한다.
  const [searchParams, setSearchParams] = useSearchParams();
  const openPostId = Number(searchParams.get('post')) || null;

  const setOpenPostId = id => {
    const next = new URLSearchParams(searchParams);
    if (id == null) next.delete('post');
    else next.set('post', String(id));
    setSearchParams(next, { replace: true });
  };

  const [isWriteOpen, setIsWriteOpen] = useState(false);
  // 목록 → 상세로 갈 때 스크롤이 그대로 남지 않도록.
  // 돌아올 때는 보던 위치로 되돌린다.
  const listScrollY = useRef(0);

  const openPostDetail = id => {
    listScrollY.current = window.scrollY;
    setOpenPostId(id);
    window.scrollTo({ top: 0 });
  };

  const backToList = () => {
    setOpenPostId(null);
    // 목록이 다시 그려진 뒤에 위치를 복원
    requestAnimationFrame(() => {
      window.scrollTo({ top: listScrollY.current });
    });
  };

  const handleVote = (postId, myVote) => {
    setPosts(prev =>
      prev.map(p => (p.id === postId ? { ...p, myVote } : p)),
    );
  };

  const handleCreate = draft => {
    setPosts(prev => [
      {
        id: Date.now(),
        boardId: draft.boardId,
        title: draft.title.trim(),
        body: draft.body.trim(),
        place: draft.place.trim(),
        author: draft.anonymous ? '' : 'me',
        anonymous: Boolean(draft.anonymous),
        createdAt: '방금 전',
        photoCount: draft.photoCount || 0,
        votes: 1,
        comments: 0,
        myVote: 1,
      },
      ...prev,
    ]);
    setIsWriteOpen(false);
    setOpenPostId(null);
    setActiveBoard(draft.boardId);
    setSort('new');
  };

  const visiblePosts = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = posts.filter(p => {
      if (activeBoard !== 'all' && p.boardId !== activeBoard) return false;
      if (!q) return true;
      return (
        p.title.toLowerCase().includes(q) ||
        p.body.toLowerCase().includes(q) ||
        String(p.place || '').toLowerCase().includes(q)
      );
    });
    const sorted = [...filtered];
    if (sort === 'top') sorted.sort((a, b) => b.votes - a.votes);
    else if (sort === 'comments') sorted.sort((a, b) => b.comments - a.comments);
    else if (sort === 'hot')
      sorted.sort((a, b) => b.votes + b.comments * 2 - (a.votes + a.comments * 2));
    return sorted;
  }, [posts, activeBoard, sort, query]);

  // ── 무한 스크롤 ──────────────────────────────────────────────
  // 서버 페이징이 붙기 전까지는 목록을 잘라서 보여주고, 바닥이 보이면 더 잇는다.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef(null);

  // 조건이 바뀌면 처음부터 다시
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [activeBoard, sort, query]);

  const shownPosts = visiblePosts.slice(0, visibleCount);
  const hasMore = visibleCount < visiblePosts.length;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return undefined;
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting) {
          setVisibleCount(c => c + PAGE_SIZE);
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, visiblePosts.length]);

  const openPost = posts.find(p => p.id === openPostId) || null;

  // 글쓰기는 목록/상세를 덮는 전용 화면
  if (isWriteOpen) {
    return (
      <WritePage
        onCancel={() => {
          setIsWriteOpen(false);
          requestAnimationFrame(() => {
            window.scrollTo({ top: listScrollY.current });
          });
        }}
        onSubmit={handleCreate}
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
                  setOpenPostId(null);
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
        {openPost ? (
          <PostDetail
            post={openPost}
            onVote={handleVote}
            onBack={backToList}
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
              setIsWriteOpen(true);
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

            {visiblePosts.length === 0 ? (
              <p className="cm-empty">아직 글이 없습니다. 첫 글을 남겨보세요.</p>
            ) : (
              <>
                <div className="cm-post-list">
                  {shownPosts.map(post => (
                    <PostCard
                      key={post.id}
                      post={post}
                      onVote={handleVote}
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
      </section>

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
              <span>작성글</span>
            </div>
            <div>
              <strong>3,482</strong>
              <span>멤버</span>
            </div>
          </div>
          <button
            type="button"
            className="cm-btn cm-btn--primary cm-btn--block"
            onClick={() => {
              listScrollY.current = window.scrollY;
              setIsWriteOpen(true);
              window.scrollTo({ top: 0 });
            }}
          >
            글 쓰기
          </button>
        </div>

        <div className="cm-card">
          <p className="cm-card-title">지금 많이 찾는 장소</p>
          <ul className="cm-trend-list">
            {COMMUNITY_TRENDING.map((t, i) => (
              <li key={t.id}>
                <span className="cm-trend-rank">{i + 1}</span>
                <span className="cm-trend-label">{t.label}</span>
                <span className="cm-trend-count">{t.count}</span>
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
