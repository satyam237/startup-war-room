from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import db
from app.routes import router
from app.runner import DebateRunner


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_db()
    await db.mark_running_failed()
    app.state.runner = DebateRunner()
    yield
    await app.state.runner.shutdown()
    await db.reset_engine()


app = FastAPI(title="Startup War Room", lifespan=lifespan)
app.include_router(router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
