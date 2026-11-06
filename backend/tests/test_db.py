import pytest
from pydantic import ValidationError

from app import db
from app.models import FinalPosition, ScoreItem, Verdict


def _verdict() -> Verdict:
    item = {"score": 7, "why": "because"}
    return Verdict(
        recommendation="pivot",
        confidence=0.6,
        scorecard={
            k: item for k in ("market", "customer_pull", "feasibility", "defensibility", "timing")
        },
        risks=[{"rank": 1, "risk": "r", "severity": "high", "raised_by": "vc"}],
        experiments=[
            {"test": "t", "timebox_days": 7, "success_criteria": "s", "kill_criteria": "k"}
        ],
        one_line_summary="sum",
    )


async def test_debate_round_trip():
    await db.create_debate("d1", "my pitch " * 10, {"stage": "idea"}, db.hash_token("tok"))
    await db.add_turn("d1", 1, "vc", "hello", tokens_in=10, tokens_out=5)
    await db.save_verdict("d1", _verdict())
    await db.update_debate("d1", status="complete", total_tokens=15)
    await db.add_feedback("d1", 4, "nice")

    d = await db.get_debate("d1")
    assert d["pitch_meta"] == {"stage": "idea"}
    assert d["status"] == "complete" and d["total_tokens"] == 15
    assert d["delete_token_hash"] == db.hash_token("tok")
    assert [(t["agent"], t["text"], t["tokens_out"]) for t in d["turns"]] == [("vc", "hello", 5)]
    assert d["verdict"]["recommendation"] == "pivot"
    assert d["verdict"]["fallback"] is False
    assert d["verdict"]["scorecard"]["market"] == {"score": 7, "why": "because"}
    assert d["feedback"][0]["rating"] == 4

    assert await db.delete_debate("d1") is True
    assert await db.get_debate("d1") is None
    assert await db.delete_debate("d1") is False


async def test_get_debate_missing():
    assert await db.get_debate("nope") is None


async def test_mark_running_failed():
    await db.create_debate("a", "p")
    await db.create_debate("b", "p")
    await db.create_debate("c", "p")
    await db.update_debate("b", status="complete")
    await db.update_debate("c", status="budget_exceeded")
    assert await db.mark_running_failed() == 1
    statuses = {i: (await db.get_debate(i))["status"] for i in "abc"}
    assert statuses == {"a": "failed", "b": "complete", "c": "budget_exceeded"}


@pytest.mark.parametrize("bad", [0, 11, -1])
def test_scores_outside_1_to_10_rejected(bad):
    with pytest.raises(ValidationError):
        ScoreItem(score=bad, why="x")
    with pytest.raises(ValidationError):
        FinalPosition(score_1_to_10=bad, top_risk="r", change_mind_if="c")


def test_scores_boundaries_accepted():
    assert ScoreItem(score=1, why="x").score == 1
    assert FinalPosition(score_1_to_10=10, top_risk="r", change_mind_if="c").score_1_to_10 == 10
