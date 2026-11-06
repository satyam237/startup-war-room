import os

os.environ["LLM_PROVIDER"] = "fake"

import httpx
import pytest_asyncio

from app import db
from app.config import get_settings


@pytest_asyncio.fixture(autouse=True)
async def isolated_db(tmp_path, monkeypatch):
    """Fresh temp SQLite file per test; engine rebuilt from it."""
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path / 'test.db'}")
    monkeypatch.setenv("LLM_PROVIDER", "fake")
    get_settings.cache_clear()
    await db.reset_engine()
    await db.init_db()
    from app import llm

    llm.set_gateway(None)
    yield
    llm.set_gateway(None)
    await db.reset_engine()
    get_settings.cache_clear()


@pytest_asyncio.fixture
async def client(isolated_db):
    from app.main import app

    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            yield c
