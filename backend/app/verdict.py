"""Verdict engine: turns a finished debate into a validated Verdict.

Ladder: judge -> judge retry (errors appended) -> escalation repair -> fallback_verdict.
The one thing it raises is LLMUnavailable, because the caller must stop all LLM calls.
"""

import logging
import re
from collections.abc import Callable
from typing import Any

from app.agents import field
from app.agents.moderator import verdict_prompt
from app.agents.roster import CRITIC_ORDER, LABELS
from app.guards import UsageSink
from app.llm import LLMError, LLMGateway, LLMUnavailable
from app.models import Experiment, Risk, Scorecard, ScoreItem, Verdict

logger = logging.getLogger("app.verdict")
_CRITIC_LABELS = [LABELS[a] for a in CRITIC_ORDER]  # VC, Customer, CTO, Competitor
_CRITIC_KEYS = {k.casefold() for k in CRITIC_ORDER} | {v.casefold() for v in _CRITIC_LABELS}
_NAME_RE = re.compile(r"\b(" + "|".join(map(re.escape, _CRITIC_LABELS)) + r")\b", re.IGNORECASE)
_DIMENSIONS = ("market", "customer_pull", "feasibility", "defensibility", "timing")


def _avg(v: Verdict) -> float:
    return sum(getattr(v.scorecard, d).score for d in _DIMENSIONS) / len(_DIMENSIONS)


def check_consistency(v: Verdict) -> list[str]:
    """Return human-readable problems; an empty list means the verdict is usable."""
    errors: list[str] = []
    avg = _avg(v)
    if v.recommendation == "go" and avg < 6.0:
        errors.append(f"recommendation 'go' needs an average score >= 6.0 but the average score is {avg:.1f}")
    if v.recommendation == "no_go" and avg > 5.0:
        errors.append(f"recommendation 'no_go' needs an average score <= 5.0 but the average score is {avg:.1f}")
    if v.recommendation == "pivot" and not 3.5 <= avg <= 7.5:
        errors.append(f"recommendation 'pivot' needs an average score between 3.5 and 7.5 but the average score is {avg:.1f}")
    if not 0.0 <= v.confidence <= 1.0:
        errors.append(f"confidence must be between 0 and 1, got {v.confidence}")
    if len(v.risks) != 5:
        errors.append(f"exactly 5 risks are required, got {len(v.risks)}")
    elif sorted(r.rank for r in v.risks) != [1, 2, 3, 4, 5]:
        errors.append("risk ranks must be exactly 1, 2, 3, 4, 5 with no duplicates")
    for r in v.risks:
        if r.raised_by.strip().casefold() not in _CRITIC_KEYS:
            errors.append(f"risk {r.rank}: raised_by must be one of VC, Customer, CTO, Competitor, got '{r.raised_by}'")
    if len(v.experiments) != 3:
        errors.append(f"exactly 3 experiments are required, got {len(v.experiments)}")
    for i, e in enumerate(v.experiments, 1):
        if not e.kill_criteria.strip():
            errors.append(f"experiment {i}: kill_criteria must not be empty")
        if e.timebox_days < 1:
            errors.append(f"experiment {i}: timebox_days must be >= 1, got {e.timebox_days}")
    for d in _DIMENSIONS:
        if not _NAME_RE.search(getattr(v.scorecard, d).why):
            errors.append(f"scorecard.{d}.why must name at least one of VC, Customer, CTO, Competitor")
    return errors


def _report(on_usage: UsageSink, usage: Any) -> None:
    if on_usage is None or usage is None:
        return
    try:
        on_usage(usage)
    except Exception:  # a broken sink must never break the verdict
        logger.exception("verdict on_usage callback failed")


async def _attempt(
    gw: LLMGateway, tier: Any, system: str, user: str, on_usage: UsageSink
) -> tuple[Verdict | None, list[str]]:
    """One LLM call. Returns (verdict, errors); a gateway failure yields (None, [message])."""
    try:
        v, usage = await gw.structured(tier, system, user, Verdict, app_fields={"fallback"})
    except Exception as exc:  # LLMError or anything else; CancelledError is BaseException and propagates
        _report(on_usage, getattr(exc, "usage", None))
        if isinstance(exc, LLMUnavailable):
            raise
        if not isinstance(exc, LLMError):
            logger.exception("verdict attempt failed unexpectedly")
        return None, [f"the previous call failed: {exc}"]
    _report(on_usage, usage)
    v = v.model_copy(update={"fallback": False})  # a provider may ignore strict mode and set it
    return v, check_consistency(v)


def _with_errors(user: str, errors: list[str], previous: Verdict | None, heading: str) -> str:
    out = user + f"\n\n{heading}\n" + "\n".join(f"- {e}" for e in errors)
    if previous is not None:
        out += "\n\nThe rejected verdict was:\n" + previous.model_dump_json(exclude={"fallback"})
    return out + "\n\nReturn a corrected verdict."


async def generate_verdict(
    gw: LLMGateway,
    state: dict[str, Any],
    on_usage: UsageSink = None,
    may_continue: Callable[[], bool] = lambda: True,
) -> Verdict:
    """Returns a Verdict: validated if any rung succeeds, else fallback_verdict.

    `may_continue` is asked before every rung after the first; False ends the ladder there.
    Raises LLMUnavailable, after reporting any billed usage, and starts no further rung.
    """
    try:
        return await _ladder(gw, state, on_usage, may_continue)
    except LLMUnavailable:
        raise
    except Exception:
        logger.exception("verdict ladder failed; using fallback")
        return fallback_verdict(state)


async def _ladder(
    gw: LLMGateway, state: dict[str, Any], on_usage: UsageSink, may_continue: Callable[[], bool]
) -> Verdict:
    system, user = verdict_prompt(state)
    v, errors = await _attempt(gw, "judge", system, user, on_usage)
    if v is not None and not errors:
        return v
    if not may_continue():
        return fallback_verdict(state)
    retry_user = _with_errors(user, errors, v, "Your previous verdict was rejected for these reasons:")
    v2, errors2 = await _attempt(gw, "judge", system, retry_user, on_usage)
    if v2 is not None and not errors2:
        return v2
    if not may_continue():
        return fallback_verdict(state)
    repair_user = _with_errors(user, errors2, v2, "Two verdict attempts failed validation. Fix every problem below:")
    v3, errors3 = await _attempt(gw, "escalation", system, repair_user, on_usage)
    if v3 is not None and not errors3:
        return v3
    return fallback_verdict(state)


def _positions(state: dict[str, Any]) -> dict[str, Any]:
    """Final positions of the four critics only; tolerates malformed state."""
    fp = state.get("final_positions")
    if not isinstance(fp, dict):
        return {}
    return {a: p for a, p in fp.items() if a in CRITIC_ORDER}


def _fallback_scores(state: dict[str, Any]) -> int:
    scores: list[int] = []
    for p in _positions(state).values():
        try:
            scores.append(max(1, min(10, int(field(p, "score_1_to_10")))))
        except (TypeError, ValueError):
            continue
    return round(sum(scores) / len(scores)) if scores else 5


def _first_sentence(text: str, limit: int = 160) -> str:
    s = re.split(r"(?<=[.!?])\s", text.strip(), maxsplit=1)[0]
    return s[:limit]


def _fallback_risks(state: dict[str, Any]) -> list[Risk]:
    found: list[tuple[str, str]] = []  # (agent label, text)
    for agent, pos in _positions(state).items():
        if field(pos, "top_risk"):
            found.append((LABELS[agent], str(field(pos, "top_risk"))))
    transcript = state.get("transcript")
    for t in transcript if isinstance(transcript, list) else []:
        agent, text = field(t, "agent"), field(t, "text")
        if agent in CRITIC_ORDER and text and len(found) < 5:
            found.append((LABELS[agent], _first_sentence(str(text))))
    generic = ["Market size is unproven", "Customer willingness to pay is untested",
               "Build scope may exceed what a small team can ship",
               "Incumbents could copy the core feature", "Distribution channel is unproven"]
    for i, g in enumerate(generic):
        if len(found) >= 5:
            break
        found.append((_CRITIC_LABELS[i % 4], g))
    return [
        Risk(rank=i, risk=text, severity="high" if i <= 2 else "med", raised_by=who)
        for i, (who, text) in enumerate(found[:5], 1)
    ]


def _fallback_experiments(state: dict[str, Any]) -> list[Experiment]:
    conditions = [
        str(field(p, "change_mind_if"))
        for p in _positions(state).values()
        if field(p, "change_mind_if")
    ]
    defaults = [
        "Interview 10 target customers about their current workaround",
        "Run a landing page with a price and measure signups",
        "Get 3 prospects to sign a letter of intent",
    ]
    tests = (conditions + defaults)[:3]
    return [
        Experiment(
            test=t,
            timebox_days=7,
            success_criteria="At least 5 of 10 prospects show clear demand",
            kill_criteria="Fewer than 2 of 10 prospects show demand after 7 days",
        )
        for t in tests
    ]


def fallback_verdict(state: dict[str, Any]) -> Verdict:
    """A partial verdict built without an LLM. Always passes check_consistency."""
    try:
        v = _build_fallback(state)
        if not check_consistency(v):
            return v
        logger.error("fallback verdict failed consistency; using minimal fallback")
    except Exception:
        logger.exception("fallback verdict failed on malformed state; using minimal fallback")
    return _minimal_fallback()


def _minimal_fallback() -> Verdict:
    why = "No analysis available; VC, Customer, CTO and Competitor views were not synthesised."
    return Verdict(
        recommendation="pivot",
        confidence=0.1,
        scorecard=Scorecard(**{d: ScoreItem(score=5, why=why) for d in _DIMENSIONS}),
        risks=[
            Risk(rank=i, risk="Not assessed; the verdict is partial", severity="med", raised_by=_CRITIC_LABELS[i % 4])
            for i in range(1, 6)
        ],
        experiments=[
            Experiment(
                test="Interview 10 target customers about their current workaround",
                timebox_days=7,
                success_criteria="At least 5 of 10 show clear demand",
                kill_criteria="Fewer than 2 of 10 show demand after 7 days",
            )
            for _ in range(3)
        ],
        one_line_summary="Partial verdict: the analysis could not be completed, so this is a neutral placeholder.",
        fallback=True,
    )


def _build_fallback(state: dict[str, Any]) -> Verdict:
    s = _fallback_scores(state)
    rec = "go" if s >= 7 else "no_go" if s <= 3 else "pivot"
    had_positions = bool(_positions(state))
    basis = "the panelists' final scores" if had_positions else "neutral defaults, because no final scores were recorded"
    why = f"Estimate from {basis}; VC, Customer, CTO and Competitor views were not synthesised."
    return Verdict(
        recommendation=rec,
        confidence=0.2,
        scorecard=Scorecard(**{d: ScoreItem(score=s, why=why) for d in _DIMENSIONS}),
        risks=_fallback_risks(state),
        experiments=_fallback_experiments(state),
        one_line_summary=f"Partial verdict: the full analysis could not be completed, so this is a rough read based on {basis}.",
        fallback=True,
    )
