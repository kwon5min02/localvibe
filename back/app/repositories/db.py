"""SQLAlchemy 엔진·세션·Base. MYSQL_URL이 설정된 경우에만 사용합니다."""

from __future__ import annotations

import logging
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
    from app.repositories import scraps_store  # noqa: F401
    from app.repositories import trips_store  # noqa: F401
    from app.repositories import users_store  # noqa: F401
    from app.repositories import community_store  # noqa: F401

    engine = get_engine()
    Base.metadata.create_all(bind=engine)
    _add_missing_columns(engine)


def _add_missing_columns(engine) -> None:
    """모델에는 있는데 DB에는 없는 컬럼을 채웁니다.

    create_all()은 '없는 테이블'만 만들고 기존 테이블은 건드리지 않습니다.
    그래서 모델에 컬럼을 추가해도 이미 존재하는 DB에는 반영되지 않아
    'Unknown column' 오류가 납니다. Alembic을 쓰지 않으므로 여기서 메웁니다.

    - 추가만 합니다. 컬럼 삭제·타입 변경은 하지 않습니다(데이터 유실 방지).
    - NOT NULL 컬럼은 기본값이 있어야 기존 행을 채울 수 있으므로,
      기본값이 없으면 NULL 허용으로 추가합니다.
    """
    from sqlalchemy import inspect
    from sqlalchemy.schema import CreateColumn

    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    for table in Base.metadata.sorted_tables:
        if table.name not in existing_tables:
            continue  # 방금 create_all이 만든 테이블
        db_columns = {c["name"] for c in inspector.get_columns(table.name)}
        for column in table.columns:
            if column.name in db_columns:
                continue
            ddl = str(CreateColumn(column).compile(engine))
            if not column.nullable and column.server_default is None and column.default is None:
                # 기존 행을 채울 값이 없으면 NOT NULL을 걸 수 없다
                ddl = ddl.replace(" NOT NULL", "")
            with engine.begin() as conn:
                conn.exec_driver_sql(f"ALTER TABLE {table.name} ADD COLUMN {ddl}")
            logging.getLogger(__name__).info(
                "컬럼 추가: %s.%s", table.name, column.name
            )
