import json
import logging
from pathlib import Path

import httpx
import pytest
from openai import AsyncOpenAI

from app import llm
from app.config import get_settings
from app.llm import OpenRouterGateway
from app.main import app, configure_logging
from app.model_check import check_models
from app.models import FinalPosition
from tests.test_llm import POSITION, StubClient, completion

CAPABLE = ["response_format", "reasoning", "temperature"]
MODELS = ("openai/gpt-6.1-terra", "openai/gpt-6.1-sol", "anthropic/claude-opus-5.5")


def listed(params_by_model: dict[str, list[str]]) -> list[dict]:
    return [{"id": m, "supported_parameters": p} for m, p in params_by_model.items()]


class FakeOpenRouter:
    """A real SDK client over a mock transport, so nothing here can reach the network."""

    def __init__(self, data: list[dict] | None = None, status: int = 200, error: Exception | None = None) -> None:
        self.data, self.status, self.error = data, status, error
        self.paths: list[str] = []
        self.gateway = OpenRouterGateway(
            AsyncOpenAI(
                base_url="http://openrouter.test/api/v1", api_key="test-key", max_retries=0,
                http_client=httpx.AsyncClient(transport=httpx.MockTransport(self.handle)),
            )
        )

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.paths.append(request.url.path)
        if self.error:
            raise self.error
        return httpx.Response(self.status, json={"data": self.data})


def everything_capable() -> dict[str, list[str]]:
    return {m: CAPABLE for m in MODELS}


@pytest.fixture
def openrouter(monkeypatch):
    def use(fake: FakeOpenRouter | None, key: str = "test-key") -> None:
        monkeypatch.setenv("LLM_PROVIDER", "openrouter")
        monkeypatch.setenv("OPENROUTER_API_KEY", key)
        get_settings.cache_clear()
        llm.set_gateway(fake.gateway if fake else None)

    return use


async def health() -> httpx.Response:
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            return await c.get("/health")


async def test_health_on_the_fake_provider(client):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "models_ok": True, "key_ok": True}


async def test_fake_provider_never_asks_for_the_model_list():
    gateway = llm.get_gateway()
    assert await check_models(get_settings()) is True
    assert not hasattr(gateway, "supported_parameters")


async def test_capable_models_pass(openrouter):
    fake = FakeOpenRouter(listed(everything_capable()))
    openrouter(fake)
    assert await check_models(get_settings()) is True
    assert fake.paths == ["/api/v1/models"]


@pytest.mark.parametrize("params", [["response_format", "reasoning"], ["structured_outputs", "reasoning"]])
async def test_either_structured_parameter_is_enough(openrouter, params):
    openrouter(FakeOpenRouter(listed({m: params for m in MODELS})))
    assert await check_models(get_settings()) is True


@pytest.mark.parametrize(
    ("params", "missing"),
    [(["reasoning"], "response_format"), (["response_format"], "reasoning"), ([], "reasoning")],
)
async def test_unsupported_model_logs_error_and_fails_health(openrouter, caplog, params, missing):
    openrouter(FakeOpenRouter(listed({**everything_capable(), "openai/gpt-6.1-sol": params})))
    with caplog.at_level(logging.ERROR, logger="app.model_check"):
        r = await health()
    assert r.status_code == 200
    assert r.json()["status"] == "ok" and r.json()["models_ok"] is False
    errors = [m.getMessage() for m in caplog.records if m.levelname == "ERROR"]
    assert any("JUDGE_MODEL" in e and "openai/gpt-6.1-sol" in e and missing in e for e in errors)


async def test_model_missing_from_the_list_fails_health(openrouter, caplog):
    openrouter(FakeOpenRouter(listed({"openai/gpt-6.1-terra": CAPABLE})))
    with caplog.at_level(logging.ERROR, logger="app.model_check"):
        assert (await health()).json()["models_ok"] is False
    assert any("not listed" in m.getMessage() for m in caplog.records)


@pytest.mark.parametrize(
    "fake",
    [
        FakeOpenRouter(error=httpx.ConnectError("no route to host")),
        FakeOpenRouter(error=httpx.ReadTimeout("slow")),
        FakeOpenRouter(listed({}), status=500),
    ],
)
async def test_a_failed_check_only_warns(openrouter, caplog, fake):
    openrouter(fake)
    with caplog.at_level(logging.WARNING, logger="app.model_check"):
        r = await health()
    assert r.status_code == 200 and r.json()["models_ok"] is True
    levels = {m.levelname for m in caplog.records if m.name == "app.model_check"}
    assert levels == {"WARNING"}


@pytest.mark.parametrize("data", [[{"no_id_here": True}], [], None])
async def test_unusable_model_list_only_warns(openrouter, caplog, data):
    openrouter(FakeOpenRouter(data))
    with caplog.at_level(logging.WARNING, logger="app.model_check"):
        assert await check_models(get_settings()) is True
    assert {m.levelname for m in caplog.records if m.name == "app.model_check"} == {"WARNING"}


async def test_missing_key_shows_in_health_without_touching_the_network(openrouter, caplog):
    openrouter(None, key="")
    with caplog.at_level(logging.ERROR, logger="app.model_check"):
        r = await health()
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "models_ok": True, "key_ok": False}
    assert any("OPENROUTER_API_KEY" in m.getMessage() for m in caplog.records)


def test_readme_gives_each_model_its_real_role_and_a_swap_note():
    readme = (Path(__file__).resolve().parents[2] / "docs" / "DEVELOPMENT.md").read_text()
    assert "| `FAST_MODEL` | `openai/gpt-6.1-terra` | Intake and repeat guards, persona |" in readme
    assert "| `AGENT_MODEL` | `openai/gpt-6.1-terra` | Critic turns, final positions, checkpoints |" in readme
    assert "supported_parameters" in readme and "models_ok" in readme


async def test_llm_call_lines_reach_stderr_without_the_key(monkeypatch, capsys):
    secret = "sk-or-not-a-real-key"
    monkeypatch.setenv("OPENROUTER_API_KEY", secret)
    get_settings.cache_clear()
    logger = logging.getLogger("app")
    monkeypatch.setattr(logging.getLogger(), "handlers", [])  # as under uvicorn
    monkeypatch.setattr(logger, "handlers", [])
    monkeypatch.setattr(logger, "level", logging.NOTSET)
    configure_logging()
    await OpenRouterGateway(StubClient(completion(json.dumps(POSITION)))).structured(
        "agent", "s", "u", FinalPosition
    )
    err = capsys.readouterr().err
    assert "llm_call" in err and "tier=agent" in err
    assert secret not in err
