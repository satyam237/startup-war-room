import json
import logging
from types import SimpleNamespace

import httpx
import openai
import pytest
from openai.types.chat import ChatCompletion, ChatCompletionChunk

from app.config import get_settings
from app.fake_llm import FakeGateway
from app.llm import LLMError, LLMRefusal, LLMUnavailable, OpenRouterGateway, get_gateway
from app.models import FinalPosition, Verdict
from app.verdict import check_consistency

POSITION = {"score_1_to_10": 6, "top_risk": "churn", "change_mind_if": "retention data"}


class StubClient:
    """Stands in for AsyncOpenAI; records the request, returns/raises what it was given."""

    def __init__(self, result=None, exc=None):
        self.result, self.exc, self.requests = result, exc, []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    async def _create(self, **kw):
        self.requests.append(kw)
        if self.exc:
            raise self.exc
        if kw.get("stream") and not hasattr(self.result, "__aiter__"):
            return self._aiter(self.result)
        return self.result

    @staticmethod
    async def _aiter(items):
        for i in items:
            yield i


def completion(content, finish="stop", usage=True, cost=0.0123, refusal=None):
    d = {
        "id": "gen-1", "object": "chat.completion", "created": 0, "model": "m",
        "choices": [{"index": 0, "finish_reason": finish,
                     "message": {"role": "assistant", "content": content, "refusal": refusal}}],
    }
    if usage:
        d["usage"] = {"prompt_tokens": 11, "completion_tokens": 7, "total_tokens": 18}
        if cost is not None:
            d["usage"]["cost"] = cost
    return ChatCompletion.model_validate(d)


def chunk(content=None, finish=None, usage=None, error=None):
    d = {
        "id": "gen-1", "object": "chat.completion.chunk", "created": 0, "model": "m",
        "choices": [{"index": 0, "finish_reason": finish,
                     "delta": {"role": "assistant", "content": content}}],
    }
    if usage:
        d["usage"] = usage
    if error:
        d["error"] = error
    if finish == "error":  # OpenRouter-only value; the SDK builds responses unvalidated
        d["choices"][0]["finish_reason"] = "stop"
        c = ChatCompletionChunk.model_validate(d)
        c.choices[0].finish_reason = "error"
        return c
    return ChatCompletionChunk.model_validate(d)


async def collect(gw, tier="agent"):
    seen = []
    text = ""
    async for piece in gw.stream_text(tier, "sys", "usr", seen.append):
        text += piece
    return text, seen


def _status_error(cls, code):
    req = httpx.Request("POST", "http://x")
    return cls("boom", response=httpx.Response(code, request=req), body=None)


@pytest.fixture(autouse=True)
def _fresh_settings():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


async def test_tier_uses_model_from_env(monkeypatch):
    stub = StubClient(completion(json.dumps(POSITION)))
    gw = OpenRouterGateway(stub)
    monkeypatch.setenv("AGENT_MODEL", "vendor/model-a")
    get_settings.cache_clear()
    await gw.structured("agent", "s", "u", FinalPosition)
    monkeypatch.setenv("AGENT_MODEL", "vendor/model-b")
    get_settings.cache_clear()
    await gw.structured("agent", "s", "u", FinalPosition)
    assert [r["model"] for r in stub.requests] == ["vendor/model-a", "vendor/model-b"]


async def test_judge_tier_uses_high_reasoning():
    stub = StubClient(completion(json.dumps(POSITION)))
    gw = OpenRouterGateway(stub)
    await gw.structured("judge", "s", "u", FinalPosition)
    await gw.structured("agent", "s", "u", FinalPosition)
    judge, agent = stub.requests
    assert judge["extra_body"]["reasoning"] == {"effort": "high"}
    assert agent["extra_body"]["reasoning"] == {"effort": "low"}
    assert judge["max_tokens"] == 16000
    assert judge["timeout"] == 120 and agent["timeout"] == 45


async def test_structured_sends_json_schema_and_require_parameters():
    stub = StubClient(completion(json.dumps(POSITION)))
    obj, usage = await OpenRouterGateway(stub).structured("fast", "s", "u", FinalPosition)
    req = stub.requests[0]
    assert obj == FinalPosition(**POSITION)
    assert req["response_format"]["type"] == "json_schema"
    js = req["response_format"]["json_schema"]
    assert js["strict"] is True and js["name"] == "FinalPosition"
    assert js["schema"]["additionalProperties"] is False
    assert set(js["schema"]["required"]) == set(POSITION)
    assert req["extra_body"]["provider"] == {"require_parameters": True}
    assert req["timeout"] == 15


async def test_structured_invalid_json_raises_llmerror():
    for bad in ("not json", json.dumps({**POSITION, "score_1_to_10": 99})):
        gw = OpenRouterGateway(StubClient(completion(bad)))
        with pytest.raises(LLMError):
            await gw.structured("agent", "s", "u", FinalPosition)


async def test_structured_length_raises_llmerror():
    gw = OpenRouterGateway(StubClient(completion("{", finish="length")))
    with pytest.raises(LLMError):
        await gw.structured("judge", "s", "u", Verdict)


async def test_content_filter_raises_llmrefusal():
    gw = OpenRouterGateway(StubClient(completion(None, finish="content_filter")))
    with pytest.raises(LLMRefusal):
        await gw.structured("agent", "s", "u", FinalPosition)
    gw = OpenRouterGateway(StubClient([chunk("hi"), chunk(None, finish="content_filter")]))
    with pytest.raises(LLMRefusal):
        await collect(gw)
    gw = OpenRouterGateway(StubClient(completion(None, refusal="no")))
    with pytest.raises(LLMRefusal):
        await gw.structured("agent", "s", "u", FinalPosition)


async def test_rate_limit_error_maps_to_llmerror():
    gw = OpenRouterGateway(StubClient(exc=_status_error(openai.RateLimitError, 429)))
    with pytest.raises(LLMError) as ei:
        await gw.structured("agent", "s", "u", FinalPosition)
    assert not isinstance(ei.value, LLMRefusal)
    gw = OpenRouterGateway(StubClient(exc=_status_error(openai.InternalServerError, 502)))
    with pytest.raises(LLMError):
        await collect(gw)
    gw = OpenRouterGateway(StubClient(exc=openai.APITimeoutError(request=httpx.Request("POST", "http://x"))))
    with pytest.raises(LLMError):
        await collect(gw)


async def test_midstream_error_raises_llmerror():
    err = {"code": 502, "message": "upstream died"}
    gw = OpenRouterGateway(StubClient([chunk("partial "), chunk(None, finish="error", error=err)]))
    seen = []
    with pytest.raises(LLMError, match="upstream died"):
        async for p in gw.stream_text("agent", "s", "u", lambda u: None):
            seen.append(p)
    assert seen == ["partial "]


async def test_truncated_stream_raises_after_reporting_usage():
    """Usage arrives on the chunk after finish_reason, so the error has to wait for it."""
    usage = {"prompt_tokens": 5, "completion_tokens": 3, "total_tokens": 8, "cost": 0.002}
    gw = OpenRouterGateway(StubClient([chunk("cut "), chunk("off", finish="length"), chunk(None, usage=usage)]))
    text, reported = [], []
    with pytest.raises(LLMError, match="truncated"):
        async for piece in gw.stream_text("agent", "s", "u", reported.append):
            text.append(piece)
    assert text == ["cut ", "off"]
    assert [(u.tokens_in, u.tokens_out) for u in reported] == [(5, 3)]


@pytest.mark.parametrize(
    ("cls", "code"),
    [(openai.AuthenticationError, 401), (openai.APIStatusError, 402), (openai.PermissionDeniedError, 403)],
)
async def test_refused_credentials_or_credits_raise_llmunavailable(cls, code):
    gw = OpenRouterGateway(StubClient(exc=_status_error(cls, code)))
    with pytest.raises(LLMUnavailable, match=str(code)):
        await gw.structured("agent", "s", "u", FinalPosition)
    with pytest.raises(LLMUnavailable):
        await collect(gw)


async def test_other_provider_errors_are_not_llmunavailable():
    for cls, code in ((openai.RateLimitError, 429), (openai.InternalServerError, 502)):
        gw = OpenRouterGateway(StubClient(exc=_status_error(cls, code)))
        with pytest.raises(LLMError) as ei:
            await gw.structured("agent", "s", "u", FinalPosition)
        assert not isinstance(ei.value, LLMUnavailable)


async def test_midstream_402_raises_llmunavailable():
    err = {"code": 402, "message": "insufficient credits"}
    gw = OpenRouterGateway(StubClient([chunk(None, finish="error", error=err)]))
    with pytest.raises(LLMUnavailable):
        await collect(gw)


async def test_error_body_402_on_structured_raises_llmunavailable():
    reply = completion(json.dumps(POSITION))
    reply.model_extra["error"] = {"code": 402, "message": "insufficient credits"}
    gw = OpenRouterGateway(StubClient(reply))
    with pytest.raises(LLMUnavailable):
        await gw.structured("agent", "s", "u", FinalPosition)


async def test_stream_yields_text_and_reports_usage_from_final_chunk():
    usage = {"prompt_tokens": 5, "completion_tokens": 3, "total_tokens": 8, "cost": 0.002}
    gw = OpenRouterGateway(StubClient([chunk("a "), chunk("b", finish="stop"), chunk(None, finish="stop", usage=usage)]))
    text, seen = await collect(gw)
    assert text == "a b"
    assert (seen[0].tokens_in, seen[0].tokens_out, seen[0].cost_usd) == (5, 3, 0.002)


async def test_usage_cost_read_from_response():
    _, usage = await OpenRouterGateway(StubClient(completion(json.dumps(POSITION), cost=0.0123))).structured(
        "agent", "s", "u", FinalPosition
    )
    assert usage.cost_usd == 0.0123
    assert (usage.tokens_in, usage.tokens_out) == (11, 7)


async def test_missing_cost_records_zero_and_warns(caplog):
    gw = OpenRouterGateway(StubClient(completion(json.dumps(POSITION), cost=None)))
    with caplog.at_level(logging.WARNING, logger="app.llm"):
        _, usage = await gw.structured("agent", "s", "u", FinalPosition)
    assert usage.cost_usd == 0.0
    assert any("missing_cost" in r.message for r in caplog.records)


async def test_call_logs_one_structured_line(caplog):
    gw = OpenRouterGateway(StubClient(completion(json.dumps(POSITION))))
    with caplog.at_level(logging.INFO, logger="app.llm"):
        await gw.structured("agent", "s", "u", FinalPosition)
    lines = [r.message for r in caplog.records if r.message.startswith("llm_call")]
    assert len(lines) == 1
    assert all(k in lines[0] for k in ("model=", "tokens_in=", "tokens_out=", "cost_usd=", "latency_ms="))


def test_get_gateway_by_provider(monkeypatch):
    assert isinstance(get_gateway(), FakeGateway)
    monkeypatch.setenv("LLM_PROVIDER", "openrouter")
    monkeypatch.setenv("OPENROUTER_API_KEY", "")
    get_settings.cache_clear()
    with pytest.raises(LLMError):
        get_gateway()
    monkeypatch.setenv("OPENROUTER_API_KEY", "k")
    get_settings.cache_clear()
    assert isinstance(get_gateway(), OpenRouterGateway)


# ---- fake gateway ----


async def test_fake_gateway_is_deterministic():
    a, b = FakeGateway(), FakeGateway()
    ta, ua = await collect(a)
    tb, ub = await collect(b)
    assert ta == tb and ua[0] == ub[0]
    va, _ = await a.structured("judge", "s", "u", Verdict)
    vb, _ = await b.structured("judge", "s", "u", Verdict)
    assert va == vb and isinstance(va, Verdict)
    pa, _ = await a.structured("agent", "s", "u", FinalPosition)
    assert 1 <= pa.score_1_to_10 <= 10


async def test_fake_stream_differs_per_agent():
    gw = FakeGateway()
    seen = {}
    for agent in ("vc", "customer", "cto", "competitor"):
        text = ""
        async for p in gw.stream_text("agent", f"You are the {agent} critic", "pitch about drone delivery", lambda u: None):
            text += p
        seen[agent] = text
    assert len(set(seen.values())) == 4
    assert all("delivery" in t or "drone" in t for t in seen.values())


async def test_fake_failure_injection_and_script():
    with pytest.raises(LLMError):
        await collect(FakeGateway(fail_on="sys"))
    with pytest.raises(LLMRefusal):
        await FakeGateway(refuse_on=lambda c: c["kind"] == "structured").structured("agent", "s", "u", FinalPosition)
    gw = FakeGateway(script=lambda c: "scripted words" if c["kind"] == "stream" else {**POSITION, "score_1_to_10": 3})
    text, _ = await collect(gw)
    assert text == "scripted words"
    obj, _ = await gw.structured("agent", "s", "u", FinalPosition)
    assert obj.score_1_to_10 == 3


# ---- fix round 1 ----

USAGE = {"prompt_tokens": 5, "completion_tokens": 3, "total_tokens": 8, "cost": 0.002}


async def test_failed_stream_reports_usage_and_logs(caplog):
    err = {"code": 502, "message": "died"}
    bad = chunk(None, finish="error", error=err, usage=USAGE)
    gw = OpenRouterGateway(StubClient([chunk("x"), bad]))
    seen = []
    with caplog.at_level(logging.INFO, logger="app.llm"):
        with pytest.raises(LLMError):
            async for _ in gw.stream_text("agent", "s", "u", seen.append):
                pass
    assert len(seen) == 1 and seen[0].cost_usd == 0.002
    assert any("llm_call" in r.message and "status=failed" in r.message for r in caplog.records)


async def test_refused_stream_and_early_exit_report_usage():
    gw = OpenRouterGateway(StubClient([chunk("a", usage=USAGE), chunk(None, finish="content_filter")]))
    seen = []
    with pytest.raises(LLMRefusal):
        async for _ in gw.stream_text("agent", "s", "u", seen.append):
            pass
    assert len(seen) == 1
    gw = OpenRouterGateway(StubClient([chunk("a", usage=USAGE), chunk("b"), chunk("c")]))
    seen = []
    agen = gw.stream_text("agent", "s", "u", seen.append)
    async for _ in agen:
        break
    await agen.aclose()
    assert len(seen) == 1


async def test_stream_closed_on_early_exit():
    closed = []

    class S:
        def __aiter__(self):
            return self._gen()

        async def _gen(self):
            yield chunk("a", usage=USAGE)
            yield chunk("b")

        async def aclose(self):
            closed.append(True)

    gw = OpenRouterGateway(StubClient(S()))
    agen = gw.stream_text("agent", "s", "u", lambda u: None)
    async for _ in agen:
        break
    await agen.aclose()
    assert closed == [True]


async def test_structured_failures_carry_usage():
    cases = [
        (completion("not json"), LLMError),
        (completion("{", finish="length"), LLMError),
        (completion(None, finish="content_filter"), LLMRefusal),
    ]
    for resp, exc_type in cases:
        with pytest.raises(exc_type) as ei:
            await OpenRouterGateway(StubClient(resp)).structured("agent", "s", "u", FinalPosition)
        assert ei.value.usage is not None and ei.value.usage.cost_usd == 0.0123
        assert ei.value.usage.tokens_in == 11


async def test_app_fields_excluded_from_schema_and_defaulted():
    reply = Verdict.model_validate(
        __import__("app.fake_llm", fromlist=["x"]).default_object(Verdict).model_dump()
    ).model_dump(exclude={"fallback"})
    stub = StubClient(completion(json.dumps(reply)))
    gw = OpenRouterGateway(stub)
    v, _ = await gw.structured("judge", "s", "u", Verdict, app_fields={"fallback"})
    sent = stub.requests[0]["response_format"]["json_schema"]["schema"]
    assert "fallback" not in sent["properties"] and "fallback" not in sent["required"]
    assert v.fallback is False
    await gw.structured("judge", "s", "u", Verdict)
    sent2 = stub.requests[1]["response_format"]["json_schema"]["schema"]
    assert "fallback" in sent2["properties"]


async def test_fake_default_verdict_passes_consistency_and_is_deterministic():
    gw = FakeGateway()
    first, _ = await gw.structured("judge", "s", "u", Verdict, app_fields={"fallback"})
    second, _ = await gw.structured("judge", "other", "prompt", Verdict, app_fields={"fallback"})
    assert check_consistency(first) == []
    assert first == second
    assert first.fallback is False


async def test_fake_app_fields_and_usage_per_call():
    gw = FakeGateway(usage_per_call=(100, 50, 0.25))
    v, u = await gw.structured("judge", "s", "u", Verdict, app_fields={"fallback"})
    assert v.fallback is False and (u.tokens_in, u.tokens_out, u.cost_usd) == (100, 50, 0.25)
    seen = []
    async for _ in gw.stream_text("agent", "s", "u", seen.append):
        pass
    assert seen[0].cost_usd == 0.25


def test_get_gateway_cached_and_overridable():
    from app.llm import set_gateway

    assert get_gateway() is get_gateway()
    mine = FakeGateway()
    set_gateway(mine)
    assert get_gateway() is mine
    set_gateway(None)
    assert get_gateway() is not mine


async def test_fake_delay_from_settings(monkeypatch):
    import time

    monkeypatch.setenv("FAKE_DELAY_S", "0.02")
    get_settings.cache_clear()
    t = time.monotonic()
    await collect(FakeGateway())
    assert time.monotonic() - t >= 0.04
