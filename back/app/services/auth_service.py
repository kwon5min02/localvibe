"""Google ID 토큰 검증 및 JWT 발급."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException, status
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from jose import jwt


@dataclass
class GoogleUserClaims:
    google_sub: str
    email: str
    name: str
    picture: str


def verify_google_id_token(raw_id_token: str) -> GoogleUserClaims:
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
    return GoogleUserClaims(
        google_sub=google_sub,
        email=email,
        name=name,
        picture=str(picture or ""),
    )


def build_access_token(*, google_sub: str, email: str, name: str, picture: str) -> str:
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
        "sub": google_sub,
        "email": email,
        "name": name,
        "picture": picture,
        "exp": expires_at,
    }
    return jwt.encode(payload, secret, algorithm=algorithm)
