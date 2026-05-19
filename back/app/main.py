from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api import (
    auth_router,
    chat_router,
    health_router,
    places_router,
    regions_router,
    search_router,
    visual_router,
)
from app.repositories.db import mysql_url_configured


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """서버는 MySQL만 사용. MYSQL_URL 없으면 기동 실패."""
    load_dotenv()
    if not mysql_url_configured():
        raise RuntimeError(
            "MYSQL_URL이 .env에 없습니다. SQLite는 사용하지 않습니다. "
            "mysql+pymysql://... 형식으로 연결 문자열을 설정하세요."
        )
    from app.repositories.regions_store import init_region_db
    from app.services.crawl_scheduler import start_scheduler

    init_region_db()
    start_scheduler()
    from app.services.embedding_service import _get_model
    _get_model()
    yield


def create_app() -> FastAPI:
    api_app = FastAPI(title="LocalVibe API", lifespan=lifespan)
    api_app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    static_root = Path(__file__).resolve().parents[1] / "static"
    static_root.mkdir(parents=True, exist_ok=True)
    api_app.mount("/static", StaticFiles(directory=str(static_root)), name="static")

    api_app.include_router(health_router)
    api_app.include_router(regions_router)
    api_app.include_router(places_router)
    api_app.include_router(search_router)
    api_app.include_router(chat_router)
    api_app.include_router(auth_router)
    api_app.include_router(visual_router)
    return api_app


app = create_app()
