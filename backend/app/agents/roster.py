"""Critic roster and prompt assembly.

Each critic is a base prompt (shared contract plus the round instructions) plus one
agent-specific file. Role and incentive are filled into the base from this table.
"""

from typing import Any

from app.agents import competitors_block, debate_blocks, load_prompt, persona_block, pitch_blocks

CRITIC_ORDER: tuple[str, ...] = ("vc", "customer", "cto", "competitor")

ROSTER: dict[str, dict[str, str]] = {
    "vc": {
        "label": "VC",
        "role": "a skeptical venture capitalist",
        "incentive": "you only fund a potential 10x outcome and you hate small markets",
    },
    "customer": {
        "label": "Customer",
        "role": "the target customer described in the persona block",
        "incentive": "you want your problem solved cheaply, with the least switching pain and the lowest price",
    },
    "cto": {
        "label": "CTO",
        "role": "a pragmatic senior engineer who would have to build this",
        "incentive": "you want a small, realistic, shippable scope and no hidden technical bets",
    },
    "competitor": {
        "label": "Competitor",
        "role": "the most dangerous realistic rival of this startup",
        "incentive": "you want to protect your customers and revenue at the lowest cost to you",
    },
    "moderator": {"label": "Moderator", "role": "the moderator", "incentive": "a useful, honest debate"},
}

LABELS: dict[str, str] = {k: v["label"] for k, v in ROSTER.items()}


def _split_base() -> tuple[str, dict[int, str]]:
    """Return (shared contract, {round: instructions}) from base.md's '## Round N' sections."""
    shared, *rounds = load_prompt("base").split("\n## Round ")
    return shared.strip(), {int(r[0]): r[1:].strip() for r in rounds}


def critic_prompt(agent: str, state: dict[str, Any], round: int) -> tuple[str, str]:
    """Build (system, user) for one critic turn. Round 3 output is structured by the caller's schema."""
    if agent not in CRITIC_ORDER:
        raise ValueError(f"not a critic: {agent}")
    info = ROSTER[agent]
    shared, rounds = _split_base()
    shared = shared.replace("{{role}}", info["role"]).replace("{{incentive}}", info["incentive"])
    system = f"{shared}\n\n{load_prompt(agent).strip()}\n\nThis turn is Round {round}. {rounds[round]}"

    blocks = pitch_blocks(state)
    if agent == "customer":
        blocks += persona_block(state)
    if agent == "competitor":
        blocks += competitors_block(state)
    blocks += debate_blocks(state, LABELS)
    user = "\n".join(blocks) + f"\n\nYou are the {info['label']}. Give your Round {round} turn now."
    return system, user
