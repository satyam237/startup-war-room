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
REFUSED_STATUSES = (401, 402, 403)


class Usage(BaseModel):
    model: str
    tokens_in: int
    tokens_out: int
    cost_usd: float
    latency_ms: int


class LLMError(Exception):
    """Gateway failure. `usage` is set when the provider billed tokens before failing."""

    usage: "Usage | None" = None


class LLMRefusal(LLMError):
    pass


class LLMUnavailable(LLMError):
    """The provider refused the key or the account (HTTP 401, 402, 403). No call can succeed,
    so callers stop instead of retrying or failing open. The message never quotes the provider."""


class LLMGateway(Protocol):
    def stream_text(
        self, tier: Tier, system: str, user: str, on_usage: Callable[[Usage], None]
    ) -> AsyncIterator[str]: ...

    async def structured(
        self, tier: Tier, system: str, user: str, schema: type[T],
        app_fields: set[str] | None = None,
    ) -> tuple[T, Usage]: ...


def _model_for(tier: str) -> str:
    return getattr(get_settings(), f"{tier.upper()}_MODEL")


def strict_json_schema(
    schema: dict[str, Any], app_fields: set[str] | None = None
) -> dict[str, Any]:
    """Make a Pydantic JSON schema strict-mode friendly: every object closed, all keys required.

    Top-level `app_fields` are removed so the model cannot set them; Pydantic defaults apply.
    """
    if app_fields:
        schema = dict(schema)
        schema["properties"] = {
            k: v for k, v in schema.get("properties", {}).items() if k not in app_fields
        }

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
    raw: Any, model: str, started: float, tier: str, status: str = "ok"
) -> Usage:
    cost = _extra(raw, "cost")
    if cost is None:
        if raw is not None:
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
        "llm_call model=%s tier=%s status=%s tokens_in=%d tokens_out=%d cost_usd=%.6f latency_ms=%d",
        usage.model, tier, status, usage.tokens_in, usage.tokens_out, usage.cost_usd,
        usage.latency_ms,
    )
    return usage


def _refused(status: Any) -> LLMUnavailable:
    return LLMUnavailable(f"provider refused the call (HTTP {status})")


def _body_error(err: Any, label: str) -> LLMError:
    """An error delivered in a 200 response, which OpenRouter does on streams and some replies."""
    code = err.get("code") if isinstance(err, dict) else None
    if code in REFUSED_STATUSES:
        return _refused(code)
    msg = err.get("message") if isinstance(err, dict) else str(err)
    return LLMError(f"{label}: {msg}")


def _map_sdk_error(exc: Exception) -> LLMError:
    # Most specific first.
    if isinstance(exc, openai.RateLimitError):
        return LLMError(f"rate limited by provider: {exc}")
    if isinstance(exc, openai.APITimeoutError):
        return LLMError(f"request timed out: {exc}")
    if isinstance(exc, openai.APIConnectionError):
        return LLMError(f"connection error: {exc}")
    if isinstance(exc, openai.APIStatusError):
        if exc.status_code in REFUSED_STATUSES:
            return _refused(exc.status_code)
        return LLMError(f"provider returned HTTP {exc.status_code}: {exc}")
    if isinstance(exc, openai.OpenAIError):
        return LLMError(f"provider error: {exc}")
    return LLMError(f"unexpected LLM failure: {exc}")


def _check_midstream_error(chunk: Any) -> None:
    err = _extra(chunk, "error")
    if err:
        raise _body_error(err, "error mid-stream")


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
        status = "ok"
        stream = None
        truncated = False
        try:
            stream = await self._client.chat.completions.create(stream=True, **req)
            async for chunk in stream:
                if getattr(chunk, "usage", None):
                    raw_usage = chunk.usage
                _check_midstream_error(chunk)
                for choice in chunk.choices or []:
                    if getattr(choice.delta, "refusal", None):
                        raise LLMRefusal(f"model refused: {choice.delta.refusal}")
                    if choice.finish_reason == "content_filter":
                        raise LLMRefusal("response blocked by content filter")
                    if choice.finish_reason == "error":
                        raise LLMError("stream ended with finish_reason=error")
                    if choice.finish_reason == "length":
                        truncated = True  # raised after the loop: usage is on a later chunk
                    if choice.delta.content:
                        yield choice.delta.content
            if truncated:
                raise LLMError("text output truncated (finish_reason=length)")
        except LLMError:
            status = "failed"
            raise
        except GeneratorExit:
            status = "abandoned"
            raise
        except Exception as exc:  # noqa: BLE001 - mapped below
            status = "failed"
            raise _map_sdk_error(exc) from exc
        finally:
            # Paid tokens are reported on every exit path, including errors and early exit.
            usage = _usage_from(raw_usage, req["model"], started, tier, status)
            if raw_usage is not None:
                on_usage(usage)
            closer = getattr(stream, "aclose", None) or getattr(stream, "close", None)
            if closer is not None:
                try:
                    res = closer()
                    if hasattr(res, "__await__"):
                        await res
                except Exception:  # noqa: BLE001 - best-effort close
                    logger.debug("llm stream close failed", exc_info=True)

    async def structured(
        self, tier: Tier, system: str, user: str, schema: type[T],
        app_fields: set[str] | None = None,
    ) -> tuple[T, Usage]:
        req = self._request(tier, system, user)
        req["response_format"] = {
            "type": "json_schema",
            "json_schema": {
                "name": schema.__name__,
                "strict": True,
                "schema": strict_json_schema(schema.model_json_schema(), app_fields),
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
            raise _body_error(err, "provider error")
        if not resp.choices:
            raise LLMError("provider returned no choices")
        usage = _usage_from(resp.usage, req["model"], started, tier)
        choice = resp.choices[0]
        failure: LLMError | None = None
        if choice.finish_reason == "content_filter" or getattr(choice.message, "refusal", None):
            failure = LLMRefusal(choice.message.refusal or "response blocked by content filter")
        elif choice.finish_reason == "length":
            failure = LLMError("structured output truncated (finish_reason=length)")
        else:
            try:
                return schema.model_validate_json(choice.message.content or ""), usage
            except ValidationError as exc:
                failure = LLMError(f"structured output failed validation: {exc}")
                failure.__cause__ = exc
        failure.usage = usage
        raise failure


_gateway: LLMGateway | None = None
_override: LLMGateway | None = None
_cache_key: str | None = None


def set_gateway(gw: LLMGateway | None) -> None:
    """Test hook: force get_gateway() to return `gw`; None clears the override and the cache."""
    global _gateway, _override, _cache_key
    _override, _gateway, _cache_key = gw, None, None


def get_gateway() -> LLMGateway:
    global _gateway, _cache_key
    if _override is not None:
        return _override
    provider = get_settings().LLM_PROVIDER
    if _gateway is not None and _cache_key == provider:
        return _gateway
    if provider == "fake":
        from app.fake_llm import FakeGateway

        gw: LLMGateway = FakeGateway()
    elif provider == "openrouter":
        gw = OpenRouterGateway()
    else:
        raise LLMError(f"unknown LLM_PROVIDER: {provider!r}")
    _gateway, _cache_key = gw, provider
    return gw
