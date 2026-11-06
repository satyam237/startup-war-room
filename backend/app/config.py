from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    LLM_PROVIDER: str = "anthropic"  # anthropic | fake
    AGENT_MODEL: str = "claude-sonnet-5-5"
    JUDGE_MODEL: str = "claude-opus-5-5"
    FAST_MODEL: str = "claude-haiku-5-5"
    ANTHROPIC_API_KEY: str = ""
    OPENAI_API_KEY: str = ""
    DATABASE_URL: str = "sqlite+aiosqlite:///./warroom.db"
    FRONTEND_ORIGIN: str = "http://localhost:5173"
    MAX_TURNS: int = 14
    MAX_TOKENS_PER_DEBATE: int = 40000
    RATE_LIMIT_PER_HOUR: int = 5
    REBUTTAL_TIMEOUT_S: int = 45
    DEBATE_TIMEOUT_S: int = 240
    MAX_CONCURRENT_DEBATES: int = 10


@lru_cache
def get_settings() -> Settings:
    return Settings()
