"""SQLAlchemy 엔진·세션·Base. MYSQL_URL이 설정된 경우에만 사용합니다."""

from __future__ import annotations

import os
from contextlib import contextmanager
from collections.abc import Generator
from typing import TYPE_CHECKING

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

if TYPE_CHECKING:
    from sqlalchemy.engine import Engine


class Base(DeclarativeBase):
    pass


_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None


def mysql_url_configured() -> bool:
    return bool(os.getenv("MYSQL_URL", "").strip())


def get_database_url() -> str:
    raw = os.getenv("MYSQL_URL", "").strip()
    if not raw:
        raise RuntimeError("MYSQL_URL 환경변수가 필요합니다.")
    if raw.startswith("mysql://") and "+pymysql" not in raw:
        raw = raw.replace("mysql://", "mysql+pymysql://", 1)
    return raw


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = create_engine(
            get_database_url(),
            pool_pre_ping=True,
            pool_recycle=3600,
            echo=os.getenv("SQLALCHEMY_ECHO", "").strip() == "1",
        )
    return _engine


def get_session_factory() -> sessionmaker[Session]:
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=get_engine())
    return _SessionLocal


@contextmanager
def session_scope() -> Generator[Session, None, None]:
    factory = get_session_factory()
    session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def init_db() -> None:
    """모든 ORM 테이블 생성 (Alembic 없음)."""
    # 순서: FK 의존성 — places 먼저 등록
    from app.repositories import documents_store  # noqa: F401
    from app.repositories import places_store  # noqa: F401
    from app.repositories import trends_store  # noqa: F401
    from app.repositories import users_store  # noqa: F401

    Base.metadata.create_all(bind=get_engine())
