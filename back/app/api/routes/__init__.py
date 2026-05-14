from .auth import router as auth_router
from .chat import router as chat_router
from .health import router as health_router
from .places import router as places_router
from .regions import router as regions_router
from .search import router as search_router
from .visual import router as visual_router

__all__ = [
    "auth_router",
    "chat_router",
    "health_router",
    "places_router",
    "regions_router",
    "search_router",
    "visual_router",
]
