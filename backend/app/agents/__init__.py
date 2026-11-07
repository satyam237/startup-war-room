"""Debate agents: prompt loading and shared helpers for building user prompts."""

import json
from functools import lru_cache
from importlib import resources
from typing import Any

from app.guards import wrap_untrusted


@lru_cache(maxsize=None)
def load_prompt(name: str) -> str:
    """Read app/prompts/<name>.md once and cache it."""
    return resources.files("app").joinpath("prompts", f"{name}.md").read_text(encoding="utf-8")


def field(item: Any, key: str) -> Any:
    """Read a key from a dict or an attribute from a model (transcript turns can be either)."""
    return item.get(key) if isinstance(item, dict) else getattr(item, key, None)


def transcript_text(transcript: list[Any], labels: dict[str, str]) -> str:
    return "\n".join(
        f"[round {field(t, 'round')}] {labels.get(field(t, 'agent'), field(t, 'agent'))}: {field(t, 'text')}"
        for t in transcript
    )


def pitch_blocks(state: dict[str, Any]) -> list[str]:
    """Pitch and optional metadata, wrapped as untrusted data."""
    blocks = [wrap_untrusted("pitch", state["pitch"])]
    if state.get("pitch_meta"):
        blocks.append(
            wrap_untrusted("pitch_meta", json.dumps(state["pitch_meta"], ensure_ascii=False, default=str))
        )
    return blocks


def persona_block(state: dict[str, Any]) -> list[str]:
    if not state.get("customer_persona"):
        return []
    return [wrap_untrusted("customer_persona", json.dumps(state["customer_persona"], ensure_ascii=False, default=str))]


def competitors_block(state: dict[str, Any]) -> list[str]:
    if not state.get("competitors"):
        return []
    return [wrap_untrusted("competitors", "\n".join(f"- {c}" for c in state["competitors"]))]


def debate_blocks(state: dict[str, Any], labels: dict[str, str]) -> list[str]:
    blocks: list[str] = []
    if state.get("transcript"):
        blocks.append(wrap_untrusted("transcript", transcript_text(state["transcript"], labels)))
    if state.get("moderator_notes"):
        blocks.append(wrap_untrusted("moderator_notes", "\n".join(f"- {n}" for n in state["moderator_notes"])))
    if state.get("rebuttal"):
        blocks.append(wrap_untrusted("founder_rebuttal", state["rebuttal"]))
    return blocks
