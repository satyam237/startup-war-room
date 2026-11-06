from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    LLM_PROVIDER: str = "openrouter"  # openrouter | fake
    OPENROUTER_API_KEY: str = ""
    OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1"
    FAST_MODEL: str = "openai/gpt-6.1-terra"
    AGENT_MODEL: str = "openai/gpt-6.1-terra"
    JUDGE_MODEL: str = "openai/gpt-6.1-sol"
    ESCALATION_MODEL: str = "anthropic/claude-opus-5.5"
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
