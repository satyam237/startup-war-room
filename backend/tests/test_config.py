from pathlib import Path

from app import config
from app.config import ENV_FILES, Settings

BACKEND_DIR = Path(config.__file__).resolve().parents[1]


def test_env_files_are_found_from_any_working_directory(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    assert ENV_FILES == (BACKEND_DIR.parent / ".env", BACKEND_DIR / ".env")
    assert all(path.is_absolute() for path in ENV_FILES)


def test_backend_env_overrides_repo_root_env(tmp_path, monkeypatch):
    monkeypatch.delenv("FAST_MODEL", raising=False)
    monkeypatch.delenv("JUDGE_MODEL", raising=False)
    root, backend = tmp_path / "root.env", tmp_path / "backend.env"
    root.write_text("FAST_MODEL=from-root\nJUDGE_MODEL=only-in-root\n")
    backend.write_text("FAST_MODEL=from-backend\n")

    settings = Settings(_env_file=(root, backend))

    assert settings.FAST_MODEL == "from-backend"
    assert settings.JUDGE_MODEL == "only-in-root"


def test_tests_do_not_read_env_files():
    """The owner's real `.env` sits on the ENV_FILES path, so this checks the conftest switch."""
    assert Settings.model_config["env_file"] is None
    key_is_blank = Settings().OPENROUTER_API_KEY == ""  # never let an assertion print a key
    assert key_is_blank


def test_heroku_postgres_url_is_normalised_for_asyncpg():
    fake = "postgres://user:pw@ec2-1-2-3-4.compute-1.amazonaws.com:5432/dbname"
    expected = "postgresql+asyncpg://user:pw@ec2-1-2-3-4.compute-1.amazonaws.com:5432/dbname"
    assert Settings(DATABASE_URL=fake).DATABASE_URL == expected
    assert Settings(DATABASE_URL="postgresql://u:p@h/d").DATABASE_URL == "postgresql+asyncpg://u:p@h/d"


def test_sslmode_query_is_dropped_and_other_urls_untouched():
    assert Settings(DATABASE_URL="postgres://u:p@h/d?sslmode=require").DATABASE_URL == (
        "postgresql+asyncpg://u:p@h/d"
    )
    assert Settings(DATABASE_URL="postgresql+asyncpg://u:p@h/d").DATABASE_URL == (
        "postgresql+asyncpg://u:p@h/d"
    )
    assert Settings(DATABASE_URL="sqlite+aiosqlite:///./x.db").DATABASE_URL == "sqlite+aiosqlite:///./x.db"


def test_tests_run_on_the_fake_provider():
    assert Settings().LLM_PROVIDER == "fake"
