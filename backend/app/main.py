from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import db
from app.config import get_settings
from app.ratelimit import RateLimiter
from app.routes import router
from app.runner import DebateRunner

RATE_WINDOW_S = 3600


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_db()
    await db.mark_running_failed()
    app.state.runner = DebateRunner()
    settings = get_settings()
    app.state.create_limiter = RateLimiter(settings.RATE_LIMIT_PER_HOUR, RATE_WINDOW_S)
    app.state.intake_limiter = RateLimiter(settings.INTAKE_RATE_LIMIT_PER_HOUR, RATE_WINDOW_S)
    app.state.feedback_limiter = RateLimiter(settings.FEEDBACK_RATE_LIMIT_PER_HOUR, RATE_WINDOW_S)
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
async def health() -> dict[str, str]:
    return {"status": "ok"}
