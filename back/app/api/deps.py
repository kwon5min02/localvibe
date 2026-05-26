"""FastAPI 의존성 — JWT 로그인 사용자."""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.repositories.db import mysql_url_configured, session_scope
from app.services.auth_service import decode_access_token

_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class AuthUser:
    user_id: int
    google_sub: str
    email: str
    name: str


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> AuthUser:
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="로그인이 필요합니다.",
        )
    if not mysql_url_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MySQL(MYSQL_URL)이 설정되지 않았습니다.",
        )

    claims = decode_access_token(credentials.credentials)
    from app.repositories import users_store

    with session_scope() as session:
        user = users_store.get_user_by_google_id(session, claims.google_sub)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="등록된 사용자를 찾을 수 없습니다. 다시 로그인해 주세요.",
            )
        return AuthUser(
            user_id=int(user.user_id),
            google_sub=claims.google_sub,
            email=str(user.email or claims.email),
            name=str(user.name or claims.name),
        )
