"""USERS 테이블 ORM 및 CRUD."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, select
from sqlalchemy.orm import Mapped, mapped_column

from app.repositories.db import Base


class User(Base):
    __tablename__ = "users"

    user_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    google_id: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    profile_image: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


def get_user_by_google_id(session, google_id: str) -> User | None:
    stmt = select(User).where(User.google_id == google_id)
    return session.execute(stmt).scalar_one_or_none()


def upsert_user_from_google(
    session,
    *,
    google_id: str,
    email: str,
    name: str,
    profile_image: str,
) -> User:
    now = datetime.utcnow()
    existing = get_user_by_google_id(session, google_id)
    if existing:
        existing.email = email
        existing.name = name
        existing.profile_image = profile_image or existing.profile_image
        existing.last_login_at = now
        session.flush()
        return existing
    user = User(
        google_id=google_id,
        email=email,
        name=name,
        profile_image=profile_image or None,
        created_at=now,
        last_login_at=now,
    )
    session.add(user)
    session.flush()
    return user
