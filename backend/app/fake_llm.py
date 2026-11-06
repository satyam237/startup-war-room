"""Deterministic offline gateway used by every test and the Playwright run."""

import asyncio
import hashlib
import re
from collections.abc import AsyncIterator, Callable
from typing import Any

from pydantic import BaseModel

from app.config import get_settings
from app.llm import LLMError, LLMRefusal, Tier, Usage
from app.models import Verdict

_VOICES = [
    "The unit economics worry me until I see retention data.",
    "As a buyer I would only switch if onboarding takes under a day.",
    "Technically this is feasible, but the data pipeline is the hard part.",
    "Incumbents can copy this feature within a quarter.",
    "The wedge is narrow, so distribution decides everything.",
    "Pricing needs a real willingness-to-pay test before scaling.",
]

Matcher = str | Callable[[dict[str, Any]], bool] | None


def _matches(m: Matcher, call: dict[str, Any]) -> bool:
    if m is None:
        return False
    if isinstance(m, str):
        return m in call["system"] or m in call["user"]
    return bool(m(call))


def _pitch_words(user: str, n: int = 3) -> list[str]:
    seen: list[str] = []
    for w in re.findall(r"[A-Za-z]{5,}", user):
        w = w.lower()
        if w not in seen:
            seen.append(w)
    return seen[:n]


def default_text(system: str, user: str) -> str:
    h = int(hashlib.sha256(system.encode()).hexdigest(), 16)
    voice = _VOICES[h % len(_VOICES)]
    words = ", ".join(_pitch_words(user)) or "this idea"
    return f"[{h % 10000:04d}] {voice} On {words}: my view stands."


def _resolve(schema: dict, defs: dict) -> dict:
    if "$ref" in schema:
        return _resolve(defs[schema["$ref"].split("/")[-1]], defs)
    return schema


def _build(schema: dict, defs: dict, name: str = "value") -> Any:
    schema = _resolve(schema, defs)
    if "const" in schema:
        return schema["const"]
    if "enum" in schema:
        return schema["enum"][0]
    for key in ("anyOf", "oneOf"):
        if key in schema:
            opts = [o for o in schema[key] if o.get("type") != "null"]
            return _build(opts[0], defs, name)
    t = schema.get("type")
    if t == "object":
        return {k: _build(v, defs, k) for k, v in schema.get("properties", {}).items()}
    if t == "array":
        return [_build(schema.get("items", {}), defs, name)] * max(1, schema.get("minItems", 1))
    if t == "string":
        return f"fake {name}"
    if t in ("integer", "number"):
        lo = schema.get("minimum", schema.get("exclusiveMinimum"))
        hi = schema.get("maximum")
        if t == "number":
            v = 0.5
            if lo is not None and v < lo:
                v = float(lo)
            if hi is not None and v > hi:
                v = float(hi)
            return v
        v = 5
        if lo is not None and v < lo:
            v = int(lo)
        if hi is not None and v > hi:
            v = int(hi)
        return v
    if t == "boolean":
        return False
    return None


_FAKE_CRITICS = ("VC", "Customer", "CTO", "Competitor")


def _fake_verdict() -> dict[str, Any]:
    """A verdict that passes check_consistency; schema-built data cannot, as it has one risk."""
    dimensions = ("market", "customer_pull", "feasibility", "defensibility", "timing")
    return {
        "recommendation": "pivot",
        "confidence": 0.5,
        "scorecard": {
            d: {"score": 5, "why": f"Fake reasoning from the {_FAKE_CRITICS[i % 4]}."}
            for i, d in enumerate(dimensions)
        },
        "risks": [
            {"rank": i, "risk": f"Fake risk {i}", "severity": "med", "raised_by": _FAKE_CRITICS[(i - 1) % 4]}
            for i in range(1, 6)
        ],
        "experiments": [
            {
                "test": f"Fake experiment {i}",
                "timebox_days": 7,
                "success_criteria": "5 of 10 prospects say yes",
                "kill_criteria": "Fewer than 2 of 10 prospects say yes",
            }
            for i in range(1, 4)
        ],
        "one_line_summary": "Fake verdict: narrow the wedge and test willingness to pay.",
        "fallback": False,
    }


def default_object(schema: type[BaseModel], app_fields: set[str] | None = None) -> BaseModel:
    js = schema.model_json_schema()
    data = _fake_verdict() if schema is Verdict else _build(js, js.get("$defs", {}))
    for k in app_fields or ():
        data.pop(k, None)  # let the model's own defaults apply
    return schema.model_validate(data)


class FakeGateway:
    """script(call) may return str (stream), BaseModel/dict (structured), or None for defaults.

    call = {"kind": "stream"|"structured", "tier", "system", "user", "schema"}.
    fail_on / refuse_on: substring of system+user, or predicate(call) -> bool.
    """

    def __init__(
        self,
        script: Callable[[dict[str, Any]], Any] | None = None,
        *,
        fail_on: Matcher = None,
        refuse_on: Matcher = None,
        delay_s: float | None = None,
        usage_per_call: tuple[int, int, float] | None = None,
    ) -> None:
        self.script = script
        self.fail_on = fail_on
        self.refuse_on = refuse_on
        self._delay_s = delay_s  # None -> settings.FAKE_DELAY_S, read per call
        self.usage_per_call = usage_per_call  # (tokens_in, tokens_out, cost_usd)
        self.calls: list[dict[str, Any]] = []

    @property
    def delay_s(self) -> float:
        return get_settings().FAKE_DELAY_S if self._delay_s is None else self._delay_s

    def _usage(self, tier: str, system: str, user: str, out: int) -> Usage:
        if self.usage_per_call:
            tin, tout, cost = self.usage_per_call
        else:
            tin, tout, cost = len((system + " " + user).split()), out, 0.0
        return Usage(model=f"fake/{tier}", tokens_in=tin, tokens_out=tout, cost_usd=cost, latency_ms=0)

    def _gate(self, call: dict[str, Any]) -> None:
        self.calls.append(call)
        if _matches(self.refuse_on, call):
            raise LLMRefusal("fake refusal")
        if _matches(self.fail_on, call):
            raise LLMError("fake failure")

    async def stream_text(
        self, tier: Tier, system: str, user: str, on_usage: Callable[[Usage], None]
    ) -> AsyncIterator[str]:
        call = {"kind": "stream", "tier": tier, "system": system, "user": user, "schema": None}
        self._gate(call)
        scripted = self.script(call) if self.script else None
        text = scripted if isinstance(scripted, str) else default_text(system, user)
        pieces = re.findall(r"\S+\s*", text)
        for piece in pieces:
            if self.delay_s:
                await asyncio.sleep(self.delay_s)
            yield piece
        on_usage(self._usage(tier, system, user, len(pieces)))

    async def structured(self, tier: Tier, system: str, user: str, schema: type[Any], app_fields: set[str] | None = None):
        call = {"kind": "structured", "tier": tier, "system": system, "user": user, "schema": schema}
        self._gate(call)
        if self.delay_s:
            await asyncio.sleep(self.delay_s)
        scripted = self.script(call) if self.script else None
        if isinstance(scripted, schema):
            obj = scripted
        elif isinstance(scripted, dict):
            obj = schema.model_validate(scripted)
        else:
            obj = default_object(schema, app_fields)
        return obj, self._usage(tier, system, user, 10)
