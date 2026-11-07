"""Moderator: round checkpoints (forcing disagreements) and the verdict prompt."""

import json
from typing import Any

from pydantic import BaseModel, Field

from app.agents import competitors_block, debate_blocks, load_prompt, persona_block, pitch_blocks
from app.agents.roster import LABELS
from app.guards import UsageSink, wrap_untrusted
from app.llm import LLMError, LLMGateway, Usage


class Checkpoint(BaseModel):
    summary: str
    top_disagreements: list[str] = Field(min_length=2, max_length=2)


def _report(on_usage: UsageSink, usage: Usage | None) -> None:
    if on_usage is not None and usage is not None:
        on_usage(usage)


async def run_checkpoint(
    gw: LLMGateway, state: dict[str, Any], round: int, on_usage: UsageSink = None
) -> Checkpoint:
    """Summarise tensions after `round` and pick the two disagreements to force next.

    Raises LLMError (after reporting any billed usage); the orchestrator decides how to degrade.
    """
    blocks = pitch_blocks(state) + debate_blocks(state, LABELS)
    user = "\n".join(blocks) + f"\n\nRound {round} is complete. Write the checkpoint now."
    try:
        cp, usage = await gw.structured("agent", load_prompt("moderator"), user, Checkpoint)
    except LLMError as exc:
        _report(on_usage, exc.usage)
        raise
    _report(on_usage, usage)
    return cp


def verdict_prompt(state: dict[str, Any]) -> tuple[str, str]:
    """Build (system, user) for the final verdict; the caller supplies the Verdict schema."""
    blocks = pitch_blocks(state) + persona_block(state) + competitors_block(state) + debate_blocks(state, LABELS)
    if state.get("final_positions"):
        blocks.append(
            wrap_untrusted("final_positions", json.dumps(state["final_positions"], ensure_ascii=False, default=str))
        )
    return load_prompt("verdict"), "\n".join(blocks) + "\n\nDeliver the verdict now."
