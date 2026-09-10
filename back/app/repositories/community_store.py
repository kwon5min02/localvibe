"""COMMUNITY_* — 커뮤니티 글·댓글·투표·저장.

게시판(board_id)은 테이블이 아니라 app/modules/community/boards.py 상수로 관리합니다.
글·댓글 삭제는 soft delete(deleted_at) — 댓글이 달린 글이 통째로 사라지지 않게 합니다.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    delete,
    func,
    literal,
    or_,
    select,
    tuple_,
    union_all,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.repositories import places_store  # noqa: F401  (place_id FK 대상 테이블 등록)
from app.repositories import users_store  # noqa: F401  (user_id FK 대상 테이블 등록)
from app.repositories.db import Base


class CommunityPost(Base):
    __tablename__ = "community_posts"
    __table_args__ = (
        Index("ix_community_posts_board_created", "board_id", "created_at"),
        Index("ix_community_posts_user_created", "user_id", "created_at"),
    )

    post_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False, index=True
    )
    board_id: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # 갤러리에 있는 장소면 place_id, 아니면 이름만 남깁니다.
    place_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    place_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("places.place_id", ondelete="SET NULL"), nullable=True
    )
    is_anonymous: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # 정렬을 위해 비정규화 — 투표·댓글이 바뀔 때 함께 갱신합니다.
    votes_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    comments_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    views_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    comments: Mapped[list["CommunityComment"]] = relationship(
        "CommunityComment", back_populates="post", cascade="all, delete-orphan"
    )


class CommunityComment(Base):
    __tablename__ = "community_comments"
    __table_args__ = (Index("ix_community_comments_post_created", "post_id", "created_at"),)

    comment_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    post_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("community_posts.post_id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False, index=True
    )
    parent_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("community_comments.comment_id", ondelete="CASCADE"), nullable=True
    )
    body: Mapped[str] = mapped_column(String(500), nullable=False)
    is_anonymous: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    likes_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    post: Mapped[CommunityPost] = relationship("CommunityPost", back_populates="comments")


class CommunityPostImage(Base):
    """글에 첨부된 사진. 파일은 back/static/community/ 아래에 있습니다."""

    __tablename__ = "community_post_images"
    __table_args__ = (Index("ix_community_post_images_post", "post_id", "sort_order"),)

    image_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    post_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("community_posts.post_id", ondelete="CASCADE"), nullable=False
    )
    url: Mapped[str] = mapped_column(String(512), nullable=False)
    thumb_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class CommunityPostView(Base):
    """조회 중복 제거용. 로그인 사용자는 user_id, 비로그인은 브라우저 세션 키로 구분합니다."""

    __tablename__ = "community_post_views"
    __table_args__ = (
        UniqueConstraint("post_id", "viewer_key", name="uq_community_post_views"),
    )

    view_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    post_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("community_posts.post_id", ondelete="CASCADE"), nullable=False, index=True
    )
    viewer_key: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class CommunityCommentLike(Base):
    """댓글 따봉 — 글 투표와 달리 올리기만 있고 내리기는 없습니다."""

    __tablename__ = "community_comment_likes"
    __table_args__ = (
        UniqueConstraint("user_id", "comment_id", name="uq_community_comment_likes"),
    )

    like_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False, index=True
    )
    comment_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("community_comments.comment_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class CommunityVote(Base):
    __tablename__ = "community_votes"
    __table_args__ = (UniqueConstraint("user_id", "post_id", name="uq_community_votes_user_post"),)

    vote_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False, index=True
    )
    post_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("community_posts.post_id", ondelete="CASCADE"), nullable=False, index=True
    )
    value: Mapped[int] = mapped_column(SmallInteger, nullable=False)


class CommunitySave(Base):
    __tablename__ = "community_saves"
    __table_args__ = (UniqueConstraint("user_id", "post_id", name="uq_community_saves_user_post"),)

    save_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False, index=True
    )
    post_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("community_posts.post_id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


# ── 글 ────────────────────────────────────────────────────────────────────────

def get_post(session, post_id: int, *, include_deleted: bool = False) -> CommunityPost | None:
    stmt = select(CommunityPost).where(CommunityPost.post_id == post_id)
    if not include_deleted:
        stmt = stmt.where(CommunityPost.deleted_at.is_(None))
    return session.execute(stmt).scalar_one_or_none()


def create_post(
    session,
    *,
    user_id: int,
    board_id: str,
    title: str,
    body: str,
    place_name: str | None = None,
    place_id: int | None = None,
    is_anonymous: bool = False,
) -> CommunityPost:
    now = datetime.utcnow()
    post = CommunityPost(
        user_id=user_id,
        board_id=board_id,
        title=title.strip()[:255],
        body=body.strip(),
        place_name=(place_name or "").strip()[:255] or None,
        place_id=place_id,
        is_anonymous=bool(is_anonymous),
        votes_count=0,
        comments_count=0,
        created_at=now,
        updated_at=now,
    )
    session.add(post)
    session.flush()
    return post


def update_post(session, post: CommunityPost, **fields) -> CommunityPost:
    for key in ("board_id", "title", "body", "place_name", "place_id", "is_anonymous"):
        if key in fields and fields[key] is not None:
            value = fields[key]
            if key in ("title", "place_name"):
                value = str(value).strip()[:255] or None
            elif key == "body":
                value = str(value).strip()
            elif key == "is_anonymous":
                value = bool(value)
            setattr(post, key, value)
    post.updated_at = datetime.utcnow()
    session.flush()
    return post


def soft_delete_post(session, post: CommunityPost) -> None:
    post.deleted_at = datetime.utcnow()
    session.flush()


def record_view(session, *, post: CommunityPost, viewer_key: str) -> int:
    """같은 사람이 여러 번 봐도 한 번만 센다. 갱신된 조회수를 반환."""
    key = str(viewer_key or "").strip()[:80]
    if not key:
        return int(post.views_count or 0)
    try:
        with session.begin_nested():
            session.add(
                CommunityPostView(
                    post_id=int(post.post_id),
                    viewer_key=key,
                    created_at=datetime.utcnow(),
                )
            )
            session.flush()
    except IntegrityError:
        return int(post.views_count or 0)  # 이미 본 글

    post.views_count = int(post.views_count or 0) + 1
    session.flush()
    return int(post.views_count)


def list_posts(
    session,
    *,
    board_id: str | None = None,
    place_id: int | None = None,
    sort: str = "hot",
    query: str | None = None,
    cursor: str | None = None,
    limit: int = 20,
) -> tuple[list[CommunityPost], str | None]:
    """목록 한 페이지와 다음 커서를 반환합니다.

    커서는 마지막 글의 post_id 하나이고, 정렬 점수는 DB가 다시 계산합니다.
    점수를 Python에서 만들어 넘기면 시간대·반올림 차이로 비교가 어긋납니다.
    OFFSET은 글이 늘수록 느려지고 페이지 사이에 글이 추가되면 중복·누락이 생깁니다.
    """
    stmt = select(CommunityPost).where(CommunityPost.deleted_at.is_(None))

    if board_id:
        stmt = stmt.where(CommunityPost.board_id == board_id)

    # 장소 상세에서 "이 장소 글"만 볼 때 쓴다. 자유 입력한 장소명은 걸리지 않는다.
    if place_id:
        stmt = stmt.where(CommunityPost.place_id == place_id)

    q = (query or "").strip()
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                CommunityPost.title.like(like),
                CommunityPost.body.like(like),
                CommunityPost.place_name.like(like),
            )
        )

    order_value = _order_value(sort)
    stmt = stmt.order_by(order_value.desc(), CommunityPost.post_id.desc())

    last_id = _parse_cursor(cursor)
    if last_id is not None:
        # 커서 글의 정렬 점수를 DB에서 그대로 다시 구해 비교한다.
        cursor_value = (
            select(order_value)
            .where(CommunityPost.post_id == last_id)
            .scalar_subquery()
        )
        stmt = stmt.where(
            or_(
                order_value < cursor_value,
                (order_value == cursor_value) & (CommunityPost.post_id < last_id),
            )
        )

    rows = list(session.execute(stmt.limit(limit + 1)).scalars().all())
    has_more = len(rows) > limit
    page = rows[:limit]

    next_cursor = str(page[-1].post_id) if has_more and page else None
    return page, next_cursor


def _order_value(sort: str):
    """정렬 기준 SQL 식.

    hot에 NOW() 기반 시간 감쇠를 넣으면 페이지를 넘기는 사이 점수가 변해
    커서가 어긋나므로(중복·누락), 행마다 고정된 값만 씁니다.
    시간 가중치가 필요해지면 hot_score 컬럼을 두고 쓰기 시점에 계산해야 합니다.
    """
    if sort == "top":
        return CommunityPost.votes_count
    if sort == "comments":
        return CommunityPost.comments_count
    if sort == "new":
        return func.unix_timestamp(CommunityPost.created_at)
    # hot
    return CommunityPost.votes_count + CommunityPost.comments_count * 2


def _parse_cursor(cursor: str | None) -> int | None:
    try:
        return int(cursor) if cursor else None
    except (TypeError, ValueError):
        return None


def list_posts_by_user(session, user_id: int, limit: int = 50) -> list[CommunityPost]:
    stmt = (
        select(CommunityPost)
        .where(CommunityPost.user_id == user_id, CommunityPost.deleted_at.is_(None))
        .order_by(CommunityPost.created_at.desc(), CommunityPost.post_id.desc())
        .limit(limit)
    )
    return list(session.execute(stmt).scalars().all())


def set_post_images(session, *, post_id: int, images: list[dict]) -> None:
    """글의 첨부 이미지를 통째로 교체합니다. images: [{url, thumbUrl}]"""
    session.execute(
        delete(CommunityPostImage).where(CommunityPostImage.post_id == post_id)
    )
    for index, item in enumerate(images or []):
        url = str(item.get("url") or "").strip()
        if not url:
            continue
        session.add(
            CommunityPostImage(
                post_id=post_id,
                url=url[:512],
                thumb_url=(str(item.get("thumbUrl") or "").strip() or None),
                sort_order=index,
                created_at=datetime.utcnow(),
            )
        )
    session.flush()


def get_images_for_posts(session, post_ids: list[int]) -> dict[int, list[CommunityPostImage]]:
    if not post_ids:
        return {}
    stmt = (
        select(CommunityPostImage)
        .where(CommunityPostImage.post_id.in_(post_ids))
        .order_by(CommunityPostImage.post_id, CommunityPostImage.sort_order)
    )
    result: dict[int, list[CommunityPostImage]] = {}
    for row in session.execute(stmt).scalars().all():
        result.setdefault(int(row.post_id), []).append(row)
    return result


def list_image_urls(session, post_id: int) -> list[str]:
    """파일 정리용 — 원본과 썸네일 경로 모두."""
    stmt = select(CommunityPostImage.url, CommunityPostImage.thumb_url).where(
        CommunityPostImage.post_id == post_id
    )
    urls: list[str] = []
    for url, thumb in session.execute(stmt).all():
        if url:
            urls.append(str(url))
        if thumb:
            urls.append(str(thumb))
    return urls


# 글 한 개를 조회 몇 번으로 볼지. 조회는 글보다 훨씬 흔해서 가중치가 없으면
# 글 작성 수가 순위에 거의 반영되지 않는다. 순위가 조회 쪽으로 쏠리면 올리고,
# 글 몇 개로 순위가 뒤집히면 내린다.
TRENDING_POST_WEIGHT = 10


def list_trending_places(
    session, *, days: int = 30, limit: int = 5
) -> list[tuple[str, int]]:
    """지금 많이 찾는 장소. (장소명, 점수)

    점수 = 상세 열람 수 + 글 작성 수 × TRENDING_POST_WEIGHT (최근 days일).

    두 지표를 각각 집계해 바깥에서 합치면 MySQL에 FULL OUTER JOIN이 없어
    한쪽에만 있는 장소가 빠진다. 그래서 가중치를 붙인 행을 UNION ALL로 쌓고
    한 번에 GROUP BY 한다.
    """
    from app.repositories.places_store import Place, PlaceView

    since = datetime.utcnow() - timedelta(days=days)

    view_rows = select(
        PlaceView.place_id.label("place_id"), literal(1).label("w")
    ).where(PlaceView.viewed_on >= since.date())

    post_rows = select(
        CommunityPost.place_id.label("place_id"),
        literal(TRENDING_POST_WEIGHT).label("w"),
    ).where(
        CommunityPost.deleted_at.is_(None),
        CommunityPost.place_id.is_not(None),
        CommunityPost.created_at >= since,
    )

    scored = union_all(view_rows, post_rows).subquery()
    score = func.sum(scored.c.w).label("score")

    stmt = (
        select(Place.name, score)
        .join(Place, Place.place_id == scored.c.place_id)
        .group_by(Place.place_id, Place.name)
        .order_by(score.desc(), Place.name.asc())
        .limit(limit)
    )
    return [(str(name), int(s)) for name, s in session.execute(stmt).all()]


# ── 댓글 ──────────────────────────────────────────────────────────────────────

def list_root_comments(
    session, post_id: int, *, cursor: int | None = None, limit: int = 20
) -> list[CommunityComment]:
    """최상위 댓글만 오래된 순으로 한 페이지.

    커서는 마지막으로 받은 최상위 댓글의 id다. 정렬 키가 (created_at, comment_id)이므로
    그 댓글의 created_at을 서브쿼리로 다시 읽어 튜플 비교한다. 같은 초에 여러 댓글이
    달려도 id가 tie-breaker라 중복·누락이 없다.
    """
    stmt = select(CommunityComment).where(
        CommunityComment.post_id == post_id,
        CommunityComment.deleted_at.is_(None),
        CommunityComment.parent_id.is_(None),
    )
    if cursor:
        anchor = (
            select(CommunityComment.created_at)
            .where(CommunityComment.comment_id == cursor)
            .scalar_subquery()
        )
        stmt = stmt.where(
            tuple_(CommunityComment.created_at, CommunityComment.comment_id)
            > tuple_(anchor, cursor)
        )
    stmt = stmt.order_by(
        CommunityComment.created_at.asc(), CommunityComment.comment_id.asc()
    ).limit(limit)
    return list(session.execute(stmt).scalars().all())


def list_replies(session, parent_ids: list[int]) -> list[CommunityComment]:
    """주어진 최상위 댓글들의 답글. 답글은 한 단계뿐이라 페이징하지 않는다."""
    if not parent_ids:
        return []
    stmt = (
        select(CommunityComment)
        .where(
            CommunityComment.parent_id.in_(parent_ids),
            CommunityComment.deleted_at.is_(None),
        )
        .order_by(CommunityComment.created_at.asc(), CommunityComment.comment_id.asc())
    )
    return list(session.execute(stmt).scalars().all())


def get_comment(session, comment_id: int) -> CommunityComment | None:
    stmt = select(CommunityComment).where(
        CommunityComment.comment_id == comment_id,
        CommunityComment.deleted_at.is_(None),
    )
    return session.execute(stmt).scalar_one_or_none()


def create_comment(
    session,
    *,
    post: CommunityPost,
    user_id: int,
    body: str,
    parent_id: int | None = None,
    is_anonymous: bool = False,
) -> CommunityComment:
    comment = CommunityComment(
        post_id=post.post_id,
        user_id=user_id,
        parent_id=parent_id,
        body=body.strip()[:500],
        is_anonymous=bool(is_anonymous),
        created_at=datetime.utcnow(),
    )
    session.add(comment)
    post.comments_count = int(post.comments_count or 0) + 1
    session.flush()
    return comment


def update_comment(
    session, comment: CommunityComment, *, body: str, is_anonymous: bool | None = None
) -> CommunityComment:
    comment.body = body.strip()[:500]
    if is_anonymous is not None:
        comment.is_anonymous = bool(is_anonymous)
    session.flush()
    return comment


def soft_delete_comment(session, comment: CommunityComment) -> None:
    comment.deleted_at = datetime.utcnow()
    post = get_post(session, comment.post_id)
    if post:
        post.comments_count = max(0, int(post.comments_count or 0) - 1)
    session.flush()


def get_comment_likes(session, user_id: int, comment_ids: list[int]) -> set[int]:
    """요청자가 따봉을 누른 댓글 id 집합."""
    if not comment_ids:
        return set()
    stmt = select(CommunityCommentLike.comment_id).where(
        CommunityCommentLike.user_id == user_id,
        CommunityCommentLike.comment_id.in_(comment_ids),
    )
    return {int(cid) for cid in session.execute(stmt).scalars().all()}


def toggle_comment_like(session, *, user_id: int, comment: CommunityComment) -> tuple[bool, int]:
    """(눌린 상태, 갱신된 개수)를 반환합니다."""
    stmt = select(CommunityCommentLike).where(
        CommunityCommentLike.user_id == user_id,
        CommunityCommentLike.comment_id == comment.comment_id,
    )
    row = session.execute(stmt).scalar_one_or_none()
    if row:
        session.delete(row)
        comment.likes_count = max(0, int(comment.likes_count or 0) - 1)
        session.flush()
        return False, int(comment.likes_count)

    try:
        with session.begin_nested():
            session.add(
                CommunityCommentLike(
                    user_id=user_id,
                    comment_id=comment.comment_id,
                    created_at=datetime.utcnow(),
                )
            )
            session.flush()
    except IntegrityError:
        # 같은 사용자가 동시에 두 번 눌렀을 때
        return True, int(comment.likes_count or 0)

    comment.likes_count = int(comment.likes_count or 0) + 1
    session.flush()
    return True, int(comment.likes_count)


def list_comments_by_user(session, user_id: int, limit: int = 50) -> list[CommunityComment]:
    stmt = (
        select(CommunityComment)
        .where(CommunityComment.user_id == user_id, CommunityComment.deleted_at.is_(None))
        .order_by(CommunityComment.created_at.desc(), CommunityComment.comment_id.desc())
        .limit(limit)
    )
    return list(session.execute(stmt).scalars().all())


# ── 투표 ──────────────────────────────────────────────────────────────────────

def get_vote_value(session, user_id: int, post_id: int) -> int:
    stmt = select(CommunityVote.value).where(
        CommunityVote.user_id == user_id, CommunityVote.post_id == post_id
    )
    value = session.execute(stmt).scalar_one_or_none()
    return int(value or 0)


def get_vote_values(session, user_id: int, post_ids: list[int]) -> dict[int, int]:
    if not post_ids:
        return {}
    stmt = select(CommunityVote.post_id, CommunityVote.value).where(
        CommunityVote.user_id == user_id, CommunityVote.post_id.in_(post_ids)
    )
    return {int(pid): int(val) for pid, val in session.execute(stmt).all()}


def set_vote(session, *, user_id: int, post: CommunityPost, value: int) -> int:
    """value는 -1 / 0(해제) / 1. 갱신 후 글의 점수를 반환합니다."""
    value = max(-1, min(1, int(value)))
    stmt = select(CommunityVote).where(
        CommunityVote.user_id == user_id, CommunityVote.post_id == post.post_id
    )
    row = session.execute(stmt).scalar_one_or_none()
    previous = int(row.value) if row else 0

    if value == 0:
        if row:
            session.delete(row)
    elif row:
        row.value = value
    else:
        try:
            with session.begin_nested():
                session.add(
                    CommunityVote(user_id=user_id, post_id=post.post_id, value=value)
                )
                session.flush()
        except IntegrityError:
            # 같은 사용자가 동시에 두 번 눌렀을 때
            row = session.execute(stmt).scalar_one_or_none()
            if row:
                previous = int(row.value)
                row.value = value

    post.votes_count = int(post.votes_count or 0) + (value - previous)
    session.flush()
    return int(post.votes_count)


# ── 저장 ──────────────────────────────────────────────────────────────────────

def is_saved(session, user_id: int, post_id: int) -> bool:
    stmt = select(CommunitySave.save_id).where(
        CommunitySave.user_id == user_id, CommunitySave.post_id == post_id
    )
    return session.execute(stmt).scalar_one_or_none() is not None


def get_saved_flags(session, user_id: int, post_ids: list[int]) -> set[int]:
    if not post_ids:
        return set()
    stmt = select(CommunitySave.post_id).where(
        CommunitySave.user_id == user_id, CommunitySave.post_id.in_(post_ids)
    )
    return {int(pid) for pid in session.execute(stmt).scalars().all()}


def toggle_save(session, *, user_id: int, post_id: int) -> bool:
    """저장되면 True, 해제되면 False."""
    stmt = select(CommunitySave).where(
        CommunitySave.user_id == user_id, CommunitySave.post_id == post_id
    )
    row = session.execute(stmt).scalar_one_or_none()
    if row:
        session.delete(row)
        session.flush()
        return False
    try:
        with session.begin_nested():
            session.add(
                CommunitySave(
                    user_id=user_id, post_id=post_id, created_at=datetime.utcnow()
                )
            )
            session.flush()
    except IntegrityError:
        return True
    return True


def list_saved_posts(session, user_id: int, limit: int = 50) -> list[tuple[CommunityPost, datetime | None]]:
    stmt = (
        select(CommunityPost, CommunitySave.created_at)
        .join(CommunitySave, CommunitySave.post_id == CommunityPost.post_id)
        .where(CommunitySave.user_id == user_id, CommunityPost.deleted_at.is_(None))
        .order_by(CommunitySave.created_at.desc(), CommunitySave.save_id.desc())
        .limit(limit)
    )
    return [(post, saved_at) for post, saved_at in session.execute(stmt).all()]
