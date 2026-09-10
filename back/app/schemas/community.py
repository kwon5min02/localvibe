from typing import Optional

from pydantic import BaseModel, Field


class CommunityAuthor(BaseModel):
    """익명 글이면 userId/name/picture를 채우지 않습니다(서버에서 지워 보냅니다)."""

    userId: Optional[int] = None
    name: Optional[str] = None
    picture: Optional[str] = None
    anonymous: bool = False
    isMine: bool = False


class PostImage(BaseModel):
    url: str
    thumbUrl: Optional[str] = None


class PostSummary(BaseModel):
    id: int
    boardId: str
    title: str
    body: str
    place: Optional[str] = None
    placeId: Optional[int] = None
    author: CommunityAuthor
    createdAt: Optional[str] = None
    votes: int = 0
    comments: int = 0
    views: int = 0
    myVote: int = 0
    saved: bool = False
    images: list[PostImage] = Field(default_factory=list)


class PostListResponse(BaseModel):
    posts: list[PostSummary] = Field(default_factory=list)
    nextCursor: Optional[str] = None


class CommentItem(BaseModel):
    id: int
    body: str
    author: CommunityAuthor
    createdAt: Optional[str] = None
    likes: int = 0
    liked: bool = False
    replies: list["CommentItem"] = Field(default_factory=list)


class CommentListResponse(BaseModel):
    comments: list[CommentItem] = Field(default_factory=list)
    # 다음 페이지가 있으면 마지막 최상위 댓글의 id. 없으면 None.
    nextCursor: Optional[int] = None


class PostCreateRequest(BaseModel):
    boardId: str = Field(..., min_length=1, max_length=64)
    title: str = Field(..., min_length=1, max_length=255)
    body: str = Field(..., min_length=1)
    place: Optional[str] = Field(default=None, max_length=255)
    placeId: Optional[int] = None
    anonymous: bool = False
    images: list[PostImage] = Field(default_factory=list)


class ImageUploadResponse(BaseModel):
    url: str
    thumbUrl: str


class PostUpdateRequest(BaseModel):
    boardId: Optional[str] = Field(default=None, max_length=64)
    title: Optional[str] = Field(default=None, max_length=255)
    body: Optional[str] = None
    place: Optional[str] = Field(default=None, max_length=255)
    placeId: Optional[int] = None
    anonymous: Optional[bool] = None
    # None이면 사진을 건드리지 않고, 배열이면 그 목록으로 교체합니다(빈 배열 = 전부 삭제).
    images: Optional[list[PostImage]] = None


class CommentCreateRequest(BaseModel):
    body: str = Field(..., min_length=1, max_length=500)
    parentId: Optional[int] = None
    anonymous: bool = False


class CommentUpdateRequest(BaseModel):
    body: str = Field(..., min_length=1, max_length=500)
    anonymous: Optional[bool] = None


class VoteRequest(BaseModel):
    value: int = Field(..., ge=-1, le=1)


class VoteResponse(BaseModel):
    postId: int
    votes: int
    myVote: int


class CommentLikeResponse(BaseModel):
    commentId: int
    likes: int
    liked: bool


class SaveResponse(BaseModel):
    postId: int
    saved: bool


class PlaceSuggestion(BaseModel):
    id: int
    name: str
    region: Optional[str] = None
    address: Optional[str] = None


class PlaceSuggestionListResponse(BaseModel):
    places: list[PlaceSuggestion] = Field(default_factory=list)


class TrendingPlaceItem(BaseModel):
    label: str
    count: int


class TrendingPlaceListResponse(BaseModel):
    places: list[TrendingPlaceItem] = Field(default_factory=list)


class MyCommentItem(BaseModel):
    id: int
    postId: int
    postTitle: str
    body: str
    createdAt: Optional[str] = None
    anonymous: bool = False
    # 댓글에는 투표가 없고 따봉만 있습니다.
    likes: int = 0


class MyCommentListResponse(BaseModel):
    comments: list[MyCommentItem] = Field(default_factory=list)


class SavedPostItem(PostSummary):
    savedAt: Optional[str] = None


class SavedPostListResponse(BaseModel):
    posts: list[SavedPostItem] = Field(default_factory=list)


CommentItem.model_rebuild()
