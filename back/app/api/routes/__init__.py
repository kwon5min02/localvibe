from .auth import router as auth_router
from .chat import router as chat_router
from .health import router as health_router
from .regions import router as regions_router

__all__ = ["auth_router", "chat_router", "health_router", "regions_router"]
