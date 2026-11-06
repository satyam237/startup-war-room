"""LLM gateway. Every LLM call in the app goes through this module.

OpenRouter request/response shapes (verified against current docs, 2026-11-06):
- usage (incl. usage.cost in USD) is always returned; on streams it arrives on the
  final chunk. stream_options/usage.include are deprecated no-ops.
- reasoning: {"effort": "low"|"high"|...} as a top-level body field.
- response_format json_schema + provider.require_parameters=true.
- mid-stream errors arrive as a chunk with a top-level `error` and finish_reason "error"
  (HTTP status stays 200).
"""

import json
import logging
import time
from collections.abc import AsyncIterator, Callable
from typing import Any, Literal, Protocol, TypeVar

import openai
from openai import AsyncOpenAI
from pydantic import BaseModel, ValidationError

from app.config import get_settings

logger = logging.getLogger("app.llm")

Tier = Literal["fast", "agent", "judge", "escalation"]
T = TypeVar("T", bound=BaseModel)

TIMEOUTS_S: dict[str, float] = {"fast": 15, "agent": 45, "judge": 120, "escalation": 120}
REASONING_EFFORT: dict[str, str] = {
    "fast": "low",
    "agent": "low",
    "judge": "high",
    "escalation": "high",
}
# Agent turns are ~600 visible tokens; headroom is left because reasoning tokens
# count against the limit.
MAX_TOKENS: dict[str, int] = {"fast": 1000, "agent": 1500, "judge": 16000, "escalation": 16000}


class Usage(BaseModel):
    model: str
    tokens_in: int
    tokens_out: int
    cost_usd: float
    latency_ms: int


class LLMError(Exception):
    pass


class LLMRefusal(LLMError):
    pass


class LLMGateway(Protocol):
    def stream_text(
        self, tier: Tier, system: str, user: str, on_usage: Callable[[Usage], None]
    ) -> AsyncIterator[str]: ...

    async def structured(
        self, tier: Tier, system: str, user: str, schema: type[T]
    ) -> tuple[T, Usage]: ...


def _model_for(tier: str) -> str:
    return getattr(get_settings(), f"{tier.upper()}_MODEL")


def strict_json_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Make a Pydantic JSON schema strict-mode friendly: every object closed, all keys required."""

    def walk(node: Any) -> Any:
        if isinstance(node, dict):
            out = {k: walk(v) for k, v in node.items()}
            if out.get("type") == "object" and isinstance(out.get("properties"), dict):
                out["additionalProperties"] = False
                out["required"] = list(out["properties"])
            return out
        if isinstance(node, list):
            return [walk(v) for v in node]
        return node

    return walk(schema)


def _extra(obj: Any, key: str) -> Any:
    """Read a field the SDK does not model (OpenRouter extensions) from a pydantic object."""
    if obj is None:
        return None
    val = (getattr(obj, "model_extra", None) or {}).get(key)
    return val if val is not None else getattr(obj, key, None)


def _usage_from(
    raw: Any, model: str, started: float, tier: str
) -> Usage:
    cost = _extra(raw, "cost")
    if cost is None:
        logger.warning("llm_missing_cost model=%s tier=%s", model, tier)
        cost = 0.0
    usage = Usage(
        model=model,
        tokens_in=int(getattr(raw, "prompt_tokens", 0) or 0),
        tokens_out=int(getattr(raw, "completion_tokens", 0) or 0),
        cost_usd=float(cost),
        latency_ms=int((time.monotonic() - started) * 1000),
    )
    logger.info(
        "llm_call model=%s tier=%s tokens_in=%d tokens_out=%d cost_usd=%.6f latency_ms=%d",
        usage.model, tier, usage.tokens_in, usage.tokens_out, usage.cost_usd, usage.latency_ms,
    )
    return usage


def _map_sdk_error(exc: Exception) -> LLMError:
    # Most specific first.
    if isinstance(exc, openai.RateLimitError):
        return LLMError(f"rate limited by provider: {exc}")
    if isinstance(exc, openai.APITimeoutError):
        return LLMError(f"request timed out: {exc}")
    if isinstance(exc, openai.APIConnectionError):
        return LLMError(f"connection error: {exc}")
    if isinstance(exc, openai.APIStatusError):
        return LLMError(f"provider returned HTTP {exc.status_code}: {exc}")
    if isinstance(exc, openai.OpenAIError):
        return LLMError(f"provider error: {exc}")
    return LLMError(f"unexpected LLM failure: {exc}")


def _check_midstream_error(chunk: Any) -> None:
    err = _extra(chunk, "error")
    if err:
        msg = err.get("message") if isinstance(err, dict) else str(err)
        raise LLMError(f"error mid-stream: {msg}")


class OpenRouterGateway:
    def __init__(self, client: AsyncOpenAI | None = None) -> None:
        if client is None:
            s = get_settings()
            if not s.OPENROUTER_API_KEY:
                raise LLMError("OPENROUTER_API_KEY is not set")
            client = AsyncOpenAI(
                base_url=s.OPENROUTER_BASE_URL,
                api_key=s.OPENROUTER_API_KEY,
                max_retries=2,
                default_headers={"X-Title": "Startup War Room"},
            )
        self._client = client

    def _request(self, tier: str, system: str, user: str) -> dict[str, Any]:
        return {
            "model": _model_for(tier),
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "max_tokens": MAX_TOKENS[tier],
            "timeout": TIMEOUTS_S[tier],
            "extra_body": {"reasoning": {"effort": REASONING_EFFORT[tier]}},
        }

    async def stream_text(
        self, tier: Tier, system: str, user: str, on_usage: Callable[[Usage], None]
    ) -> AsyncIterator[str]:
        req = self._request(tier, system, user)
        started = time.monotonic()
        raw_usage = None
        try:
            stream = await self._client.chat.completions.create(stream=True, **req)
            async for chunk in stream:
                _check_midstream_error(chunk)
                if getattr(chunk, "usage", None):
                    raw_usage = chunk.usage
                for choice in chunk.choices or []:
                    if getattr(choice.delta, "refusal", None):
                        raise LLMRefusal(f"model refused: {choice.delta.refusal}")
                    if choice.finish_reason == "content_filter":
                        raise LLMRefusal("response blocked by content filter")
                    if choice.finish_reason == "error":
                        raise LLMError("stream ended with finish_reason=error")
                    if choice.delta.content:
                        yield choice.delta.content
        except LLMError:
            raise
        except Exception as exc:  # noqa: BLE001 - mapped below
            raise _map_sdk_error(exc) from exc
        on_usage(_usage_from(raw_usage, req["model"], started, tier))

    async def structured(
        self, tier: Tier, system: str, user: str, schema: type[T]
    ) -> tuple[T, Usage]:
        req = self._request(tier, system, user)
        req["response_format"] = {
            "type": "json_schema",
            "json_schema": {
                "name": schema.__name__,
                "strict": True,
                "schema": strict_json_schema(schema.model_json_schema()),
            },
        }
        req["extra_body"]["provider"] = {"require_parameters": True}
        started = time.monotonic()
        try:
            resp = await self._client.chat.completions.create(**req)
        except Exception as exc:  # noqa: BLE001
            raise _map_sdk_error(exc) from exc
        err = _extra(resp, "error")
        if err:
            raise LLMError(f"provider error: {err}")
        if not resp.choices:
            raise LLMError("provider returned no choices")
        choice = resp.choices[0]
        if choice.finish_reason == "content_filter" or getattr(choice.message, "refusal", None):
            raise LLMRefusal(choice.message.refusal or "response blocked by content filter")
        if choice.finish_reason == "length":
            raise LLMError("structured output truncated (finish_reason=length)")
        try:
            obj = schema.model_validate_json(choice.message.content or "")
        except ValidationError as exc:
            raise LLMError(f"structured output failed validation: {exc}") from exc
        return obj, _usage_from(resp.usage, req["model"], started, tier)


def get_gateway() -> LLMGateway:
    provider = get_settings().LLM_PROVIDER
    if provider == "fake":
        from app.fake_llm import FakeGateway

        return FakeGateway()
    if provider == "openrouter":
        return OpenRouterGateway()
    raise LLMError(f"unknown LLM_PROVIDER: {provider!r}")
