import { useMemo, useState, useEffect, useRef } from 'react';

import { resolveBackendMediaUrl } from '../utils/apiMediaUrl';
import {
  CARD_PLACEHOLDER_SVG,
  displayImageSrc,
} from '../utils/placeholderImage';
import {
  inferRegionHintsFromTripName,
  searchPlacesForTrip,
} from '../utils/tripPlaceSearch';
import Avatar from '../components/ui/Avatar';
import LineIcon from '../components/ui/LineIcon';
import {
  COMMUNITY_BOARDS,
  COMMUNITY_MY_COMMENTS,
  COMMUNITY_MY_POSTS,
  COMMUNITY_SAVED_POSTS,
} from '../data/communityMock';

const boardName = id =>
  COMMUNITY_BOARDS.find(b => b.id === id)?.name || '전체';

export default function MyPage({
  scrappedRegions = [],
  myTrips = [],
  onCreateTrip,
  onDeleteTrip,
  onRenameTrip,
  onReorderTripPlaces,
  onAddPlaceToTrip,
  onRemovePlaceFromTrip,
  onToggleScrap,
  onOpenRegion,
  onGoCommunity,
  currentUser = null,
  regionMap = null,
  regions = [],
  isLoggedIn = false,
}) {
  const [tab, setTab] = useState('scraps');
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [newTripName, setNewTripName] = useState('');
  const [showNewTripForm, setShowNewTripForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreatingTrip, setIsCreatingTrip] = useState(false);
  // 일정 카드는 기본 읽기 전용, 수정하기를 눌러야 장소 추가·삭제가 열립니다.
  const [editingTripId, setEditingTripId] = useState(null);
  const [menuTripId, setMenuTripId] = useState(null);
  const [editingName, setEditingName] = useState('');
  // 드래그로 순서 바꾸기 (수정 모드에서만)
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [hoverPlaceKey, setHoverPlaceKey] = useState(null);
  const menuRef = useRef(null);

  // 케밥 메뉴 바깥 클릭 시 닫기
  useEffect(() => {
    if (menuTripId == null) return undefined;
    const handler = e => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuTripId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuTripId]);

  const handleCreateTrip = async e => {
    e.preventDefault();
    if (isCreatingTrip) return;
    const name = newTripName.trim();
    if (!name) return;
    if (!isLoggedIn) {
      window.alert('여행 일정은 로그인 후 저장됩니다.');
      return;
    }
    setIsCreatingTrip(true);
    try {
      const newTrip = await onCreateTrip?.(name);
      if (!newTrip) return;
      setNewTripName('');
      setShowNewTripForm(false);
      setSelectedTrip(newTrip.id);
    } catch {
      window.alert('여행 만들기에 실패했습니다.');
    } finally {
      setIsCreatingTrip(false);
    }
  };

  const handleDropPlace = async (trip, toIndex) => {
    const from = dragIndex;
    setDragIndex(null);
    setDragOverIndex(null);
    if (from == null || from === toIndex) return;
    const next = [...trip.places];
    const [moved] = next.splice(from, 1);
    next.splice(toIndex, 0, moved);
    try {
      await onReorderTripPlaces?.(
        trip.id,
        next.map(p => p.id),
      );
    } catch {
      window.alert('순서 변경에 실패했습니다.');
    }
  };

  const handleSaveTripName = async (tripId, originalName) => {
    const name = editingName.trim();
    if (!name || name === originalName) return;
    try {
      await onRenameTrip?.(tripId, name);
    } catch {
      window.alert('여행 이름 변경에 실패했습니다.');
      setEditingName(originalName);
    }
  };

  const handleDeleteTrip = async tripId => {
    if (!window.confirm('이 여행을 삭제할까요?')) return;
    try {
      await onDeleteTrip?.(tripId);
      if (selectedTrip === tripId) setSelectedTrip(null);
    } catch {
      window.alert('여행 삭제에 실패했습니다.');
    }
  };

  const handleRemovePlaceFromTrip = async (tripId, placeId) => {
    try {
      await onRemovePlaceFromTrip?.(tripId, placeId);
    } catch {
      window.alert('장소 제거에 실패했습니다.');
    }
  };

  const handleAddPlaceToTrip = async (tripId, place) => {
    try {
      await onAddPlaceToTrip?.(tripId, place);
    } catch {
      window.alert('장소 추가에 실패했습니다.');
    }
  };

  const currentTrip = myTrips.find(t => t.id === selectedTrip);

  useEffect(() => {
    setSearchQuery('');
  }, [selectedTrip]);

  useEffect(() => {
    if (myTrips.length > 0 && !myTrips.some(trip => trip.id === selectedTrip)) {
      setSelectedTrip(myTrips[0].id);
    }
  }, [myTrips, selectedTrip]);

  const catalogRegions = useMemo(() => {
    if (regionMap?.size) {
      return [...regionMap.values()];
    }
    return regions;
  }, [regionMap, regions]);

  const tripRegionHints = useMemo(
    () => inferRegionHintsFromTripName(currentTrip?.name),
    [currentTrip?.name],
  );

  const filteredRegions = useMemo(
    () =>
      searchPlacesForTrip(catalogRegions, {
        query: searchQuery,
        tripName: currentTrip?.name,
        limit: 12,
      }),
    [catalogRegions, searchQuery, currentTrip?.name],
  );

  const searchQueryTrimmed = searchQuery.trim();

  return (
    <section className="mypage-page-content" style={{ width: '100%' }}>
      {/* 프로필 헤더 */}
      <header className="mypage-profile">
        <Avatar
          src={currentUser?.picture}
          name={currentUser?.name}
          className="mypage-profile-avatar"
          fallbackClassName="mypage-profile-avatar--fallback"
        />
        <div className="mypage-profile-text">
          <h2 className="mypage-profile-name">
            {currentUser?.name || (isLoggedIn ? '사용자' : '로그인이 필요해요')}
          </h2>
          <p className="mypage-profile-email">
            {currentUser?.email || '로그인하면 스크랩·일정이 저장됩니다.'}
          </p>
        </div>
        <dl className="mypage-profile-stats">
          <div>
            <dt>스크랩</dt>
            <dd>{scrappedRegions.length}</dd>
          </div>
          <div>
            <dt>일정</dt>
            <dd>{myTrips.length}</dd>
          </div>
          <div>
            <dt>작성글</dt>
            <dd>{COMMUNITY_MY_POSTS.length}</dd>
          </div>
          <div>
            <dt>저장글</dt>
            <dd>{COMMUNITY_SAVED_POSTS.length}</dd>
          </div>
          <div>
            <dt>댓글</dt>
            <dd>{COMMUNITY_MY_COMMENTS.length}</dd>
          </div>
        </dl>
      </header>

      {/* 탭 */}
      <div className="app-tabs" style={{ marginTop: 16 }}>
        <button
          className={`app-tab${tab === 'scraps' ? ' active' : ''}`}
          onClick={() => setTab('scraps')}
          type="button"
        >
          <LineIcon name="heart" className="app-tab-icon" /> 스크랩한 장소
        </button>
        <button
          className={`app-tab${tab === 'trips' ? ' active' : ''}`}
          onClick={() => setTab('trips')}
          type="button"
        >
          <LineIcon name="plane" className="app-tab-icon" /> 여행 일정
        </button>
        <button
          className={`app-tab${tab === 'posts' ? ' active' : ''}`}
          onClick={() => setTab('posts')}
          type="button"
        >
          <LineIcon name="pencil" className="app-tab-icon" /> 작성글
        </button>
        <button
          className={`app-tab${tab === 'saved' ? ' active' : ''}`}
          onClick={() => setTab('saved')}
          type="button"
        >
          <LineIcon name="save" className="app-tab-icon" /> 저장한 글
        </button>
        <button
          className={`app-tab${tab === 'comments' ? ' active' : ''}`}
          onClick={() => setTab('comments')}
          type="button"
        >
          <LineIcon name="comment" className="app-tab-icon" /> 작성 댓글
        </button>
      </div>

      {/* ── 저장한 글 탭 ── */}
      {tab === 'saved' && (
        !isLoggedIn ? (
          <div className="mypage-empty">
            <p>저장한 글은 로그인 후 확인할 수 있어요.</p>
          </div>
        ) : COMMUNITY_SAVED_POSTS.length === 0 ? (
          <div className="mypage-empty">
            <p style={{ margin: 0 }}>아직 저장한 글이 없어요.</p>
            <p style={{ margin: '6px 0 0', fontSize: 12, color: '#aaa' }}>
              커뮤니티 글에서 저장을 누르면 여기에 모여요.
            </p>
          </div>
        ) : (
          <ul className="mypage-activity-list">
            {COMMUNITY_SAVED_POSTS.map(post => (
              <li key={post.id}>
                <button
                  type="button"
                  className="mypage-activity"
                  onClick={() => onGoCommunity?.(post.id)}
                >
                  <div className="mypage-activity-meta">
                    <span className="mypage-activity-board">
                      {boardName(post.boardId)}
                    </span>
                    <span className="mypage-activity-sep">·</span>
                    <span>u/{post.author}</span>
                    <span className="mypage-activity-sep">·</span>
                    <span>{post.createdAt}</span>
                    <span className="mypage-activity-tag">{post.savedAt}</span>
                  </div>
                  <p className="mypage-activity-title">{post.title}</p>
                  <p className="mypage-activity-body">{post.body}</p>
                  <div className="mypage-activity-stats">
                    <span>▲ {post.votes}</span>
                    <span className="mypage-activity-sep">|</span>
                    <span>댓글 {post.comments}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      {/* ── 작성글 탭 ── */}
      {tab === 'posts' && (
        !isLoggedIn ? (
          <div className="mypage-empty">
            <p>작성한 글은 로그인 후 확인할 수 있어요.</p>
          </div>
        ) : COMMUNITY_MY_POSTS.length === 0 ? (
          <div className="mypage-empty">
            <p style={{ margin: 0 }}>아직 작성한 글이 없어요.</p>
            <p style={{ margin: '6px 0 0', fontSize: 12, color: '#aaa' }}>
              커뮤니티에서 다녀온 장소를 공유해보세요.
            </p>
          </div>
        ) : (
          <ul className="mypage-activity-list">
            {COMMUNITY_MY_POSTS.map(post => (
              <li key={post.id}>
                <button
                  type="button"
                  className="mypage-activity"
                  onClick={() => onGoCommunity?.(post.id)}
                >
                  <div className="mypage-activity-meta">
                    <span className="mypage-activity-board">
                      {boardName(post.boardId)}
                    </span>
                    <span className="mypage-activity-sep">·</span>
                    <span>{post.createdAt}</span>
                    {post.place && (
                      <>
                        <span className="mypage-activity-sep">|</span>
                        <span>{post.place}</span>
                      </>
                    )}
                    {post.anonymous && (
                      <span className="mypage-activity-tag">익명</span>
                    )}
                  </div>
                  <p className="mypage-activity-title">{post.title}</p>
                  <p className="mypage-activity-body">{post.body}</p>
                  <div className="mypage-activity-stats">
                    <span>▲ {post.votes}</span>
                    <span className="mypage-activity-sep">|</span>
                    <span>댓글 {post.comments}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      {/* ── 작성 댓글 탭 ── */}
      {tab === 'comments' && (
        !isLoggedIn ? (
          <div className="mypage-empty">
            <p>작성한 댓글은 로그인 후 확인할 수 있어요.</p>
          </div>
        ) : COMMUNITY_MY_COMMENTS.length === 0 ? (
          <div className="mypage-empty">
            <p style={{ margin: 0 }}>아직 작성한 댓글이 없어요.</p>
          </div>
        ) : (
          <ul className="mypage-activity-list">
            {COMMUNITY_MY_COMMENTS.map(comment => (
              <li key={comment.id}>
                <button
                  type="button"
                  className="mypage-activity"
                  onClick={() => onGoCommunity?.(comment.postId)}
                >
                  <div className="mypage-activity-meta">
                    <span>{comment.createdAt}</span>
                    {comment.anonymous && (
                      <span className="mypage-activity-tag">익명</span>
                    )}
                  </div>
                  <p className="mypage-activity-body mypage-activity-comment">
                    {comment.body}
                  </p>
                  <p className="mypage-activity-origin">
                    원글 · {comment.postTitle}
                  </p>
                  <div className="mypage-activity-stats">
                    <span>▲ {comment.votes}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      {/* ── 스크랩 탭 ── */}
      {tab === 'scraps' && (
        <>
          {!isLoggedIn ? (
            <div className="mypage-empty">
              <p>스크랩한 장소는 로그인 후 저장됩니다.</p>
              <p style={{ fontSize: 13, color: '#888' }}>
                갤러리에서 ♥를 누르면 마이페이지에 모여요.
              </p>
            </div>
          ) : scrappedRegions.length === 0 ? (
            <div className="mypage-empty">
              <p style={{ fontSize: 32, margin: '0 0 12px' }}>♡</p>
              <p style={{ margin: 0 }}>아직 스크랩한 장소가 없어요.</p>
              <p style={{ margin: '6px 0 0', fontSize: 12, color: '#aaa' }}>
                갤러리에서 마음에 드는 장소를 하트로 저장해보세요.
              </p>
            </div>
          ) : (
            // 갤러리와 같은 폭·카드 구조
            <section className="gallery-scroll-area" style={{ marginTop: 20 }}>
              <div className="region-grid">
                {scrappedRegions.map(region => (
                  <article key={region.id} className="region-card">
                    <div
                      className="region-preview"
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpenRegion?.(region)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onOpenRegion?.(region);
                        }
                      }}
                    >
                      <button
                        type="button"
                        className="card-heart-btn active"
                        onClick={e => {
                          e.stopPropagation();
                          onToggleScrap?.(region.id);
                        }}
                        aria-label="스크랩 해제"
                      >
                        ♥
                      </button>
                      <img
                        src={displayImageSrc(
                          region.imageUrl,
                          resolveBackendMediaUrl,
                        )}
                        alt={region.name}
                        className="region-image"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={e => {
                          e.currentTarget.onerror = null;
                          e.currentTarget.src = CARD_PLACEHOLDER_SVG;
                        }}
                      />
                    </div>
                    <div className="region-card-content">
                      {(region.address || region.region) && (
                        <span className="region-card-place">
                          {region.address || region.region}
                        </span>
                      )}
                      <span className="region-card-name">{region.name}</span>
                      <p className="region-card-summary">
                        {String(region.summary || '').trim() ||
                          '광주·전남 추천 스팟 정보를 확인해보세요.'}
                      </p>
                      <button
                        type="button"
                        className="region-card-read-more"
                        onClick={() => onOpenRegion?.(region)}
                      >
                        Read More
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* ── 여행 일정 탭 ── */}
      {tab === 'trips' && (
        <div className="mypage-trips-content">
          {!isLoggedIn ? (
            <div className="mypage-empty">
              <p>여행 일정은 로그인 후 저장됩니다.</p>
              <p style={{ fontSize: 13, color: '#888' }}>
                갤러리에서 여행에 담거나, 여기서 새 여행을 만들 수 있어요.
              </p>
            </div>
          ) : myTrips.length === 0 ? (
            <div className="mypage-empty">
              <p style={{ fontSize: 32, margin: '0 0 12px' }}>✈</p>
              <p style={{ margin: 0 }}>아직 만든 여행이 없어요.</p>
              <p style={{ margin: '6px 0 0', fontSize: 12, color: '#aaa' }}>
                새 여행을 만들고 원하는 장소를 추가해보세요.
              </p>
              <button
                type="button"
                className="mypage-create-btn mypage-create-btn--empty"
                onClick={() => setShowNewTripForm(v => !v)}
              >
                + 새 여행 만들기
              </button>
            </div>
          ) : (
            <div className="mypage-trip-list-layout">
              {/* 선택된 여행 상세 */}
              {myTrips.map(trip => {
                const currentTrip = trip;
                return (
                  <div
                    key={trip.id}
                    style={{
                      border: '1px solid #e5e5e5',
                      borderRadius: 12,
                      padding: 20,
                      background: '#fff',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        marginBottom: 16,
                      }}
                    >
                      {editingTripId === currentTrip.id ? (
                        <input
                          className="mypage-trip-name-input"
                          value={editingName}
                          onChange={e => setEditingName(e.target.value)}
                          onBlur={() =>
                            handleSaveTripName(currentTrip.id, currentTrip.name)
                          }
                          onKeyDown={e => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                            if (e.key === 'Escape') {
                              setEditingName(currentTrip.name);
                              e.currentTarget.blur();
                            }
                          }}
                          maxLength={255}
                          aria-label="여행 이름"
                        />
                      ) : (
                        <h3
                          style={{
                            margin: 0,
                            fontSize: 18,
                            fontWeight: 800,
                            color: '#111',
                          }}
                        >
                          {currentTrip.name}
                        </h3>
                      )}
                      <div
                        className="mypage-trip-menu"
                        ref={menuTripId === currentTrip.id ? menuRef : null}
                      >
                        <button
                          type="button"
                          className="mypage-trip-menu-btn"
                          onClick={() =>
                            setMenuTripId(id =>
                              id === currentTrip.id ? null : currentTrip.id,
                            )
                          }
                          title="여행 메뉴"
                          aria-label="여행 메뉴"
                        >
                          ⋯
                        </button>
                        {menuTripId === currentTrip.id && (
                          <div className="mypage-trip-menu-list">
                            <button
                              type="button"
                              className="mypage-trip-menu-item"
                              onClick={() => {
                                setEditingTripId(currentTrip.id);
                                setEditingName(currentTrip.name);
                                setMenuTripId(null);
                              }}
                            >
                              수정하기
                            </button>
                            <button
                              type="button"
                              className="mypage-trip-menu-item mypage-trip-menu-item--danger"
                              onClick={() => {
                                setMenuTripId(null);
                                handleDeleteTrip(currentTrip.id);
                              }}
                            >
                              삭제하기
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 담긴 장소 */}
                    {currentTrip.places.length === 0 ? (
                      <div
                        style={{
                          textAlign: 'center',
                          padding: '24px 0',
                          color: '#aaa',
                          fontSize: 14,
                        }}
                      >
                        <p style={{ margin: '0 0 4px' }}>
                          아직 담긴 장소가 없어요.
                        </p>
                        <p style={{ margin: 0, fontSize: 12 }}>
                          {editingTripId === currentTrip.id
                            ? '아래 검색으로 장소를 추가해보세요.'
                            : '⋯ 메뉴의 수정하기로 장소를 추가할 수 있어요.'}
                        </p>
                      </div>
                    ) : (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                          marginBottom: 20,
                        }}
                      >
                        {currentTrip.places.map((place, idx) => {
                          const editing = editingTripId === currentTrip.id;
                          return (
                          <div
                            key={place.id}
                            role={editing ? undefined : 'button'}
                            tabIndex={editing ? undefined : 0}
                            onClick={
                              editing ? undefined : () => onOpenRegion?.(place)
                            }
                            onKeyDown={
                              editing
                                ? undefined
                                : e => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      onOpenRegion?.(place);
                                    }
                                  }
                            }
                            onMouseEnter={() =>
                              setHoverPlaceKey(`${currentTrip.id}-${place.id}`)
                            }
                            onMouseLeave={() => setHoverPlaceKey(null)}
                            draggable={editing}
                            onDragStart={
                              editing ? () => setDragIndex(idx) : undefined
                            }
                            onDragOver={
                              editing
                                ? e => {
                                    e.preventDefault();
                                    setDragOverIndex(idx);
                                  }
                                : undefined
                            }
                            onDragLeave={
                              editing
                                ? () =>
                                    setDragOverIndex(i => (i === idx ? null : i))
                                : undefined
                            }
                            onDrop={
                              editing
                                ? e => {
                                    e.preventDefault();
                                    handleDropPlace(currentTrip, idx);
                                  }
                                : undefined
                            }
                            onDragEnd={
                              editing
                                ? () => {
                                    setDragIndex(null);
                                    setDragOverIndex(null);
                                  }
                                : undefined
                            }
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              padding: '10px 12px',
                              background:
                                hoverPlaceKey === `${currentTrip.id}-${place.id}`
                                  ? '#f0f0f0'
                                  : '#f8f8f8',
                              borderRadius: 8,
                              border: '1px solid',
                              borderColor:
                                hoverPlaceKey === `${currentTrip.id}-${place.id}`
                                  ? '#ddd'
                                  : '#eee',
                              cursor: editing ? 'grab' : 'pointer',
                              opacity: editing && dragIndex === idx ? 0.45 : 1,
                              borderTopColor:
                                editing &&
                                dragOverIndex === idx &&
                                dragIndex !== idx
                                  ? '#111'
                                  : '#eee',
                              transition:
                                'background 150ms ease, border-color 150ms ease',
                            }}
                          >
                            {editing && (
                              <span
                                aria-hidden="true"
                                style={{
                                  fontSize: 13,
                                  color: '#bbb',
                                  cursor: 'grab',
                                  lineHeight: 1,
                                }}
                              >
                                ⠿
                              </span>
                            )}
                            <span
                              style={{
                                fontSize: 12,
                                color: '#aaa',
                                fontWeight: 700,
                                minWidth: 20,
                              }}
                            >
                              {idx + 1}
                            </span>
                            <img
                              src={displayImageSrc(
                                place.imageUrl,
                                resolveBackendMediaUrl,
                              )}
                              alt={place.name}
                              style={{
                                width: 44,
                                height: 44,
                                borderRadius: 6,
                                objectFit: 'cover',
                                flexShrink: 0,
                              }}
                              onError={e => {
                                e.currentTarget.src = CARD_PLACEHOLDER_SVG;
                              }}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: 13,
                                  fontWeight: 700,
                                  color: '#111',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {place.name}
                              </div>
                              <div
                                style={{
                                  fontSize: 11,
                                  color: '#888',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {place.region || place.address || ''}
                              </div>
                            </div>
                            {editingTripId === currentTrip.id && (
                              <button
                                type="button"
                                onClick={e => {
                                  e.stopPropagation();
                                  handleRemovePlaceFromTrip(
                                    currentTrip.id,
                                    place.id,
                                  );
                                }}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  cursor: 'pointer',
                                  color: '#ccc',
                                  fontSize: 14,
                                  padding: 2,
                                  flexShrink: 0,
                                }}
                                aria-label="장소 빼기"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                          );
                        })}
                      </div>
                    )}

                    {/* 장소 추가 검색 — 수정하기를 누른 일정에서만 */}
                    {editingTripId === currentTrip.id && (
                    <div
                      style={{ borderTop: '1px solid #f0f0f0', paddingTop: 16 }}
                    >
                      <h4
                        style={{
                          margin: '0 0 10px',
                          fontSize: 13,
                          fontWeight: 700,
                          color: '#555',
                        }}
                      >
                        장소 추가
                      </h4>
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="장소 이름 또는 지역 검색..."
                        style={{
                          width: '100%',
                          height: 38,
                          border: '1px solid #e5e5e5',
                          borderRadius: 8,
                          padding: '0 12px',
                          fontSize: 13,
                          outline: 'none',
                          fontFamily: 'inherit',
                          boxSizing: 'border-box',
                        }}
                      />
                      {!searchQueryTrimmed && tripRegionHints.length > 0 ? (
                        <p
                          style={{
                            margin: '8px 0 0',
                            fontSize: 12,
                            color: '#888',
                          }}
                        >
                          「{tripRegionHints[0]}」 여행에 맞는 장소를
                          보여드려요. 다른 지역은 검색해 주세요.
                        </p>
                      ) : null}
                      {searchQueryTrimmed && filteredRegions.length === 0 ? (
                        <p
                          style={{
                            margin: '10px 0 0',
                            fontSize: 12,
                            color: '#aaa',
                          }}
                        >
                          검색 결과가 없어요.
                        </p>
                      ) : null}
                      {!searchQueryTrimmed &&
                      tripRegionHints.length > 0 &&
                      filteredRegions.length === 0 ? (
                        <p
                          style={{
                            margin: '10px 0 0',
                            fontSize: 12,
                            color: '#aaa',
                          }}
                        >
                          이 지역 장소 데이터가 아직 없어요. 검색으로 다른
                          이름을 찾아보세요.
                        </p>
                      ) : null}
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                          marginTop: 10,
                          maxHeight: 240,
                          overflowY: 'auto',
                        }}
                      >
                        {filteredRegions.map(place => {
                          const alreadyIn = currentTrip.places.some(
                            p => p.id === place.id,
                          );
                          return (
                            <div
                              key={place.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                padding: '8px 10px',
                                borderRadius: 7,
                                border: '1px solid #eee',
                                background: '#fafafa',
                              }}
                            >
                              <img
                                src={displayImageSrc(
                                  place.imageUrl,
                                  resolveBackendMediaUrl,
                                )}
                                alt={place.name}
                                style={{
                                  width: 36,
                                  height: 36,
                                  borderRadius: 5,
                                  objectFit: 'cover',
                                  flexShrink: 0,
                                }}
                                onError={e => {
                                  e.currentTarget.src = CARD_PLACEHOLDER_SVG;
                                }}
                              />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div
                                  style={{
                                    fontSize: 13,
                                    fontWeight: 600,
                                    color: '#111',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {place.name}
                                </div>
                                <div style={{ fontSize: 11, color: '#888' }}>
                                  {place.region || ''}
                                </div>
                              </div>
                              <button
                                type="button"
                                disabled={alreadyIn}
                                onClick={() =>
                                  handleAddPlaceToTrip(currentTrip.id, place)
                                }
                                style={{
                                  padding: '4px 10px',
                                  fontSize: 11,
                                  fontWeight: 600,
                                  background: alreadyIn ? '#f0f0f0' : '#111',
                                  color: alreadyIn ? '#aaa' : '#fff',
                                  border: 'none',
                                  borderRadius: 6,
                                  cursor: alreadyIn ? 'default' : 'pointer',
                                  fontFamily: 'inherit',
                                  flexShrink: 0,
                                }}
                              >
                                {alreadyIn ? '추가됨' : '+ 추가'}
                              </button>
                            </div>
                          );
                        })}
                      </div>

                      <div className="mypage-edit-done-row">
                        <button
                          type="button"
                          className="mypage-edit-done"
                          onClick={async () => {
                            await handleSaveTripName(
                              currentTrip.id,
                              currentTrip.name,
                            );
                            setEditingTripId(null);
                          }}
                        >
                          저장하기
                        </button>
                      </div>
                    </div>
                    )}
                  </div>
                );
              })}
              <div className="mypage-add-trip-area">
                <button
                  type="button"
                  className="mypage-create-btn"
                  onClick={() => setShowNewTripForm(v => !v)}
                >
                  + 새 여행 만들기
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {showNewTripForm && (
        <div
          className="mypage-trip-create-backdrop"
          role="presentation"
          onClick={() => setShowNewTripForm(false)}
        >
          <form
            className="mypage-trip-create-modal"
            onSubmit={handleCreateTrip}
            onClick={event => event.stopPropagation()}
          >
            <div className="mypage-trip-create-modal-header">
              <h2>새 여행 만들기</h2>
              <button
                type="button"
                aria-label="닫기"
                onClick={() => setShowNewTripForm(false)}
              >
                ×
              </button>
            </div>
            <label htmlFor="new-trip-name">여행 이름</label>
            <input
              id="new-trip-name"
              type="text"
              value={newTripName}
              onChange={e => setNewTripName(e.target.value)}
              placeholder="예: 여수 주말 여행"
              autoFocus
            />
            <div className="mypage-trip-create-modal-actions">
              <button type="button" onClick={() => setShowNewTripForm(false)}>
                취소
              </button>
              <button type="submit" disabled={isCreatingTrip}>
                {isCreatingTrip ? '만드는 중...' : '만들기'}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
