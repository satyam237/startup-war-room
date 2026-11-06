from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url


_BACKEND_DIR = Path(__file__).resolve().parents[1]
# Found from this file, not the working directory. A later file wins, so backend/.env
# overrides the repo root's.
ENV_FILES = (_BACKEND_DIR.parent / ".env", _BACKEND_DIR / ".env")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILES, extra="ignore")

    LLM_PROVIDER: str = "openrouter"  # openrouter | fake
    OPENROUTER_API_KEY: str = ""
    OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1"
    FAST_MODEL: str = "openai/gpt-6.1-terra"
    AGENT_MODEL: str = "openai/gpt-6.1-terra"
    JUDGE_MODEL: str = "openai/gpt-6.1-sol"
    ESCALATION_MODEL: str = "anthropic/claude-opus-5.5"
    FAKE_DELAY_S: float = 0.0  # per-token delay for the fake provider
    DATABASE_URL: str = "sqlite+aiosqlite:///./warroom.db"
    FRONTEND_ORIGIN: str = "http://localhost:5173"
    MAX_TURNS: int = 14
    MAX_TOKENS_PER_DEBATE: int = 40000
    RATE_LIMIT_PER_HOUR: int = 5
    INTAKE_RATE_LIMIT_PER_HOUR: int = 20
    FEEDBACK_RATE_LIMIT_PER_HOUR: int = 20
    # Proxies that append to X-Forwarded-For before us (Heroku router: 1). 0 ignores the header.
    TRUSTED_PROXY_HOPS: int = 0
    REBUTTAL_TIMEOUT_S: float = 45
    DEBATE_TIMEOUT_S: int = 240
    MAX_CONCURRENT_DEBATES: int = 10

    @field_validator("DATABASE_URL")
    @classmethod
    def _asyncpg_url(cls, v: str) -> str:
        """Heroku supplies postgres://. Use the asyncpg driver and drop `sslmode`, which
        asyncpg rejects; SSL is set in db.py through connect_args instead."""
        if not v.startswith(("postgres://", "postgresql://")):
            return v
        url = make_url(v).set(drivername="postgresql+asyncpg")
        query = {k: val for k, val in url.query.items() if k != "sslmode"}
        return url.set(query=query).render_as_string(hide_password=False)


@lru_cache
def get_settings() -> Settings:
    return Settings()
