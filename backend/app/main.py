import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app import db
from app.config import get_settings
from app.model_check import check_models
from app.ratelimit import RateLimiter
from app.routes import router
from app.runner import DebateRunner

RATE_WINDOW_S = 3600


def configure_logging() -> None:
    """Uvicorn sets up only its own loggers, so `app.*` INFO lines would otherwise be dropped."""
    logger = logging.getLogger("app")
    logger.setLevel(logging.INFO)
    if not logger.hasHandlers():
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(levelname)s %(name)s %(message)s"))
        logger.addHandler(handler)


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    await db.init_db()
    await db.mark_running_failed()
    app.state.runner = DebateRunner()
    settings = get_settings()
    app.state.create_limiter = RateLimiter(settings.RATE_LIMIT_PER_HOUR, RATE_WINDOW_S)
    app.state.intake_limiter = RateLimiter(settings.INTAKE_RATE_LIMIT_PER_HOUR, RATE_WINDOW_S)
    app.state.feedback_limiter = RateLimiter(settings.FEEDBACK_RATE_LIMIT_PER_HOUR, RATE_WINDOW_S)
    app.state.models_ok = await check_models(settings)
    yield
    await app.state.runner.shutdown()
    await db.reset_engine()


app = FastAPI(title="Startup War Room", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[get_settings().FRONTEND_ORIGIN],
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type", "X-Delete-Token", "Last-Event-ID"],
    expose_headers=["Content-Disposition", "Retry-After"],
)
app.include_router(router)


@app.get("/health")
async def health(request: Request) -> dict[str, Any]:
    """Always 200 while the process is up. `models_ok` and `key_ok` say whether debates can run."""
    settings = get_settings()
    return {
        "status": "ok",
        "models_ok": request.app.state.models_ok,
        "key_ok": settings.LLM_PROVIDER != "openrouter" or bool(settings.OPENROUTER_API_KEY),
    }
