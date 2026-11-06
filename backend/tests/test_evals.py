import asyncio
import json
import sys
from collections import Counter
from pathlib import Path

import pytest

EVALS = Path(__file__).resolve().parents[1] / "evals"
sys.path.insert(0, str(EVALS))

import report  # noqa: E402
import run_evals  # noqa: E402
from app import llm  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.llm import LLMError  # noqa: E402


def test_pitches_are_twenty_with_five_per_category_and_unique_ids():
    pitches = json.loads((EVALS / "pitches.json").read_text())
    assert len(pitches) == 20
    assert Counter(p["category"] for p in pitches) == {"strong": 5, "weak": 5, "vague": 5, "adversarial": 5}
    assert len({p["id"] for p in pitches}) == 20
    assert all(p["pitch"].strip() for p in pitches)


def canned(**over):
    base = {
        "id": "x", "category": "strong", "status": "complete", "error": None,
        "latency_s": 10.0, "tokens": 1000, "cost_usd": 0.10, "turns_used": 14,
        "fallback": False, "schema_valid": True, "consistency_errors": [],
        "repeated_turns": 0, "total_turns": 12, "turn_failed": 0,
        "cause": None, "cap_violations": [], "round1_stances": ["positive", "negative", "negative", "negative"],
    }
    base.update(over)
    return base


def test_report_metrics_on_canned_results():
    results = [
        canned(id="a", repeated_turns=1, round1_stances=["positive"] * 4),
        canned(id="b", latency_s=20.0, tokens=2000, cost_usd=0.20, consistency_errors=["avg too low"]),
        canned(id="c", latency_s=30.0, tokens=3000, cost_usd=0.30, fallback=True, schema_valid=False,
               consistency_errors=None, total_turns=10, cap_violations=["turn over 120 words"]),
        canned(id="d", status="crashed", error="LLMError: 402", latency_s=40.0, tokens=0, cost_usd=0.0,
               schema_valid=False, consistency_errors=None, total_turns=0, round1_stances=[]),
    ]
    s = report.summarize(results, provider="openrouter")
    assert s["debates"] == 4
    assert s["completion_rate"] == pytest.approx(0.75)
    assert s["fallback_count"] == 1  # reported apart, never inside schema validity
    assert s["schema_valid_rate"] == pytest.approx(0.5)
    assert s["latency_p50_s"] == 20.0 and s["latency_p95_s"] == 30.0  # crashed run excluded
    assert s["tokens_total"] == 6000 and s["tokens_mean"] == pytest.approx(1500)
    assert s["cost_total_usd"] == pytest.approx(0.6) and s["cost_mean_usd"] == pytest.approx(0.15)
    assert s["repetition_rate"] == pytest.approx(1 / 34)
    assert s["cap_violation_debates"] == 1
    assert s["consistency_rate"] == pytest.approx(0.5)  # of non-fallback verdicts
    assert s["agreement_collapse_rate"] == pytest.approx(1 / 3)  # a only, of a, b, c
    assert s["meaningful"] is True
    assert "NOT MEANINGFUL" not in report.format_report(s)


def test_fallback_verdict_is_never_schema_valid_success():
    s = report.summarize([canned(fallback=True, schema_valid=True)], provider="openrouter")
    assert s["schema_valid_rate"] == 0.0 and s["fallback_count"] == 1


def test_fake_provider_is_labelled_not_meaningful():
    s = report.summarize([canned()], provider="fake")
    assert s["meaningful"] is False
    assert "NOT MEANINGFUL for quality or cost" in report.format_report(s)


def test_report_handles_no_results():
    s = report.summarize([], provider="fake")
    assert s["debates"] == 0 and s["completion_rate"] is None
    report.format_report(s)


def test_stance_heuristic():
    assert report.stance("A strong, promising and compelling market opportunity.") == "positive"
    assert report.stance("I have serious concerns: the moat is weak and the risk is high.") == "negative"
    assert report.stance("Hello.") == "neutral"


class DeadGateway:
    """Every call fails the way an out-of-credits key does."""

    async def structured(self, *a, **k):
        raise LLMError("402 Payment Required: insufficient credits")

    async def stream_text(self, *a, **k):
        raise LLMError("402 Payment Required: insufficient credits")
        yield ""  # pragma: no cover


def test_runner_requires_flag_for_real_provider(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("LLM_PROVIDER", "openrouter")
    get_settings.cache_clear()

    class Tripwire:
        def __getattr__(self, name):
            raise AssertionError("a real provider was used without --yes-spend-money")

    llm.set_gateway(Tripwire())
    out = tmp_path / "r.json"
    code = run_evals.main(["--limit", "1", "--out", str(out)])
    assert code != 0
    assert "--yes-spend-money" in capsys.readouterr().err
    assert not out.exists()


def test_runner_with_fake_writes_results(tmp_path, capsys):
    out = tmp_path / "r.json"
    assert run_evals.main(["--limit", "2", "--concurrency", "2", "--out", str(out)]) == 0
    data = json.loads(out.read_text())
    assert data["meta"]["provider"] == "fake" and data["meta"]["status"] == "complete"
    assert data["meta"]["meaningful"] is False
    assert len(data["results"]) == 2
    r = data["results"][0]
    assert r["status"] == "complete" and r["total_turns"] > 0 and r["turns_used"] <= 14
    shown = capsys.readouterr().out
    assert shown.count("total $") >= 2  # one line per debate with a running total
    assert "NOT MEANINGFUL for quality or cost" in shown


def test_partial_results_are_written_as_it_goes(tmp_path, monkeypatch):
    sizes = []
    real = run_evals.write_results

    def spy(path, doc):
        sizes.append(len(doc["results"]))
        real(path, doc)

    monkeypatch.setattr(run_evals, "write_results", spy)
    run_evals.main(["--limit", "3", "--concurrency", "1", "--out", str(tmp_path / "r.json")])
    assert {1, 2, 3}.issubset(sizes)  # a write after every debate, not only at the end


def test_runner_stops_early_when_every_debate_fails_the_same_way(tmp_path, capsys):
    llm.set_gateway(DeadGateway())
    out = tmp_path / "r.json"
    code = run_evals.main(["--concurrency", "1", "--out", str(out)])
    data = json.loads(out.read_text())
    assert code != 0
    assert data["meta"]["status"] == "stopped" and data["meta"]["stop_reason"] == "same_failure"
    assert len(data["results"]) == run_evals.FAIL_STREAK < 20
    assert all(r["fallback"] or r["status"] != "complete" for r in data["results"])
    assert not any(r["schema_valid"] for r in data["results"])
    assert "STOPPED" in capsys.readouterr().out


def test_outage_stop_uses_the_last_three_real_causes():
    ok = canned()
    dead = canned(fallback=True, schema_valid=False, cause="LLMError: 402 Payment Required")
    assert run_evals.outage_stop([dead] * 3) == "same_failure"
    assert run_evals.outage_stop([dead, dead, ok]) is None
    other = canned(status="crashed", error="ValueError: x", fallback=False, schema_valid=False)
    assert run_evals.outage_stop([dead, dead, other]) is None
    # successes first, then the key dies: only the last three count
    assert run_evals.outage_stop([ok] * 7 + [dead] * 3) == "same_failure"
    # a fallback with no readable cause is not an outage
    unknown = canned(fallback=True, schema_valid=False)
    assert run_evals.outage_stop([unknown] * 3) is None
    over = canned(status="budget_exceeded", fallback=True, schema_valid=False, cause="LLMError: 402")
    assert run_evals.outage_stop([over] * 3) is None


def test_fits_counts_the_launching_debate():
    assert run_evals.fits(spent=0.0, inflight=0, estimate=0.4, max_spend=1.0)
    assert run_evals.fits(spent=0.0, inflight=1, estimate=0.4, max_spend=1.0)
    assert not run_evals.fits(spent=0.0, inflight=2, estimate=0.4, max_spend=1.0)  # 3 * 0.4 > 1.0
    assert not run_evals.fits(spent=0.7, inflight=0, estimate=0.4, max_spend=1.0)


def test_unrecovered_cause_only_when_the_debate_fell_back():
    item = {"id": "p", "category": "strong"}
    ok = {"status": "complete", "budget": {}, "verdict": None}
    rec = run_evals.build_record(item, [], ok, None, 1.0, 14, ["LLMError: 429 transient"])
    assert rec["cause"] is None  # a complete, non-fallback debate has no outage cause
    fell = {"status": "complete", "budget": {}, "verdict": {"fallback": True}}
    rec = run_evals.build_record(item, [], fell, None, 1.0, 14, ["LLMError: 429", "LLMError: 402"])
    assert rec["cause"] == "LLMError: 402"  # the last, not the first


async def test_recorder_forgets_errors_that_a_later_call_recovered():
    causes = []

    class Flaky:
        n = 0

        async def structured(self, *a, **k):
            Flaky.n += 1
            if Flaky.n == 1:
                raise LLMError("429 rate limited")
            return "ok"

    gw = run_evals._RecordingGateway(Flaky(), causes)
    with pytest.raises(LLMError):
        await gw.structured()
    assert causes == ["LLMError: 429 rate limited"]
    assert await gw.structured() == "ok"
    assert causes == []


def test_three_identical_budget_exceeded_debates_do_not_stop(tmp_path, monkeypatch):
    monkeypatch.setenv("MAX_TOKENS_PER_DEBATE", "500")
    get_settings.cache_clear()
    out = tmp_path / "r.json"
    assert run_evals.main(["--limit", "5", "--concurrency", "1", "--out", str(out)]) == 0
    data = json.loads(out.read_text())
    assert [r["status"] for r in data["results"]] == ["budget_exceeded"] * 5
    assert data["meta"]["stop_reason"] is None and data["meta"]["status"] == "complete"


def test_mid_run_outage_after_successes_stops(tmp_path, monkeypatch):
    calls = []
    real = run_evals.run_one

    async def dying(item):
        calls.append(item["id"])
        if len(calls) == 5:  # the key dies at the fifth debate
            llm.set_gateway(DeadGateway())
        return await real(item)

    monkeypatch.setattr(run_evals, "run_one", dying)
    out = tmp_path / "r.json"
    assert run_evals.main(["--concurrency", "1", "--out", str(out)]) == 1
    data = json.loads(out.read_text())
    assert data["meta"]["stop_reason"] == "same_failure"
    assert len(data["results"]) == 4 + run_evals.FAIL_STREAK
    assert all(r["schema_valid"] for r in data["results"][:4])
    assert "402" in data["results"][-1]["cause"]


def fake_debates(monkeypatch, costs, sleeps, start_estimate):
    """Replace run_one with canned records so costs are exact."""
    monkeypatch.setattr(run_evals, "START_ESTIMATE_USD", start_estimate)

    async def run_one(item):
        i = int(item["id"])
        await asyncio.sleep(sleeps(i))
        return canned(id=item["id"], category="strong", cost_usd=costs(i))

    monkeypatch.setattr(run_evals, "run_one", run_one)
    return [{"id": str(i), "category": "strong", "pitch": "p"} for i in range(60)]


def test_spend_stays_within_the_cap_when_cost_is_constant(tmp_path, monkeypatch):
    items = fake_debates(monkeypatch, lambda i: 0.4, lambda i: 0.01, start_estimate=0.4)
    out = tmp_path / "r.json"
    doc = asyncio.run(run_evals.run_all(items, 3, 1.0, out, "test-provider"))
    spent = sum(r["cost_usd"] for r in doc["results"])
    assert doc["meta"]["stop_reason"] == "max_spend"
    assert spent <= 1.0  # the launching debate is counted, so no overshoot at all
    assert len(doc["results"]) == 2


def test_no_false_stop_while_running_debates_may_still_leave_room(tmp_path, monkeypatch):
    # The costly debate finishes first and lifts the estimate to 2.0 while two cheap ones run.
    items = fake_debates(
        monkeypatch, lambda i: 2.0 if i == 0 else 0.125, lambda i: 0.01 if i == 0 else 0.05, start_estimate=0.5
    )
    out = tmp_path / "r.json"
    doc = asyncio.run(run_evals.run_all(items, 3, 5.0, out, "test-provider"))
    spent = sum(r["cost_usd"] for r in doc["results"])
    assert doc["meta"]["stop_reason"] == "max_spend"
    assert len(doc["results"]) >= 10  # it kept going while more debates fit
    assert spent <= 5.0 and spent + 2.0 > 5.0  # and stopped only when the next one truly would not fit
    detail = doc["meta"]["stop_detail"]
    assert f"${spent:.4f}" in detail and "$2.0000" in detail and "reached" not in detail


def test_max_spend_zero_stops_before_the_first_debate(tmp_path, monkeypatch):
    items = fake_debates(monkeypatch, lambda i: 0.1, lambda i: 0.0, start_estimate=0.5)
    doc = asyncio.run(run_evals.run_all(items, 3, 0.0, tmp_path / "r.json", "test-provider"))
    assert doc["results"] == [] and doc["meta"]["stop_reason"] == "max_spend"
    assert doc["meta"]["status"] == "stopped"


def test_fake_provider_has_no_spend_estimate(tmp_path):
    out = tmp_path / "r.json"
    assert run_evals.main(["--limit", "2", "--max-spend", "0", "--out", str(out)]) == 0
    assert len(json.loads(out.read_text())["results"]) == 2  # zero cost, so nothing to hold back
