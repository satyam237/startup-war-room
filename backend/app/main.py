from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import db


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await db.init_db()
    await db.mark_running_failed()
    yield
    await db.reset_engine()


app = FastAPI(title="Startup War Room", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
