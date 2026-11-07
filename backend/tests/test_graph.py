import asyncio
from typing import Any

import pytest
from langgraph.checkpoint.memory import InMemorySaver

from app.agents.moderator import Checkpoint
from app.agents.persona import _PersonaOut
from app.agents.roster import CRITIC_ORDER
from app import graph as graph_module
from app.config import get_settings
from app.events import EventLog
from app.fake_llm import FakeGateway
from app.graph import (
    Deps,
    InMemoryStore,
    build_graph,
    initial_state,
    pending_rebuttal,
    resume_command,
)
from app.guards import _RepeatVerdict
from app.llm import LLMError, Usage
from app.models import FinalPosition, Verdict
from app.verdict import fallback_verdict

PITCH = "An app that matches freelance designers with early-stage startups for fixed-price sprints."
META = {"target_user": "seed-stage founders", "pricing": "15% take rate", "stage": "prototype"}


def good_verdict() -> Verdict:
    return fallback_verdict({}).model_copy(update={"fallback": False})


def is_critic(call: dict[str, Any]) -> bool:
    return "stress-testing a startup idea" in call["system"]


def in_round(call: dict[str, Any], n: int) -> bool:
    return is_critic(call) and f"This turn is Round {n}." in call["system"]


def is_verdict(call: dict[str, Any]) -> bool:
    return call["schema"] is Verdict


def default_script(call: dict[str, Any]) -> Any:
    return good_verdict() if is_verdict(call) else None


class Rig:
    """One debate wired to a FakeGateway and an in-memory store."""

    def __init__(self, gw: FakeGateway | None = None, clock: Any = None, **settings: Any) -> None:
        self.gw = gw or FakeGateway(default_script)
        self.log = EventLog()
        self.store = InMemoryStore()
        # No reserve unless a test asks: most tests here pin the behaviour at a single cap.
        self.settings = get_settings().model_copy(update={"JUDGE_TOKEN_RESERVE": 0, **settings})
        kwargs = {"clock": clock} if clock else {}
        self.deps = Deps(gw=self.gw, log=self.log, settings=self.settings, store=self.store, **kwargs)
        self.graph = build_graph(self.deps, InMemorySaver())
        self.config = {"configurable": {"thread_id": "d1"}}

    async def run(self, rebuttal: str | None = None) -> dict[str, Any]:
        """Same loop as the Task 7 runner: publish await_rebuttal on interrupt, then resume."""
        result = await self.graph.ainvoke(initial_state("d1", PITCH, META, self.settings), self.config)
        while (payload := pending_rebuttal(result)) is not None:
            self.log.publish("await_rebuttal", payload)
            result = await self.graph.ainvoke(resume_command(rebuttal), self.config)
        self.log.close()
        return result

    def events(self) -> list[tuple[str, dict[str, Any]]]:
        return [(e.event, e.data) for e in self.log._events]

    def named(self, name: str) -> list[dict[str, Any]]:
        return [d for n, d in self.events() if n == name]

    def calls(self, pred: Any) -> list[dict[str, Any]]:
        return [c for c in self.gw.calls if pred(c)]


def collapse(names: list[str]) -> list[str]:
    out: list[str] = []
    for n in names:
        if not out or out[-1] != n:
            out.append(n)
    return out


async def test_full_debate_event_order():
    rig = Rig()
    result = await rig.run("We have 40 paying customers.")
    names = [n for n, _ in rig.events()]
    critic_round = ["turn_start", "turn_token", "turn_end"] * 4
    final_round = ["turn_start", "turn_end"] * 4
    assert collapse(names) == (
        ["setup"]
        + critic_round
        + ["checkpoint", "await_rebuttal", "rebuttal_received"]
        + critic_round
        + ["checkpoint"]
        + final_round
        + ["verdict", "done"]
    )
    assert [d["step"] for d in rig.named("setup")] == ["persona", "persona", "competitors", "ready"]
    assert rig.named("done") == [{"status": "complete"}]
    assert result["status"] == "complete"
    assert rig.named("verdict")[0]["fallback"] is False


async def test_exactly_14_turns():
    rig = Rig()
    result = await rig.run()
    assert len(rig.named("turn_end")) == 12
    assert len(rig.named("checkpoint")) == 2
    assert result["budget"]["turns_used"] == 14
    assert len(result["transcript"]) == 12
    assert result["status"] == "complete"
    assert len(rig.store.turns) == 14


async def test_speaking_order_vc_customer_cto_competitor():
    rig = Rig()
    await rig.run()
    spoken = [(d["round"], d["agent"]) for d in rig.named("turn_end")]
    assert spoken == [(r, a) for r in (1, 2, 3) for a in CRITIC_ORDER]


async def test_turn_payloads_match_the_contract():
    rig = Rig()
    result = await rig.run()
    start = rig.named("turn_start")[0]
    assert start == {"turn_id": "r1-vc", "agent": "vc", "round": 1, "attempt": 1}
    token = rig.named("turn_token")[0]
    assert set(token) == {"turn_id", "text"}
    end = rig.named("turn_end")[0]
    assert set(end) == {"turn_id", "agent", "round", "text"}
    assert end["text"].startswith(token["text"])
    cp = rig.named("checkpoint")[0]
    assert set(cp) == {"round", "summary", "top_disagreements"} and len(cp["top_disagreements"]) == 2
    assert rig.named("await_rebuttal") == [{"timeout_s": rig.settings.REBUTTAL_TIMEOUT_S}]
    assert rig.named("verdict")[0] == result["verdict"]
    assert Verdict.model_validate(result["verdict"]).fallback is False


async def test_round_3_is_structured_with_no_tokens_and_fills_final_positions():
    rig = Rig()
    result = await rig.run()
    assert not [d for d in rig.named("turn_token") if d["turn_id"].startswith("r3-")]
    calls = rig.calls(lambda c: in_round(c, 3))
    assert [c["kind"] for c in calls] == ["structured"] * 4
    assert all(c["schema"] is FinalPosition for c in calls)
    assert set(result["final_positions"]) == set(CRITIC_ORDER)
    end = [d for d in rig.named("turn_end") if d["round"] == 3][0]
    position = end["final_position"]
    assert FinalPosition.model_validate(position)
    assert str(position["score_1_to_10"]) in end["text"] and position["top_risk"] in end["text"]


async def test_no_repeat_check_in_round_3():
    rig = Rig()
    await rig.run()
    repeats = rig.calls(lambda c: c["schema"] is _RepeatVerdict)
    assert len(repeats) == 7  # rounds 1 and 2, minus the first turn with nothing earlier


async def test_repeat_triggers_reset_and_regeneration_once():
    def script(call):
        if call["schema"] is _RepeatVerdict:
            return {"repeat": "<new_turn>\nsame point" in call["user"]}
        if in_round(call, 2) and "You are the CTO" in call["user"]:
            return "second try" if "make a new point" in call["user"].lower() else "same point"
        return default_script(call)

    rig = Rig(FakeGateway(script))
    result = await rig.run()
    assert rig.named("turn_reset") == [{"turn_id": "r2-cto", "reason": "repetition"}]
    cto_starts = [d["attempt"] for d in rig.named("turn_start") if d["turn_id"] == "r2-cto"]
    assert cto_starts == [1, 2]
    cto_calls = rig.calls(lambda c: in_round(c, 2) and "You are the CTO" in c["user"])
    assert len(cto_calls) == 2
    assert [d["text"] for d in rig.named("turn_end") if d["turn_id"] == "r2-cto"] == ["second try"]
    assert result["budget"]["turns_used"] == 14


async def test_regenerated_turn_is_accepted_even_if_it_repeats():
    def script(call):
        if call["schema"] is _RepeatVerdict:
            return {"repeat": True}
        return default_script(call)

    rig = Rig(FakeGateway(script))
    await rig.run()
    # Seven checked turns, each reset once and never re-checked after regeneration.
    assert len(rig.named("turn_reset")) == 7
    assert len(rig.calls(lambda c: c["schema"] is _RepeatVerdict)) == 7
    assert len(rig.named("turn_end")) == 12


async def test_failed_regeneration_keeps_the_original_text():
    def regen_fails(call):
        return "make a new point" in call["user"].lower()

    def script(call):
        if call["schema"] is _RepeatVerdict:
            return {"repeat": True}
        if call["kind"] == "stream":
            return "original draft"
        return default_script(call)

    rig = Rig(FakeGateway(script, fail_on=regen_fails))
    await rig.run()
    assert rig.named("turn_failed") == []
    assert len(rig.named("turn_reset")) == 7
    assert [d["text"] for d in rig.named("turn_end") if d["round"] < 3] == ["original draft"] * 8
    assert [t["text"] for t in rig.store.turns if t["round"] == 1 and t["agent"] != "moderator"] == ["original draft"] * 4


async def test_failed_turn_continues_with_note():
    def cto_round_1(call):
        return in_round(call, 1) and "You are the CTO" in call["user"]

    rig = Rig(FakeGateway(default_script, fail_on=cto_round_1))
    result = await rig.run()
    assert len(rig.calls(cto_round_1)) == 2  # one retry
    assert [d["attempt"] for d in rig.named("turn_start") if d["turn_id"] == "r1-cto"] == [1, 2]
    failed = rig.named("turn_failed")
    assert len(failed) == 1 and failed[0]["agent"] == "cto" and failed[0]["round"] == 1
    assert set(failed[0]) == {"agent", "round", "note"}
    assert "fake failure" not in failed[0]["note"]  # provider text stays out of the client stream
    assert result["budget"]["turns_used"] == 14
    assert len(rig.named("turn_end")) == 11
    assert result["status"] == "complete"


async def test_turn_recovers_when_the_retry_succeeds():
    seen = {"n": 0}

    def first_call_only(call):
        if in_round(call, 1) and "You are the VC" in call["user"]:
            seen["n"] += 1
            return seen["n"] == 1
        return False

    rig = Rig(FakeGateway(default_script, fail_on=first_call_only))
    await rig.run()
    assert rig.named("turn_failed") == []
    assert len(rig.named("turn_end")) == 12


async def test_failure_after_partial_stream_clears_the_text():
    class BreaksMidStream(FakeGateway):
        async def stream_text(self, tier, system, user, on_usage):
            self.calls.append({"kind": "stream", "tier": tier, "system": system, "user": user, "schema": None})
            if "This turn is Round 1." in system and "You are the VC" in user:
                yield "half a "
                raise LLMError("mid-stream")
            async for piece in super().stream_text(tier, system, user, on_usage):
                yield piece

    rig = Rig(BreaksMidStream(default_script))
    await rig.run()
    names = [n for n, _ in rig.events()]
    # The partial text is cleared before the failure note, so the client never keeps half a turn.
    assert names.index("turn_failed") - names.index("turn_reset") == 1
    assert rig.named("turn_reset") == [{"turn_id": "r1-vc", "reason": "failed"}]
    assert rig.named("turn_failed")[0]["agent"] == "vc"


async def test_round_3_failure_retries_then_continues():
    def vc_final(call):
        return in_round(call, 3) and "You are the VC" in call["user"]

    rig = Rig(FakeGateway(default_script, fail_on=vc_final))
    result = await rig.run()
    assert len(rig.calls(vc_final)) == 2
    assert set(result["final_positions"]) == {"customer", "cto", "competitor"}
    assert rig.named("turn_failed")[0]["agent"] == "vc"
    assert result["budget"]["turns_used"] == 14
    assert rig.named("verdict")[0]["fallback"] is False  # the judge still ran on three positions
    assert rig.named("done") == [{"status": "partial"}]
    assert rig.store.fields["status"] == "partial"


async def test_all_critics_refuse_still_ends_with_fallback():
    rig = Rig(FakeGateway(default_script, refuse_on=is_critic))
    result = await rig.run()
    assert len(rig.named("turn_failed")) == 12
    assert rig.named("turn_end") == []
    assert rig.calls(is_verdict) == []  # nothing to judge
    verdict = rig.named("verdict")[0]
    assert verdict["fallback"] is True
    assert Verdict.model_validate(verdict) == rig.store.verdict
    assert rig.named("done") == [{"status": "partial"}]
    assert result["budget"]["turns_used"] == 14


def after_calls(n: int) -> Any:
    """A predicate that starts refusing from the (n+1)th call."""
    seen = iter(range(10_000))
    return lambda _call: next(seen) >= n


async def test_refused_provider_before_any_critic_fails_the_debate(caplog):
    gw = FakeGateway(default_script, unavailable_on=lambda _: True)
    rig = Rig(gw)
    with caplog.at_level("ERROR", logger="app.graph"):
        result = await rig.run()
    assert len(gw.calls) == 1  # the persona call; nothing was tried after the refusal
    assert rig.named("await_rebuttal") == []
    assert rig.named("verdict") == []
    assert rig.named("error")[0]["recoverable"] is False
    assert "provider" in rig.named("error")[0]["message"]
    assert rig.named("done") == [{"status": "failed"}]
    assert rig.store.fields["status"] == "failed"
    assert rig.store.verdict is None
    assert result["status"] == "failed"
    assert any(r.levelname == "ERROR" and "HTTP 402" in r.getMessage() for r in caplog.records)


async def test_refused_provider_when_no_turn_succeeded_fails_the_debate():
    gw = FakeGateway(default_script, unavailable_on=is_critic)
    rig = Rig(gw)
    await rig.run()
    assert len(gw.calls) == 2  # the persona, then the first critic, which is not retried
    assert rig.named("turn_failed")[0]["agent"] == "vc"
    assert rig.named("await_rebuttal") == []
    assert rig.named("done") == [{"status": "failed"}]


async def test_refused_provider_after_a_turn_ends_on_a_partial_fallback():
    gw = FakeGateway(default_script, unavailable_on=after_calls(2))  # persona, vc, then refused
    rig = Rig(gw)
    await rig.run()
    assert len(gw.calls) == 3
    assert [t["agent"] for t in rig.named("turn_end")] == ["vc"]
    assert rig.named("turn_failed")[0]["agent"] == "customer"
    assert rig.named("await_rebuttal") == []
    assert rig.named("verdict")[0]["fallback"] is True
    assert rig.named("done") == [{"status": "partial"}]
    assert rig.store.verdict.fallback is True


async def test_refused_repeat_check_keeps_the_turn_and_stops():
    # persona, vc, customer, then the repeat check on the customer's turn is refused.
    gw = FakeGateway(default_script, unavailable_on=after_calls(3))
    rig = Rig(gw)
    await rig.run()
    assert len(gw.calls) == 4
    assert [t["agent"] for t in rig.named("turn_end")] == ["vc", "customer"]
    assert rig.named("done") == [{"status": "partial"}]


async def test_refused_checkpoint_stops_without_a_rebuttal_window():
    gw = FakeGateway(default_script, unavailable_on=lambda c: c["schema"] is Checkpoint)
    rig = Rig(gw)
    await rig.run()
    assert len(rig.calls(lambda c: c["schema"] is Checkpoint)) == 1
    assert rig.named("await_rebuttal") == []
    assert rig.calls(is_verdict) == []
    assert rig.named("done") == [{"status": "partial"}]


async def test_refused_final_turn_stops_the_round():
    gw = FakeGateway(default_script, unavailable_on=lambda c: in_round(c, 3))
    rig = Rig(gw)
    await rig.run()
    assert len(rig.calls(lambda c: in_round(c, 3))) == 1
    assert rig.calls(is_verdict) == []
    assert rig.named("done") == [{"status": "partial"}]


async def test_refused_judge_falls_back_as_partial():
    gw = FakeGateway(default_script, unavailable_on=is_verdict)
    rig = Rig(gw)
    await rig.run()
    assert len(rig.calls(is_verdict)) == 1
    assert rig.named("verdict")[0]["fallback"] is True
    assert rig.named("done") == [{"status": "partial"}]


async def test_budget_stop_is_not_relabelled_partial():
    rig = Rig(MAX_TURNS=6)
    await rig.run()
    assert rig.named("done") == [{"status": "budget_exceeded"}]


async def test_persona_failure_uses_neutral_default_and_continues():
    rig = Rig(FakeGateway(default_script, fail_on=lambda c: c["schema"] is _PersonaOut))
    result = await rig.run()
    assert result["competitors"] == []
    assert "seed-stage founders" in result["customer_persona"]["role"]
    assert {"name", "budget", "main_hesitation"} <= set(result["customer_persona"])
    setup = rig.named("setup")
    assert setup[-1]["step"] == "ready"
    assert any("default" in d["message"].lower() for d in setup)
    assert len(rig.named("turn_end")) == 12
    customer = rig.calls(lambda c: in_round(c, 1) and "You are the Customer" in c["user"])[0]
    assert "<customer_persona>" in customer["user"]
    competitor = rig.calls(lambda c: in_round(c, 1) and "You are the Competitor" in c["user"])[0]
    assert "<competitors>" not in competitor["user"]


async def test_checkpoint_failure_notes_moderator_and_counts_the_turn():
    def checkpoint(call):
        return call["schema"] is Checkpoint

    rig = Rig(FakeGateway(default_script, fail_on=checkpoint))
    result = await rig.run("A rebuttal.")
    failed = rig.named("turn_failed")
    assert [(d["agent"], d["round"]) for d in failed] == [("moderator", 1), ("moderator", 2)]
    assert rig.named("checkpoint") == []
    assert result["moderator_notes"] == []
    assert result["budget"]["turns_used"] == 14
    assert len(rig.calls(checkpoint)) == 4  # one retry each
    round_2 = rig.calls(lambda c: in_round(c, 2))
    assert len(round_2) == 4 and all("<moderator_notes>" not in c["user"] for c in round_2)


async def test_checkpoint_notes_reach_later_prompts():
    def script(call):
        if call["schema"] is Checkpoint:
            return {"summary": "They fight over churn.", "top_disagreements": ["pricing floor", "build vs buy"]}
        return default_script(call)

    rig = Rig(FakeGateway(script))
    result = await rig.run()
    assert "They fight over churn." in result["moderator_notes"][0]
    assert "pricing floor" in result["moderator_notes"][0]
    assert all("build vs buy" in c["user"] for c in rig.calls(lambda c: in_round(c, 2)))


async def test_token_budget_jumps_to_verdict_status_budget_exceeded():
    rig = Rig(FakeGateway(default_script, usage_per_call=(1000, 1000, 0.01)), MAX_TOKENS_PER_DEBATE=5000)
    result = await rig.run()
    assert 0 < len(rig.named("turn_end")) < 4
    assert rig.named("await_rebuttal") == []
    assert rig.named("rebuttal_received") == []
    # Hard stop: persona, VC, Customer reach 6000 tokens, and nothing at all runs after that.
    assert len(rig.gw.calls) == 3
    assert rig.calls(is_verdict) == []
    assert [d["fallback"] for d in rig.named("verdict")] == [True]
    assert rig.named("done") == [{"status": "budget_exceeded"}]
    assert result["status"] == "budget_exceeded"
    assert rig.store.fields["status"] == "budget_exceeded"


async def test_no_retry_after_the_token_cap():
    class BilledStream(FakeGateway):
        attempts = 0

        async def stream_text(self, tier, system, user, on_usage):
            if "You are the VC" in user:
                self.attempts += 1
                on_usage(Usage(model="fake", tokens_in=5000, tokens_out=0, cost_usd=0.0, latency_ms=0))
                raise LLMError("failed after billing")
            async for piece in super().stream_text(tier, system, user, on_usage):
                yield piece

    gw = BilledStream(default_script, usage_per_call=(0, 0, 0.0))
    rig = Rig(gw, MAX_TOKENS_PER_DEBATE=5000)
    await rig.run()
    assert gw.attempts == 1
    assert [d["agent"] for d in rig.named("turn_failed")] == ["vc"]
    assert [c["schema"] for c in gw.calls] == [_PersonaOut]


async def test_no_repeat_check_after_the_token_cap():
    rig = Rig(FakeGateway(default_script, usage_per_call=(1000, 1000, 0.0)), MAX_TOKENS_PER_DEBATE=4000)
    await rig.run()
    assert rig.calls(lambda c: c["schema"] is _RepeatVerdict) == []
    assert len(rig.gw.calls) == 2


async def test_no_regeneration_after_the_token_cap():
    def script(call):
        return {"repeat": True} if call["schema"] is _RepeatVerdict else default_script(call)

    # persona, VC, Customer, and the Customer's repeat check reach 8000.
    rig = Rig(FakeGateway(script, usage_per_call=(1000, 1000, 0.0)), MAX_TOKENS_PER_DEBATE=8000)
    await rig.run()
    assert len(rig.gw.calls) == 4
    assert [d["agent"] for d in rig.named("turn_end")] == ["vc", "customer"]
    assert rig.named("turn_failed") == []


async def test_no_checkpoint_retry_after_the_token_cap():
    class BilledCheckpoint(FakeGateway):
        attempts = 0

        async def structured(self, tier, system, user, schema, app_fields=None):
            if schema is Checkpoint:
                self.attempts += 1
                exc = LLMError("failed after billing")
                exc.usage = Usage(model="fake", tokens_in=5000, tokens_out=0, cost_usd=0.0, latency_ms=0)
                raise exc
            return await super().structured(tier, system, user, schema, app_fields)

    gw = BilledCheckpoint(default_script, usage_per_call=(0, 0, 0.0))
    rig = Rig(gw, MAX_TOKENS_PER_DEBATE=5000)
    await rig.run()
    assert gw.attempts == 1
    assert rig.named("done") == [{"status": "budget_exceeded"}]


async def test_verdict_ladder_stops_when_the_judge_spends_the_cap():
    def script(call):
        if is_verdict(call):
            return good_verdict().model_copy(update={"risks": []})  # fails check_consistency
        return default_script(call)

    # 22 calls before the verdict = 44000 tokens, under the cap; the first judge call reaches it.
    rig = Rig(FakeGateway(script, usage_per_call=(1000, 1000, 0.0)), MAX_TOKENS_PER_DEBATE=46000)
    await rig.run()
    assert len(rig.named("turn_end")) == 12
    assert len(rig.calls(is_verdict)) == 1
    assert rig.named("verdict")[0]["fallback"] is True
    assert rig.named("done") == [{"status": "budget_exceeded"}]


async def test_budget_exhausted_at_end_of_round_1_skips_rebuttal():
    # persona + 4 critics + 3 repeat checks = 8 calls = 16000 tokens at the end of round 1.
    rig = Rig(FakeGateway(default_script, usage_per_call=(1000, 1000, 0.0)), MAX_TOKENS_PER_DEBATE=16000)
    await rig.run()
    assert len(rig.named("turn_end")) == 4
    assert rig.named("await_rebuttal") == []
    assert rig.named("done") == [{"status": "budget_exceeded"}]


async def test_cap_reached_on_the_last_turn_skips_the_judge():
    rig = Rig(FakeGateway(default_script, usage_per_call=(1000, 1000, 0.0)), MAX_TOKENS_PER_DEBATE=44000)
    await rig.run()
    assert len(rig.named("turn_end")) == 12
    assert rig.calls(is_verdict) == []
    assert rig.named("verdict")[0]["fallback"] is True
    assert rig.named("done") == [{"status": "budget_exceeded"}]


async def test_cap_just_above_the_last_turn_still_gets_the_judge():
    rig = Rig(FakeGateway(default_script, usage_per_call=(1000, 1000, 0.0)), MAX_TOKENS_PER_DEBATE=44001)
    await rig.run()
    assert rig.named("verdict")[0]["fallback"] is False
    assert rig.named("done") == [{"status": "complete"}]


async def test_turns_stop_at_the_cap_minus_the_judge_reserve():
    # persona + vc + customer + its repeat check + cto = 5 calls = 10000 tokens: the turn budget.
    rig = Rig(
        FakeGateway(default_script, usage_per_call=(1000, 1000, 0.0)),
        MAX_TOKENS_PER_DEBATE=30000, JUDGE_TOKEN_RESERVE=20000,
    )
    await rig.run()
    assert len(rig.named("turn_end")) == 3
    assert len(rig.calls(is_verdict)) == 1  # the reserve paid for a real judge call
    assert rig.named("verdict")[0]["fallback"] is False
    assert rig.named("done") == [{"status": "budget_exceeded"}]


async def test_no_turn_retry_inside_the_judge_reserve():
    def vc_turn(call):
        return is_critic(call) and "You are the VC" in call["user"]

    class BilledFailure(FakeGateway):
        def _gate(self, call):
            self.calls.append(call)
            if vc_turn(call):
                exc = LLMError("failed after billing")
                exc.usage = Usage(model="fake", tokens_in=10000, tokens_out=0, cost_usd=0.0, latency_ms=0)
                raise exc

    gw = BilledFailure(default_script, usage_per_call=(0, 0, 0.0))
    rig = Rig(gw, MAX_TOKENS_PER_DEBATE=30000, JUDGE_TOKEN_RESERVE=20000)
    await rig.run()
    assert len(rig.calls(vc_turn)) == 1
    assert rig.named("turn_end") == []


async def test_no_repeat_check_or_regeneration_inside_the_judge_reserve():
    rig = Rig(
        FakeGateway(default_script, usage_per_call=(1000, 1000, 0.0)),
        MAX_TOKENS_PER_DEBATE=26000, JUDGE_TOKEN_RESERVE=20000,
    )
    await rig.run()  # persona + vc + customer = 6000, the turn budget, so no repeat check runs
    assert rig.calls(lambda c: c["schema"] is _RepeatVerdict) == []


async def test_no_checkpoint_retry_inside_the_judge_reserve():
    class BilledCheckpoint(FakeGateway):
        attempts = 0

        async def structured(self, tier, system, user, schema, app_fields=None):
            if schema is Checkpoint:
                self.attempts += 1
                exc = LLMError("failed after billing")
                exc.usage = Usage(model="fake", tokens_in=5000, tokens_out=0, cost_usd=0.0, latency_ms=0)
                raise exc
            return await super().structured(tier, system, user, schema, app_fields)

    gw = BilledCheckpoint(default_script, usage_per_call=(0, 0, 0.0))
    rig = Rig(gw, MAX_TOKENS_PER_DEBATE=25000, JUDGE_TOKEN_RESERVE=20000)
    await rig.run()
    assert gw.attempts == 1
    assert rig.named("verdict")[0]["fallback"] is False


async def test_judge_ladder_runs_all_rungs_inside_the_reserve():
    def script(call):
        if is_verdict(call):
            return good_verdict().model_copy(update={"risks": []})  # fails check_consistency
        return default_script(call)

    # 22 calls before the verdict = 44000 tokens: exactly the turn budget, and past the old cap.
    rig = Rig(
        FakeGateway(script, usage_per_call=(1000, 1000, 0.0)),
        MAX_TOKENS_PER_DEBATE=104000, JUDGE_TOKEN_RESERVE=60000,
    )
    await rig.run()
    assert [c["tier"] for c in rig.calls(is_verdict)] == ["judge", "judge", "escalation"]


async def test_ladder_stops_at_the_full_cap_not_the_turn_budget():
    def script(call):
        if is_verdict(call):
            return good_verdict().model_copy(update={"risks": []})
        return default_script(call)

    # Turn budget 44000; each judge call adds 2000, so the second one reaches the full cap.
    rig = Rig(
        FakeGateway(script, usage_per_call=(1000, 1000, 0.0)),
        MAX_TOKENS_PER_DEBATE=48000, JUDGE_TOKEN_RESERVE=4000,
    )
    await rig.run()
    assert len(rig.calls(is_verdict)) == 2
    assert rig.named("verdict")[0]["fallback"] is True
    assert rig.named("done") == [{"status": "budget_exceeded"}]


async def test_no_llm_call_starts_at_the_full_cap_even_with_a_reserve():
    rig = Rig(MAX_TOKENS_PER_DEBATE=100, JUDGE_TOKEN_RESERVE=50)
    state = initial_state("d1", PITCH, META, rig.settings)
    state["budget"]["tokens_used"] = 100  # intake spent it all
    await rig.graph.ainvoke(state, rig.config)
    assert rig.gw.calls == []
    assert rig.named("verdict")[0]["fallback"] is True
    assert rig.named("done") == [{"status": "budget_exceeded"}]


async def test_truncated_judge_is_not_a_budget_stop_below_the_cap():
    class TruncatedJudge(FakeGateway):
        async def structured(self, tier, system, user, schema, app_fields=None):
            if schema is Verdict:
                self.calls.append({"schema": schema, "tier": tier, "system": system, "user": user})
                exc = LLMError("structured output truncated (finish_reason=length)")
                exc.usage = Usage(model="fake", tokens_in=0, tokens_out=16000, cost_usd=0.0, latency_ms=0)
                raise exc
            return await super().structured(tier, system, user, schema, app_fields)

    gw = TruncatedJudge(default_script, usage_per_call=(1000, 1000, 0.0))
    rig = Rig(gw, MAX_TOKENS_PER_DEBATE=120000, JUDGE_TOKEN_RESERVE=60000)
    await rig.run()
    assert len(rig.calls(is_verdict)) == 3
    assert rig.named("verdict")[0]["fallback"] is True
    assert rig.named("done") != [{"status": "budget_exceeded"}]


async def test_lowered_turn_cap_jumps_to_verdict():
    rig = Rig(MAX_TURNS=6)
    result = await rig.run()
    assert result["budget"]["turns_used"] == 6
    assert rig.named("done") == [{"status": "budget_exceeded"}]


async def test_usage_is_accounted_including_failed_calls():
    usage = Usage(model="fake", tokens_in=100, tokens_out=50, cost_usd=0.25, latency_ms=0)

    class BilledFailures(FakeGateway):
        async def stream_text(self, tier, system, user, on_usage):
            if "This turn is Round 1." in system:
                on_usage(usage)  # the real gateway reports a failed stream this way
                raise LLMError("stream failed after billing")
            async for piece in super().stream_text(tier, system, user, on_usage):
                yield piece

        async def structured(self, tier, system, user, schema, app_fields=None):
            if schema is FinalPosition or schema is Checkpoint:
                exc = LLMError("structured failed after billing")
                exc.usage = usage  # ...and a failed structured call this way
                raise exc
            return await super().structured(tier, system, user, schema, app_fields)

    gw = BilledFailures(default_script, usage_per_call=(0, 0, 0.0))
    rig = Rig(gw)
    result = await rig.run()
    # Round 1: 4 critics x 2 attempts. Checkpoints: 2 x 2. Round 3: 4 x 2. 20 billed failures.
    assert result["budget"]["tokens_used"] == 20 * 150
    assert result["budget"]["cost_usd"] == pytest.approx(20 * 0.25)
    assert rig.store.fields["total_tokens"] == 20 * 150
    assert rig.store.fields["est_cost"] == pytest.approx(20 * 0.25)


async def test_turn_tokens_are_stored_per_turn():
    rig = Rig(FakeGateway(default_script, usage_per_call=(10, 5, 0.0)))
    await rig.run()
    assert rig.store.turns[0]["tokens_in"] == 10 and rig.store.turns[0]["tokens_out"] == 5
    second = rig.store.turns[1]  # the turn plus its repeat check
    assert second["tokens_in"] == 20 and second["tokens_out"] == 10


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


async def test_deadline_jumps_to_verdict():
    clock = Clock()

    def script(call):
        if in_round(call, 1) and "You are the Customer" in call["user"]:
            clock.now += 10_000
        return default_script(call)

    rig = Rig(FakeGateway(script), clock=clock, DEBATE_TIMEOUT_S=240)
    result = await rig.run()
    assert [d["agent"] for d in rig.named("turn_end")] == ["vc", "customer"]
    assert rig.named("await_rebuttal") == []
    assert rig.calls(is_verdict) == []  # no time left for the judge
    assert rig.named("verdict")[0]["fallback"] is True
    assert rig.named("done") == [{"status": "budget_exceeded"}]
    assert result["status"] == "budget_exceeded"


async def test_judge_skipped_when_it_cannot_fit():
    clock = Clock()

    def script(call):
        if in_round(call, 3) and "You are the Competitor" in call["user"]:
            clock.now += 235  # leaves 5s, far less than a judge call needs
        return default_script(call)

    rig = Rig(FakeGateway(script), clock=clock, DEBATE_TIMEOUT_S=240)
    await rig.run()
    assert len(rig.named("turn_end")) == 12
    assert rig.calls(is_verdict) == []
    assert rig.named("verdict")[0]["fallback"] is True
    assert rig.named("done") == [{"status": "budget_exceeded"}]
    assert rig.store.fields["status"] == "budget_exceeded"


async def test_judge_cut_off_at_the_deadline_falls_back(monkeypatch):
    class SlowJudge(FakeGateway):
        async def structured(self, tier, system, user, schema, app_fields=None):
            if schema is Verdict:
                await asyncio.sleep(30)
            return await super().structured(tier, system, user, schema, app_fields)

    clock = Clock()

    def script(call):
        if in_round(call, 3) and "You are the Competitor" in call["user"]:
            clock.now += 239.95  # 50ms left: too short for the judge, allowed by the zero floor
        return default_script(call)

    monkeypatch.setattr("app.graph.JUDGE_MIN_REMAINING_S", 0)
    rig = Rig(SlowJudge(script), clock=clock, DEBATE_TIMEOUT_S=240)
    await asyncio.wait_for(rig.run(), 5)
    assert rig.named("verdict")[0]["fallback"] is True
    assert rig.named("done") == [{"status": "budget_exceeded"}]


async def test_turns_stop_early_enough_for_the_judge():
    clock = Clock()

    def script(call):
        if in_round(call, 1) and "You are the Customer" in call["user"]:
            clock.now += 240 - graph_module.JUDGE_RESERVE_S  # exactly the reserve left
        return default_script(call)

    rig = Rig(FakeGateway(script), clock=clock, DEBATE_TIMEOUT_S=240)
    await rig.run()
    assert [d["agent"] for d in rig.named("turn_end")] == ["vc", "customer"]
    assert len(rig.calls(is_verdict)) == 1  # the reserve left the judge room to run
    assert rig.named("verdict")[0]["fallback"] is False
    assert rig.named("done") == [{"status": "budget_exceeded"}]


def test_reserve_leaves_more_than_the_judge_minimum():
    assert graph_module.JUDGE_RESERVE_S > graph_module.JUDGE_MIN_REMAINING_S


async def test_turn_in_progress_is_cut_off_at_the_deadline(monkeypatch):
    class Hangs(FakeGateway):
        async def stream_text(self, tier, system, user, on_usage):
            if "You are the Customer" in user:
                yield "starting "
                await asyncio.sleep(30)
            async for piece in super().stream_text(tier, system, user, on_usage):
                yield piece

    monkeypatch.setattr("app.graph.JUDGE_RESERVE_S", 0)
    rig = Rig(Hangs(default_script), DEBATE_TIMEOUT_S=0.1)
    result = await asyncio.wait_for(rig.run(), 5)
    assert rig.named("turn_failed")[0]["agent"] == "customer"
    assert rig.named("turn_reset") == [{"turn_id": "r1-customer", "reason": "failed"}]
    assert rig.named("verdict")[0]["fallback"] is True
    assert result["status"] == "budget_exceeded"


async def test_rebuttal_window_does_not_outlast_the_deadline():
    clock = Clock()

    def script(call):
        if call["schema"] is Checkpoint:
            clock.now += 230 - graph_module.JUDGE_RESERVE_S  # 10s left before the judge's reserve
        return default_script(call)

    rig = Rig(FakeGateway(script), clock=clock, DEBATE_TIMEOUT_S=240, REBUTTAL_TIMEOUT_S=45)
    await rig.run()
    assert rig.named("await_rebuttal") == [{"timeout_s": 10}]


async def test_deadline_passing_during_rebuttal_wait_jumps_to_verdict():
    clock = Clock()
    rig = Rig(clock=clock, DEBATE_TIMEOUT_S=240)
    result = await rig.graph.ainvoke(initial_state("d1", PITCH, META, rig.settings), rig.config)
    assert pending_rebuttal(result) is not None
    clock.now += 10_000
    await rig.graph.ainvoke(resume_command("Too late"), rig.config)
    assert rig.named("rebuttal_received") == [{"text": "Too late"}]
    assert not [d for d in rig.named("turn_end") if d["round"] == 2]
    assert rig.named("done") == [{"status": "budget_exceeded"}]


async def test_rebuttal_text_reaches_round2_prompts():
    rebuttal = "We already have forty paying customers on annual contracts."
    rig = Rig()
    result = await rig.run(rebuttal)
    assert rig.named("rebuttal_received") == [{"text": rebuttal}]
    assert result["rebuttal"] == rebuttal
    round_1, round_2 = rig.calls(lambda c: in_round(c, 1)), rig.calls(lambda c: in_round(c, 2))
    assert len(round_2) == 4 and all(rebuttal in c["user"] for c in round_2)
    assert not any(rebuttal in c["user"] for c in round_1)


@pytest.mark.parametrize("skip", [None, "", "   "])
async def test_skipped_rebuttal_publishes_null(skip):
    rig = Rig()
    result = await rig.run(skip)
    assert rig.named("rebuttal_received") == [{"text": None}]
    assert result["rebuttal"] is None
    assert not any("<founder_rebuttal>" in c["user"] for c in rig.calls(lambda c: in_round(c, 2)))


async def test_interrupt_is_visible_on_the_result_and_the_state():
    rig = Rig()
    result = await rig.graph.ainvoke(initial_state("d1", PITCH, META, rig.settings), rig.config)
    assert pending_rebuttal(result) == {"timeout_s": rig.settings.REBUTTAL_TIMEOUT_S}
    snapshot = await rig.graph.aget_state(rig.config)
    assert snapshot.next == ("rebuttal",)
    assert rig.named("await_rebuttal") == []  # published by the runner, not the node
    result = await rig.graph.ainvoke(resume_command(None), rig.config)
    assert pending_rebuttal(result) is None
    assert len(rig.named("rebuttal_received")) == 1  # the node re-runs on resume; this must not


async def test_store_gets_turns_verdict_and_final_fields():
    rig = Rig(FakeGateway(default_script, usage_per_call=(10, 5, 0.5)))
    result = await rig.run()
    agents = [t["agent"] for t in rig.store.turns]
    assert agents[:5] == ["vc", "customer", "cto", "competitor", "moderator"]
    assert agents.count("moderator") == 2
    assert rig.store.verdict == Verdict.model_validate(result["verdict"])
    assert rig.store.fields == {
        "status": "complete",
        "total_tokens": result["budget"]["tokens_used"],
        "est_cost": pytest.approx(result["budget"]["cost_usd"]),
    }


async def test_checkpoints_hold_only_plain_types(caplog):
    rig = Rig()
    await rig.run("A rebuttal.")  # resuming loads the checkpoint back
    assert "unregistered" not in caplog.text


async def test_pitch_stays_delimited_in_critic_prompts():
    rig = Rig()
    await rig.run()
    assert all("<pitch>" in c["user"] for c in rig.calls(is_critic))


async def test_store_gets_the_fields_a_replay_needs():
    rig = Rig()
    await rig.run()
    checkpoints = [t for t in rig.store.turns if t["agent"] == "moderator"]
    assert [t["details"] for t in checkpoints] == [
        {"top_disagreements": c["top_disagreements"]} for c in rig.named("checkpoint")
    ]
    finals = [t for t in rig.store.turns if t["round"] == 3]
    assert [t["details"] for t in finals] == [
        {"final_position": e["final_position"]} for e in rig.named("turn_end") if e["round"] == 3
    ]
    assert all(t["details"] is None for t in rig.store.turns if t["round"] < 3 and t["agent"] != "moderator")


async def test_rebuttal_text_reaches_the_store():
    rig = Rig()
    await rig.run("  We have ten paying teams.  ")
    assert rig.store.fields["rebuttal"] == "We have ten paying teams."


@pytest.mark.parametrize("skipped", [None, "", "   "])
async def test_skipped_rebuttal_writes_nothing(skipped):
    rig = Rig()
    await rig.run(skipped)
    assert "rebuttal" not in rig.store.fields


async def test_on_usage_sees_everything_the_budget_counts():
    seen: list[Usage] = []
    gw = FakeGateway(default_script, usage_per_call=(10, 5, 0.01))
    rig = Rig(gw)
    rig.deps.on_usage = seen.append
    result = await rig.run()
    assert sum(u.tokens_in + u.tokens_out for u in seen) == result["budget"]["tokens_used"]
