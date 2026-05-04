import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from jose import jwt

from app.schemas import GoogleLoginRequest, GoogleLoginResponse, UserProfile

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _build_access_token(user: UserProfile) -> str:
    secret = os.getenv("JWT_SECRET", "").strip()
    if not secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="JWT_SECRET 환경변수가 설정되지 않았습니다.",
        )

    algorithm = os.getenv("JWT_ALGORITHM", "HS256").strip() or "HS256"
    expire_minutes_raw = os.getenv("JWT_EXPIRE_MINUTES", "10080").strip()
    try:
        expire_minutes = int(expire_minutes_raw)
    except ValueError:
        expire_minutes = 10080

    expires_at = datetime.now(tz=timezone.utc) + timedelta(minutes=expire_minutes)
    payload = {
        "sub": user.google_sub,
        "email": user.email,
        "name": user.name,
        "picture": user.picture,
        "exp": expires_at,
    }
    return jwt.encode(payload, secret, algorithm=algorithm)


def _parse_user_from_google_id_token(raw_id_token: str) -> UserProfile:
    client_id = os.getenv("GOOGLE_CLIENT_ID", "").strip()
    if not client_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="GOOGLE_CLIENT_ID 환경변수가 설정되지 않았습니다.",
        )

    try:
        claims = google_id_token.verify_oauth2_token(
            raw_id_token,
            google_requests.Request(),
            audience=client_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않은 Google 토큰입니다.",
        ) from exc

    issuer = str(claims.get("iss", ""))
    if issuer not in ("accounts.google.com", "https://accounts.google.com"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="토큰 발급자가 올바르지 않습니다.",
        )

    google_sub = str(claims.get("sub") or "").strip()
    email = str(claims.get("email") or "").strip()
    if not google_sub or not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google 계정 정보가 누락되었습니다.",
        )

    name = str(claims.get("name") or email.split("@")[0]).strip()
    picture: Optional[str] = claims.get("picture")
    return UserProfile(
        google_sub=google_sub,
        email=email,
        name=name,
        picture=str(picture or ""),
    )


@router.post("/google", response_model=GoogleLoginResponse)
def google_login(payload: GoogleLoginRequest):
    user = _parse_user_from_google_id_token(payload.id_token)
    access_token = _build_access_token(user)
    return GoogleLoginResponse(access_token=access_token, user=user)
