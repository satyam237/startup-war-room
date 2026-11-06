import pytest

from app.fake_llm import FakeGateway
from app.models import Verdict
from app.verdict import check_consistency, fallback_verdict, generate_verdict

CRITICS = ["VC", "Customer", "CTO", "Competitor"]


def make(scores=(7, 7, 7, 7, 7), rec="go", **over) -> Verdict:
    names = ["market", "customer_pull", "feasibility", "defensibility", "timing"]
    data = {
        "recommendation": rec,
        "confidence": 0.6,
        "scorecard": {n: {"score": s, "why": f"The {CRITICS[i % 4]} argued this."} for i, (n, s) in enumerate(zip(names, scores))},
        "risks": [
            {"rank": i + 1, "risk": f"risk {i}", "severity": "high", "raised_by": CRITICS[i % 4]}
            for i in range(5)
        ],
        "experiments": [
            {"test": f"t{i}", "timebox_days": 7, "success_criteria": "10 signups", "kill_criteria": "fewer than 3 signups"}
            for i in range(3)
        ],
        "one_line_summary": "Worth a cheap test.",
    }
    data.update(over)
    return Verdict.model_validate(data)


STATE = {
    "pitch": "An app that helps dentists reduce no-shows with SMS reminders.",
    "transcript": [{"agent": "vc", "round": 1, "text": "Market is small. Pricing is unclear."}],
    "final_positions": {
        "vc": {"score_1_to_10": 4, "top_risk": "small market", "change_mind_if": "10 paying clinics"},
        "customer": {"score_1_to_10": 6, "top_risk": "switching pain", "change_mind_if": "free import"},
    },
    "rebuttal": None,
}


def test_consistent_passes():
    assert check_consistency(make()) == []


@pytest.mark.parametrize(
    "bad",
    [
        pytest.param(make((5, 5, 5, 5, 5), "go"), id="go_with_avg_5"),
        pytest.param(make((8, 8, 8, 8, 8), "no_go"), id="no_go_with_avg_8"),
        pytest.param(make((9, 9, 9, 9, 9), "pivot"), id="pivot_avg_9"),
        pytest.param(make(risks=make().risks[:4]), id="four_risks"),
        pytest.param(make(experiments=make().experiments[:2]), id="two_experiments"),
        pytest.param(make(confidence=1.0).model_copy(update={"confidence": 1.5}), id="confidence"),
    ],
)
def test_inconsistent_fails(bad):
    assert check_consistency(bad)


def test_go_with_avg_5_fails():
    assert any("go" in e for e in check_consistency(make((5, 5, 5, 5, 5), "go")))


def test_no_go_with_avg_8_fails():
    assert check_consistency(make((8, 8, 8, 8, 8), "no_go"))


def test_four_risks_fails():
    assert any("risk" in e for e in check_consistency(make(risks=make().risks[:4])))


def test_two_experiments_fails():
    assert any("experiment" in e for e in check_consistency(make(experiments=make().experiments[:2])))


def test_why_without_agent_fails():
    v = make()
    v.scorecard.market.why = "Looks big."
    assert any("market" in e for e in check_consistency(v))


def test_rank_timebox_kill_and_raised_by_enforced():
    v = make()
    v.risks[0].rank = 2
    v.experiments[0].timebox_days = 0
    v.experiments[1].kill_criteria = "  "
    v.risks[2].raised_by = "Moderator"
    assert len(check_consistency(v)) == 4


def test_boundaries_pass():
    assert check_consistency(make((6, 6, 6, 6, 6), "go")) == []
    assert check_consistency(make((5, 5, 5, 5, 5), "no_go")) == []
    assert check_consistency(make((4, 3, 4, 3, 4), "pivot")) == []  # avg 3.6


def _scripted(replies):
    it = iter(replies)
    return FakeGateway(lambda call: next(it))


async def test_valid_first_try_forces_fallback_false():
    gw = _scripted([make().model_copy(update={"fallback": True})])
    v = await generate_verdict(gw, STATE)
    assert v.fallback is False
    assert [c["tier"] for c in gw.calls] == ["judge"]
    assert gw.calls[0]["schema"] is Verdict


async def test_retry_includes_error_text():
    gw = _scripted([make((5, 5, 5, 5, 5), "go"), make()])
    v = await generate_verdict(gw, STATE)
    assert not v.fallback
    assert [c["tier"] for c in gw.calls] == ["judge", "judge"]
    assert "average score" in gw.calls[1]["user"]
    assert "average score" not in gw.calls[0]["user"]


async def test_repair_uses_escalation_tier_after_retry():
    bad = make((5, 5, 5, 5, 5), "go")
    gw = _scripted([bad, bad, make()])
    v = await generate_verdict(gw, STATE)
    assert not v.fallback
    assert [c["tier"] for c in gw.calls] == ["judge", "judge", "escalation"]
    assert "average score" in gw.calls[2]["user"]


async def test_fallback_after_three_failures_sets_fallback_true():
    bad = make((5, 5, 5, 5, 5), "go")
    gw = _scripted([bad, bad, bad])
    v = await generate_verdict(gw, STATE)
    assert v.fallback is True
    assert len(gw.calls) == 3


async def test_gateway_errors_fall_through_and_report_usage():
    gw = FakeGateway(fail_on=lambda call: True)
    seen = []
    v = await generate_verdict(gw, STATE, on_usage=seen.append)
    assert v.fallback is True
    assert len(gw.calls) == 3


async def test_on_usage_fires_for_every_attempt():
    bad = make((5, 5, 5, 5, 5), "go")
    gw = _scripted([bad, bad, make()])
    seen = []
    await generate_verdict(gw, STATE, on_usage=seen.append)
    assert len(seen) == 3


def test_fallback_with_no_final_positions_is_valid():
    v = fallback_verdict({"pitch": "x", "transcript": [], "final_positions": {}, "rebuttal": None})
    assert v.fallback is True
    assert check_consistency(v) == []
    assert "partial" in v.one_line_summary.lower()


def test_fallback_passes_check_consistency():
    v = fallback_verdict(STATE)
    assert v.fallback is True
    assert check_consistency(v) == []
    assert v.recommendation == "pivot"  # mean of 4 and 6 is 5
    assert "partial" in v.one_line_summary.lower()


@pytest.mark.parametrize("score,rec", [(9, "go"), (6, "pivot"), (2, "no_go")])
def test_fallback_recommendation_tracks_scores(score, rec):
    state = {"pitch": "x", "final_positions": {"vc": {"score_1_to_10": score, "top_risk": "r", "change_mind_if": "c"}}}
    v = fallback_verdict(state)
    assert v.recommendation == rec
    assert check_consistency(v) == []


def test_prompt_states_exact_counts():
    from app.agents.moderator import verdict_prompt

    system, _ = verdict_prompt({"pitch": "x"})
    assert "exactly five" in system
    assert "exactly three" in system
