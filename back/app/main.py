from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth_router, chat_router, health_router, regions_router


def create_app() -> FastAPI:
    api_app = FastAPI(title="LocalVibe API")
    api_app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    api_app.include_router(health_router)
    api_app.include_router(regions_router)
    api_app.include_router(chat_router)
    api_app.include_router(auth_router)
    return api_app


app = create_app()