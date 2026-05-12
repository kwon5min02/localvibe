"""앱 패키지. `from app import app` 시에만 main을 로드합니다 (CLI·마이그레이션에서 db만 import 가능)."""

__all__ = ["app", "create_app"]


def __getattr__(name: str):
    if name == "app":
        from .main import app as _app

        return _app
    if name == "create_app":
        from .main import create_app as _create_app

        return _create_app
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
