"""Persona builder: one-shot setup step that creates the Customer persona and names competitors."""

import json
import logging
from typing import Any

from pydantic import BaseModel, Field

from app.agents import load_prompt
from app.guards import UsageSink, wrap_untrusted
from app.llm import LLMError, LLMGateway, Usage

logger = logging.getLogger("app.agents.persona")


class Persona(BaseModel):
    name: str
    role: str
    company_context: str
    budget: str
    current_workaround: str
    switching_pain: str
    main_hesitation: str


class _PersonaOut(BaseModel):
    persona: Persona
    competitors: list[str] = Field(min_length=2, max_length=3)


class PersonaResult(BaseModel):
    persona: dict
    competitors: list[str]


def _report(on_usage: UsageSink, usage: Usage | None) -> None:
    if on_usage is not None and usage is not None:
        on_usage(usage)


async def run_persona(
    gw: LLMGateway, pitch: str, meta: dict[str, Any] | None, on_usage: UsageSink = None
) -> PersonaResult:
    """Raises LLMError (after reporting any billed usage) so the caller decides how to degrade."""
    meta_json = json.dumps(meta or {}, ensure_ascii=False, default=str)
    user = f"{wrap_untrusted('pitch', pitch)}\n{wrap_untrusted('pitch_meta', meta_json)}"
    try:
        out, usage = await gw.structured("fast", load_prompt("persona"), user, _PersonaOut)
    except LLMError as exc:
        _report(on_usage, exc.usage)
        raise
    _report(on_usage, usage)
    return PersonaResult(persona=out.persona.model_dump(), competitors=out.competitors)
