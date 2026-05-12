import os

from fastapi import APIRouter

from app.schemas import GoogleLoginRequest, GoogleLoginResponse, UserProfile
from app.services.auth_service import build_access_token, verify_google_id_token

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/google", response_model=GoogleLoginResponse)
def google_login(payload: GoogleLoginRequest):
    claims = verify_google_id_token(payload.id_token)
    user = UserProfile(
        google_sub=claims.google_sub,
        email=claims.email,
        name=claims.name,
        picture=claims.picture,
    )
    if os.getenv("MYSQL_URL", "").strip():
        from app.repositories import users_store
        from app.repositories.db import session_scope

        with session_scope() as session:
            users_store.upsert_user_from_google(
                session,
                google_id=user.google_sub,
                email=user.email,
                name=user.name,
                profile_image=user.picture or "",
            )
    access_token = build_access_token(
        google_sub=user.google_sub,
        email=user.email,
        name=user.name,
        picture=user.picture or "",
    )
    return GoogleLoginResponse(access_token=access_token, user=user)
