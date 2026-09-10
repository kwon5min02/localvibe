"""커뮤니티 API — 글·댓글·투표·저장.

목록/상세는 비로그인도 볼 수 있고(get_current_user_optional),
쓰기 동작은 로그인이 필요합니다(get_current_user).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

from app.api.deps import AuthUser, get_current_user, get_current_user_optional
from app.modules.community.boards import is_valid_board, normalize_board_filter
from app.modules.community.images import ImageError, delete_image, save_upload
from app.repositories import community_store, places_store
from app.repositories.db import session_scope
from app.schemas import (
    CommentCreateRequest,
    ImageUploadResponse,
    PostImage,
    CommentItem,
    CommentLikeResponse,
    CommentListResponse,
    CommentUpdateRequest,
    CommunityAuthor,
    PostCreateRequest,
    PostListResponse,
    PostSummary,
    PostUpdateRequest,
    PlaceSuggestion,
    PlaceSuggestionListResponse,
    SaveResponse,
    TrendingPlaceItem,
    TrendingPlaceListResponse,
    VoteRequest,
    VoteResponse,
)

router = APIRouter(prefix="/api/community", tags=["community"])


# ── 응답 변환 ────────────────────────────────────────────────────────────────

def _author_of(
    *,
    user_id: int,
    profile: dict | None,
    anonymous: bool,
    viewer_id: int | None,
):
    """익명이면 작성자 정보를 응답에 아예 담지 않습니다."""
    if anonymous:
        return CommunityAuthor(anonymous=True, isMine=viewer_id == user_id)
    return CommunityAuthor(
        userId=user_id,
        name=(profile or {}).get("name") or "사용자",
        picture=(profile or {}).get("picture") or None,
        anonymous=False,
        isMine=viewer_id == user_id,
    )


def _author_profiles(session, user_ids: set[int]) -> dict[int, dict]:
    """작성자 표시에 쓰는 이름·프로필 사진."""
    if not user_ids:
        return {}
    from app.repositories.users_store import User
    from sqlalchemy import select

    rows = session.execute(
        select(User.user_id, User.name, User.profile_image).where(
            User.user_id.in_(user_ids)
        )
    ).all()
    return {
        int(uid): {"name": str(name or "사용자"), "picture": str(picture or "")}
        for uid, name, picture in rows
    }


def _place_names(session, place_ids: set[int]) -> dict[int, str]:
    """연결된 갤러리 장소의 현재 이름. 장소가 지워졌으면 비어 있습니다."""
    if not place_ids:
        return {}
    from app.repositories.places_store import Place
    from sqlalchemy import select

    rows = session.execute(
        select(Place.place_id, Place.name).where(Place.place_id.in_(place_ids))
    ).all()
    return {int(pid): str(name or "") for pid, name in rows if name}


def post_to_summary(
    post,
    *,
    profile: dict | None,
    my_vote: int,
    saved: bool,
    viewer_id: int | None,
    place_name: str | None = None,
    images: list | None = None,
):
    return PostSummary(
        id=int(post.post_id),
        boardId=post.board_id,
        title=post.title,
        body=post.body,
        # 갤러리 장소와 연결된 글은 현재 DB 이름을 보여준다(이름이 바뀌면 함께 바뀜).
        place=place_name or post.place_name,
        placeId=post.place_id,
        author=_author_of(
            user_id=int(post.user_id),
            profile=profile,
            anonymous=bool(post.is_anonymous),
            viewer_id=viewer_id,
        ),
        createdAt=post.created_at.isoformat() if post.created_at else None,
        votes=int(post.votes_count or 0),
        comments=int(post.comments_count or 0),
        views=int(post.views_count or 0),
        myVote=my_vote,
        saved=saved,
        images=[
            PostImage(url=img.url, thumbUrl=img.thumb_url) for img in (images or [])
        ],
    )


def build_summaries(session, posts, viewer: AuthUser | None):
    """목록·상세 공통 — 작성자 이름과 요청자 기준 상태(myVote/saved)를 한 번에 채웁니다."""
    viewer_id = viewer.user_id if viewer else None
    post_ids = [int(p.post_id) for p in posts]

    profiles = _author_profiles(
        session, {int(p.user_id) for p in posts if not p.is_anonymous}
    )
    votes = community_store.get_vote_values(session, viewer_id, post_ids) if viewer else {}
    saves = community_store.get_saved_flags(session, viewer_id, post_ids) if viewer else set()
    place_names = _place_names(
        session, {int(p.place_id) for p in posts if p.place_id}
    )
    images = community_store.get_images_for_posts(session, post_ids)

    return [
        post_to_summary(
            post,
            profile=profiles.get(int(post.user_id)),
            my_vote=int(votes.get(int(post.post_id), 0)),
            saved=int(post.post_id) in saves,
            viewer_id=viewer_id,
            place_name=place_names.get(int(post.place_id)) if post.place_id else None,
            images=images.get(int(post.post_id)),
        )
        for post in posts
    ]


# ── 글 ────────────────────────────────────────────────────────────────────────

@router.get("/posts", response_model=PostListResponse)
def list_posts(
    board: str | None = Query(default=None),
    placeId: int | None = Query(default=None, ge=1),
    sort: str = Query(default="hot"),
    q: str | None = Query(default=None),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    viewer: AuthUser | None = Depends(get_current_user_optional),
):
    with session_scope() as session:
        posts, next_cursor = community_store.list_posts(
            session,
            board_id=normalize_board_filter(board),
            place_id=placeId,
            sort=sort,
            query=q,
            cursor=cursor,
            limit=limit,
        )
        return PostListResponse(
            posts=build_summaries(session, posts, viewer),
            nextCursor=next_cursor,
        )


@router.get("/posts/{post_id}", response_model=PostSummary)
def get_post(
    post_id: int,
    viewerKey: str | None = Query(default=None, max_length=80),
    viewer: AuthUser | None = Depends(get_current_user_optional),
):
    with session_scope() as session:
        post = community_store.get_post(session, post_id)
        if not post:
            raise HTTPException(status_code=404, detail="글을 찾을 수 없습니다.")

        # 로그인 사용자는 계정 기준, 비로그인은 브라우저가 만든 키로 중복을 거른다.
        key = f"u{viewer.user_id}" if viewer else (viewerKey or "")
        if key:
            community_store.record_view(session, post=post, viewer_key=key)
        return build_summaries(session, [post], viewer)[0]


@router.post("/posts", response_model=PostSummary)
def create_post(body: PostCreateRequest, user: AuthUser = Depends(get_current_user)):
    if not is_valid_board(body.boardId):
        raise HTTPException(status_code=400, detail="알 수 없는 게시판입니다.")
    if not body.title.strip() or not body.body.strip():
        raise HTTPException(status_code=400, detail="제목과 내용을 입력해 주세요.")

    with session_scope() as session:
        post = community_store.create_post(
            session,
            user_id=user.user_id,
            board_id=body.boardId,
            title=body.title,
            body=body.body,
            place_name=body.place,
            place_id=body.placeId,
            is_anonymous=body.anonymous,
        )
        if body.images:
            community_store.set_post_images(
                session,
                post_id=int(post.post_id),
                images=[img.model_dump() for img in body.images[:5]],
            )
        return build_summaries(session, [post], user)[0]


@router.patch("/posts/{post_id}", response_model=PostSummary)
def update_post(
    post_id: int, body: PostUpdateRequest, user: AuthUser = Depends(get_current_user)
):
    if body.boardId is not None and not is_valid_board(body.boardId):
        raise HTTPException(status_code=400, detail="알 수 없는 게시판입니다.")

    with session_scope() as session:
        post = community_store.get_post(session, post_id)
        if not post:
            raise HTTPException(status_code=404, detail="글을 찾을 수 없습니다.")
        if int(post.user_id) != user.user_id:
            raise HTTPException(status_code=403, detail="내가 쓴 글만 수정할 수 있습니다.")

        community_store.update_post(
            session,
            post,
            board_id=body.boardId,
            title=body.title,
            body=body.body,
            place_name=body.place,
            place_id=body.placeId,
            is_anonymous=body.anonymous,
        )

        if body.images is not None:
            # 목록에서 빠진 사진은 디스크에서도 지운다.
            keep = {img.url for img in body.images}
            for url in community_store.list_image_urls(session, int(post.post_id)):
                base = url.replace("_thumb.jpg", ".jpg")
                if base not in keep:
                    delete_image(url)
            community_store.set_post_images(
                session,
                post_id=int(post.post_id),
                images=[img.model_dump() for img in body.images[:5]],
            )
        return build_summaries(session, [post], user)[0]


@router.delete("/posts/{post_id}")
def delete_post(post_id: int, user: AuthUser = Depends(get_current_user)):
    with session_scope() as session:
        post = community_store.get_post(session, post_id)
        if not post:
            raise HTTPException(status_code=404, detail="글을 찾을 수 없습니다.")
        if int(post.user_id) != user.user_id:
            raise HTTPException(status_code=403, detail="내가 쓴 글만 삭제할 수 있습니다.")
        # 파일까지 지운다 — soft delete라도 사진은 남길 이유가 없다.
        for url in community_store.list_image_urls(session, int(post.post_id)):
            delete_image(url)
        community_store.set_post_images(session, post_id=int(post.post_id), images=[])
        community_store.soft_delete_post(session, post)
    return {"ok": True}


@router.post("/images", response_model=ImageUploadResponse)
async def upload_image(
    file: UploadFile = File(...), user: AuthUser = Depends(get_current_user)
):
    """글 첨부용 이미지 한 장 업로드. 저장된 URL을 돌려주고, 글 등록 때 함께 보냅니다."""
    data = await file.read()
    try:
        url, thumb_url = save_upload(data)
    except ImageError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ImageUploadResponse(url=url, thumbUrl=thumb_url)


@router.get("/place-suggestions", response_model=PlaceSuggestionListResponse)
def suggest_places(
    q: str = Query(default="", max_length=100),
    limit: int = Query(default=8, ge=1, le=20),
):
    """글쓰기 장소 입력 자동완성 — 갤러리 장소에서 찾습니다."""
    if not q.strip():
        return PlaceSuggestionListResponse(places=[])
    with session_scope() as session:
        rows = places_store.search_places_by_name(session, q, limit=limit)
        return PlaceSuggestionListResponse(
            places=[PlaceSuggestion(**row) for row in rows]
        )


@router.get("/trending", response_model=TrendingPlaceListResponse)
def list_trending(
    days: int = Query(default=30, ge=1, le=365),
    limit: int = Query(default=5, ge=1, le=20),
):
    """최근 글에 많이 등장한 장소."""
    with session_scope() as session:
        rows = community_store.list_trending_places(session, days=days, limit=limit)
        return TrendingPlaceListResponse(
            places=[TrendingPlaceItem(label=name, count=cnt) for name, cnt in rows]
        )


# ── 댓글 ──────────────────────────────────────────────────────────────────────

@router.get("/posts/{post_id}/comments", response_model=CommentListResponse)
def list_comments(
    post_id: int,
    cursor: int | None = Query(None, ge=1),
    limit: int = Query(20, ge=1, le=50),
    viewer: AuthUser | None = Depends(get_current_user_optional),
):
    viewer_id = viewer.user_id if viewer else None
    with session_scope() as session:
        post = community_store.get_post(session, post_id)
        if not post:
            raise HTTPException(status_code=404, detail="글을 찾을 수 없습니다.")

        # 최상위 댓글만 페이징하고, 그 답글은 통째로 딸려 보낸다.
        root_rows = community_store.list_root_comments(
            session, post_id, cursor=cursor, limit=limit
        )
        reply_rows = community_store.list_replies(
            session, [int(c.comment_id) for c in root_rows]
        )
        rows = root_rows + reply_rows
        profiles = _author_profiles(
            session, {int(c.user_id) for c in rows if not c.is_anonymous}
        )
        liked_ids = (
            community_store.get_comment_likes(
                session, viewer_id, [int(c.comment_id) for c in rows]
            )
            if viewer
            else set()
        )

        # 부모 → 답글로 묶기 (한 단계만 사용)
        items: dict[int, CommentItem] = {}
        roots: list[CommentItem] = []
        for row in rows:
            items[int(row.comment_id)] = CommentItem(
                id=int(row.comment_id),
                body=row.body,
                author=_author_of(
                    user_id=int(row.user_id),
                    profile=profiles.get(int(row.user_id)),
                    anonymous=bool(row.is_anonymous),
                    viewer_id=viewer_id,
                ),
                createdAt=row.created_at.isoformat() if row.created_at else None,
                likes=int(row.likes_count or 0),
                liked=int(row.comment_id) in liked_ids,
                replies=[],
            )
        for row in rows:
            item = items[int(row.comment_id)]
            parent = items.get(int(row.parent_id)) if row.parent_id else None
            if parent:
                parent.replies.append(item)
            else:
                roots.append(item)
        next_cursor = (
            int(root_rows[-1].comment_id) if len(root_rows) == limit else None
        )
        return CommentListResponse(comments=roots, nextCursor=next_cursor)


@router.post("/posts/{post_id}/comments", response_model=CommentItem)
def create_comment(
    post_id: int, body: CommentCreateRequest, user: AuthUser = Depends(get_current_user)
):
    with session_scope() as session:
        post = community_store.get_post(session, post_id)
        if not post:
            raise HTTPException(status_code=404, detail="글을 찾을 수 없습니다.")

        parent_id = None
        if body.parentId:
            parent = community_store.get_comment(session, body.parentId)
            if not parent or int(parent.post_id) != post_id:
                raise HTTPException(status_code=400, detail="답글 대상을 찾을 수 없습니다.")
            # 답글의 답글은 원 댓글에 붙입니다(한 단계 유지)
            parent_id = int(parent.parent_id or parent.comment_id)

        comment = community_store.create_comment(
            session,
            post=post,
            user_id=user.user_id,
            body=body.body,
            parent_id=parent_id,
            is_anonymous=body.anonymous,
        )
        return CommentItem(
            id=int(comment.comment_id),
            body=comment.body,
            author=_author_of(
                user_id=user.user_id,
                profile=_author_profiles(session, {user.user_id}).get(user.user_id),
                anonymous=bool(comment.is_anonymous),
                viewer_id=user.user_id,
            ),
            createdAt=comment.created_at.isoformat() if comment.created_at else None,
            likes=0,
            liked=False,
            replies=[],
        )


@router.patch("/comments/{comment_id}", response_model=CommentItem)
def update_comment(
    comment_id: int,
    body: CommentUpdateRequest,
    user: AuthUser = Depends(get_current_user),
):
    with session_scope() as session:
        comment = community_store.get_comment(session, comment_id)
        if not comment:
            raise HTTPException(status_code=404, detail="댓글을 찾을 수 없습니다.")
        if int(comment.user_id) != user.user_id:
            raise HTTPException(status_code=403, detail="내가 쓴 댓글만 수정할 수 있습니다.")

        community_store.update_comment(
            session, comment, body=body.body, is_anonymous=body.anonymous
        )
        liked = community_store.get_comment_likes(session, user.user_id, [comment_id])
        return CommentItem(
            id=comment_id,
            body=comment.body,
            author=_author_of(
                user_id=user.user_id,
                profile=_author_profiles(session, {user.user_id}).get(user.user_id),
                anonymous=bool(comment.is_anonymous),
                viewer_id=user.user_id,
            ),
            createdAt=comment.created_at.isoformat() if comment.created_at else None,
            likes=int(comment.likes_count or 0),
            liked=comment_id in liked,
            replies=[],
        )


@router.put("/comments/{comment_id}/like", response_model=CommentLikeResponse)
def like_comment(comment_id: int, user: AuthUser = Depends(get_current_user)):
    with session_scope() as session:
        comment = community_store.get_comment(session, comment_id)
        if not comment:
            raise HTTPException(status_code=404, detail="댓글을 찾을 수 없습니다.")
        liked, likes = community_store.toggle_comment_like(
            session, user_id=user.user_id, comment=comment
        )
        return CommentLikeResponse(commentId=comment_id, likes=likes, liked=liked)


@router.delete("/comments/{comment_id}")
def delete_comment(comment_id: int, user: AuthUser = Depends(get_current_user)):
    with session_scope() as session:
        comment = community_store.get_comment(session, comment_id)
        if not comment:
            raise HTTPException(status_code=404, detail="댓글을 찾을 수 없습니다.")
        if int(comment.user_id) != user.user_id:
            raise HTTPException(status_code=403, detail="내가 쓴 댓글만 삭제할 수 있습니다.")
        community_store.soft_delete_comment(session, comment)
    return {"ok": True}


# ── 투표 / 저장 ───────────────────────────────────────────────────────────────

@router.put("/posts/{post_id}/vote", response_model=VoteResponse)
def vote_post(post_id: int, body: VoteRequest, user: AuthUser = Depends(get_current_user)):
    with session_scope() as session:
        post = community_store.get_post(session, post_id)
        if not post:
            raise HTTPException(status_code=404, detail="글을 찾을 수 없습니다.")
        votes = community_store.set_vote(session, user_id=user.user_id, post=post, value=body.value)
        return VoteResponse(postId=post_id, votes=votes, myVote=body.value)


@router.put("/posts/{post_id}/save", response_model=SaveResponse)
def toggle_save(post_id: int, user: AuthUser = Depends(get_current_user)):
    with session_scope() as session:
        post = community_store.get_post(session, post_id)
        if not post:
            raise HTTPException(status_code=404, detail="글을 찾을 수 없습니다.")
        saved = community_store.toggle_save(session, user_id=user.user_id, post_id=post_id)
        return SaveResponse(postId=post_id, saved=saved)
