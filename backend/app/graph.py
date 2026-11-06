"""The debate state machine. One compiled graph drives one debate.

setup -> round_1 -> moderator_1 -> rebuttal -> round_2 -> moderator_2 -> round_3 -> verdict -> report

Any step before round_3 that exhausts the token, turn, or time budget jumps to `verdict`
with status `budget_exceeded`. The token cap is a hard stop: once reached, no further LLM
call starts, so a debate at the cap ends on `fallback_verdict`. Time works in two stages:
turns stop when only JUDGE_RESERVE_S is left, and the deadline itself cuts off whatever is
still running. Everything the client sees goes through `Deps.log`, using the SSE
contract's event names and payloads.

Two LangGraph behaviours shape the rebuttal step (langgraph 1.2.20, checked by running it):
- A node re-executes from its first line on resume, so `rebuttal` publishes nothing before
  `interrupt()`. The driver publishes `await_rebuttal`, which also means the client is only
  told to answer once the graph has really paused.
- `Command(resume=None)` is dropped as "no resume value" and crashes the run, so a skipped
  rebuttal travels as "". Always resume through `resume_command`.
"""

import asyncio
import itertools
import logging
import math
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Protocol, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Command, interrupt

from app.agents.moderator import run_checkpoint
from app.agents.persona import Persona, run_persona
from app.agents.roster import CRITIC_ORDER, LABELS, critic_prompt
from app.config import Settings
from app.events import EventLog
from app.guards import is_repeat
from app.llm import LLMError, LLMGateway, Usage
from app.models import FinalPosition, Turn, Verdict
from app.verdict import fallback_verdict, generate_verdict

logger = logging.getLogger("app.graph")

LAST_ROUND = 3
# Turns stop this long before the deadline, so the judge gets a real chance to run.
# An estimate until live debates are measured.
JUDGE_RESERVE_S = 45
# Below this, a high-effort judge call cannot realistically finish, so it is not started.
JUDGE_MIN_REMAINING_S = 20
REGENERATE_NOTE = "\n\nYour draft repeated a point already made in the debate. Make a new point."


class Budget(TypedDict):
    tokens_used: int
    max_tokens: int
    turns_used: int
    max_turns: int
    cost_usd: float


class DebateState(TypedDict):
    """Checkpointed, so it holds plain JSON types: LangGraph is deprecating loading app classes."""

    debate_id: str
    pitch: str
    pitch_meta: dict[str, Any]
    customer_persona: dict[str, Any]
    competitors: list[str]
    round: int
    transcript: list[dict[str, Any]]  # dumped Turns, critics only; checkpoints are in moderator_notes
    rebuttal: str | None
    moderator_notes: list[str]
    final_positions: dict[str, dict[str, Any]]
    verdict: dict[str, Any] | None  # dumped Verdict
    budget: Budget
    status: str  # running | complete | failed | budget_exceeded
    deadline: float | None  # on Deps.clock's timeline; set when setup starts


class DebateStore(Protocol):
    """Persistence callbacks. The signatures match app.db, so that module fits as is."""

    async def add_turn(
        self, debate_id: str, round: int, agent: str, text: str, tokens_in: int = 0, tokens_out: int = 0
    ) -> Any: ...

    async def save_verdict(self, debate_id: str, verdict: Verdict) -> None: ...

    async def update_debate(self, debate_id: str, **fields: Any) -> None: ...


@dataclass
class InMemoryStore:
    """DebateStore for tests and the terminal script."""

    turns: list[dict[str, Any]] = field(default_factory=list)
    verdict: Verdict | None = None
    fields: dict[str, Any] = field(default_factory=dict)

    async def add_turn(
        self, debate_id: str, round: int, agent: str, text: str, tokens_in: int = 0, tokens_out: int = 0
    ) -> None:
        self.turns.append(
            {"round": round, "agent": agent, "text": text, "tokens_in": tokens_in, "tokens_out": tokens_out}
        )

    async def save_verdict(self, debate_id: str, verdict: Verdict) -> None:
        self.verdict = verdict

    async def update_debate(self, debate_id: str, **fields: Any) -> None:
        self.fields.update(fields)


@dataclass
class Deps:
    gw: LLMGateway
    log: EventLog
    settings: Settings
    store: DebateStore
    clock: Callable[[], float] = time.monotonic


def initial_state(
    debate_id: str, pitch: str, pitch_meta: dict[str, Any] | None, settings: Settings
) -> DebateState:
    return DebateState(
        debate_id=debate_id,
        pitch=pitch,
        pitch_meta=pitch_meta or {},
        customer_persona={},
        competitors=[],
        round=0,
        transcript=[],
        rebuttal=None,
        moderator_notes=[],
        final_positions={},
        verdict=None,
        budget=Budget(
            tokens_used=0,
            max_tokens=settings.MAX_TOKENS_PER_DEBATE,
            turns_used=0,
            max_turns=settings.MAX_TURNS,
            cost_usd=0.0,
        ),
        status="running",
        deadline=None,
    )


def pending_rebuttal(result: dict[str, Any]) -> dict[str, Any] | None:
    """The `await_rebuttal` payload if `ainvoke` stopped at the interrupt, else None."""
    interrupts = result.get("__interrupt__")
    return interrupts[0].value if interrupts else None


def resume_command(text: str | None) -> Command:
    """Resume a paused debate. None or blank text means the founder skipped."""
    return Command(resume=text or "")


def _default_persona(meta: dict[str, Any]) -> dict[str, Any]:
    unknown = "Not stated in the pitch"
    return Persona(
        name="Typical buyer",
        role=str(meta.get("target_user") or "The target customer this pitch describes"),
        company_context=str(meta.get("stage") or unknown),
        budget=str(meta.get("pricing") or unknown),
        current_workaround=unknown,
        switching_pain=unknown,
        main_hesitation="Whether this is worth changing what already works",
    ).model_dump()


def _render_position(position: FinalPosition) -> str:
    return (
        f"Score: {position.score_1_to_10}/10\n"
        f"Top risk: {position.top_risk}\n"
        f"I would change my mind if: {position.change_mind_if}"
    )


class _Meter:
    """The one accounting path. A node works on its own copy and returns it as state."""

    def __init__(self, state: DebateState, clock: Callable[[], float]) -> None:
        self.budget = Budget(**state["budget"])
        self._deadline = state["deadline"]
        self._clock = clock
        self.turn_tokens_in = 0
        self.turn_tokens_out = 0

    def add(self, usage: Usage | None) -> None:
        if usage is None:
            return
        self.budget["tokens_used"] += usage.tokens_in + usage.tokens_out
        self.budget["cost_usd"] += usage.cost_usd
        self.turn_tokens_in += usage.tokens_in
        self.turn_tokens_out += usage.tokens_out

    def start_turn(self) -> None:
        self.budget["turns_used"] += 1
        self.turn_tokens_in = self.turn_tokens_out = 0

    def remaining_s(self) -> float:
        return self._deadline - self._clock()

    def tokens_spent(self) -> bool:
        return self.budget["tokens_used"] >= self.budget["max_tokens"]

    def exhausted(self) -> bool:
        return (
            self.tokens_spent()
            or self.budget["turns_used"] >= self.budget["max_turns"]
            or self.remaining_s() <= JUDGE_RESERVE_S
        )

    def status_after(self, state: DebateState) -> str:
        return "budget_exceeded" if self.exhausted() else state["status"]


class _Debate:
    """The graph's nodes, closed over one debate's dependencies."""

    def __init__(self, deps: Deps) -> None:
        self.deps = deps
        self.log = deps.log

    def _meter(self, state: DebateState) -> _Meter:
        return _Meter(state, self.deps.clock)

    async def setup(self, state: DebateState) -> dict[str, Any]:
        state = {**state, "deadline": self.deps.clock() + self.deps.settings.DEBATE_TIMEOUT_S}
        meter = self._meter(state)
        self.log.publish("setup", {"step": "persona", "message": "Building the customer persona."})
        try:
            async with asyncio.timeout(meter.remaining_s()):
                built = await run_persona(self.deps.gw, state["pitch"], state["pitch_meta"], on_usage=meter.add)
            persona, competitors = built.persona, built.competitors
            persona_note = "Customer persona ready."
            competitor_note = "Competitors identified."
        except (LLMError, TimeoutError) as exc:
            logger.warning("persona failed, using default debate=%s: %s", state["debate_id"], exc)
            persona, competitors = _default_persona(state["pitch_meta"]), []
            persona_note = "Could not build a persona, so the debate uses a neutral default."
            competitor_note = "No competitors were named for this debate."
        self.log.publish("setup", {"step": "persona", "message": persona_note, "persona": persona})
        self.log.publish("setup", {"step": "competitors", "message": competitor_note, "competitors": competitors})
        self.log.publish("setup", {"step": "ready", "message": "The panel is ready."})
        return {
            "deadline": state["deadline"],
            "customer_persona": persona,
            "competitors": competitors,
            "budget": meter.budget,
            "status": meter.status_after(state),
        }

    async def _with_retry(
        self,
        meter: _Meter,
        turn_id: str,
        agent: str,
        round: int,
        attempts: "itertools.count[int]",
        call: Callable[[], Awaitable[Any]],
    ) -> Any | None:
        """Announce and run `call`, retrying once on LLMError. None means no try succeeded."""
        for _ in range(2):
            if meter.tokens_spent():
                return None
            attempt = next(attempts)
            self.log.publish("turn_start", {"turn_id": turn_id, "agent": agent, "round": round, "attempt": attempt})
            try:
                return await call()
            except LLMError as exc:
                meter.add(exc.usage)
                logger.warning("turn failed turn_id=%s attempt=%d: %s", turn_id, attempt, exc)
        return None

    async def _stream(self, meter: _Meter, turn_id: str, system: str, user: str) -> str:
        pieces: list[str] = []
        async for piece in self.deps.gw.stream_text("agent", system, user, meter.add):
            pieces.append(piece)
            self.log.publish("turn_token", {"turn_id": turn_id, "text": piece})
        text = "".join(pieces)
        if not text.strip():
            raise LLMError("empty turn")
        return text

    def _turn_failed(self, agent: str, round: int) -> None:
        note = f"The {LABELS[agent]} could not respond, so the debate moved on."
        self.log.publish("turn_failed", {"agent": agent, "round": round, "note": note})

    async def _record_turn(
        self,
        meter: _Meter,
        view: dict[str, Any],
        agent: str,
        round: int,
        text: str,
        final_position: dict[str, Any] | None = None,
    ) -> None:
        tokens = meter.turn_tokens_in + meter.turn_tokens_out
        view["transcript"].append(Turn(agent=agent, round=round, text=text, tokens=tokens).model_dump(mode="json"))
        end = {"turn_id": f"r{round}-{agent}", "agent": agent, "round": round, "text": text}
        if final_position is not None:
            end["final_position"] = final_position
        self.log.publish("turn_end", end)
        await self.deps.store.add_turn(
            view["debate_id"], round, agent, text,
            tokens_in=meter.turn_tokens_in, tokens_out=meter.turn_tokens_out,
        )

    async def _critic_turn(self, meter: _Meter, view: dict[str, Any], agent: str, round: int) -> None:
        """A streamed turn: generate, check for repetition, and regenerate once if needed."""
        meter.start_turn()
        turn_id = f"r{round}-{agent}"
        system, user = critic_prompt(agent, view, round)
        attempts = itertools.count(1)
        text: str | None = None
        try:
            async with asyncio.timeout(meter.remaining_s()):
                text = await self._with_retry(
                    meter, turn_id, agent, round, attempts, lambda: self._stream(meter, turn_id, system, user)
                )
                earlier = [t["text"] for t in view["transcript"]]
                check = text is not None and not meter.tokens_spent()
                if check and await is_repeat(self.deps.gw, text, earlier, on_usage=meter.add):
                    self.log.publish("turn_reset", {"turn_id": turn_id, "reason": "repetition"})
                    regenerated = await self._with_retry(
                        meter, turn_id, agent, round, attempts,
                        lambda: self._stream(meter, turn_id, system, user + REGENERATE_NOTE),
                    )
                    # A repeated point is still better than a hole in the debate.
                    text = regenerated or text
        except TimeoutError:
            logger.warning("turn hit the deadline turn_id=%s", turn_id)
        if text is None:
            self.log.publish("turn_reset", {"turn_id": turn_id, "reason": "failed"})
            self._turn_failed(agent, round)
            return
        await self._record_turn(meter, view, agent, round, text)

    async def _final_turn(self, meter: _Meter, view: dict[str, Any], agent: str, round: int) -> None:
        """A Round 3 turn: structured, never streamed, and exempt from the repeat check."""
        meter.start_turn()
        system, user = critic_prompt(agent, view, round)

        async def call() -> FinalPosition:
            position, usage = await self.deps.gw.structured("agent", system, user, FinalPosition)
            meter.add(usage)
            return position

        position: FinalPosition | None = None
        try:
            async with asyncio.timeout(meter.remaining_s()):
                position = await self._with_retry(
                    meter, f"r{round}-{agent}", agent, round, itertools.count(1), call
                )
        except TimeoutError:
            logger.warning("final turn hit the deadline agent=%s", agent)
        if position is None:
            self._turn_failed(agent, round)
            return
        as_dict = position.model_dump()
        view["final_positions"][agent] = as_dict
        await self._record_turn(meter, view, agent, round, _render_position(position), as_dict)

    async def _round(
        self,
        state: DebateState,
        round: int,
        play_turn: Callable[[_Meter, dict[str, Any], str, int], Awaitable[None]],
    ) -> dict[str, Any]:
        meter = self._meter(state)
        view: dict[str, Any] = {
            **state,
            "round": round,
            "transcript": list(state["transcript"]),
            "final_positions": dict(state["final_positions"]),
        }
        status = state["status"]
        for agent in CRITIC_ORDER:
            if meter.exhausted():
                status = "budget_exceeded"
                break
            await play_turn(meter, view, agent, round)
        if round < LAST_ROUND:  # after the last turn nothing is left to cut short
            status = meter.status_after(state)
        return {
            "round": round,
            "transcript": view["transcript"],
            "final_positions": view["final_positions"],
            "budget": meter.budget,
            "status": status,
        }

    async def round_1(self, state: DebateState) -> dict[str, Any]:
        return await self._round(state, 1, self._critic_turn)

    async def round_2(self, state: DebateState) -> dict[str, Any]:
        return await self._round(state, 2, self._critic_turn)

    async def round_3(self, state: DebateState) -> dict[str, Any]:
        return await self._round(state, LAST_ROUND, self._final_turn)

    async def _moderator(self, state: DebateState, round: int) -> dict[str, Any]:
        meter = self._meter(state)
        meter.start_turn()
        notes = list(state["moderator_notes"])
        checkpoint = None
        try:
            async with asyncio.timeout(meter.remaining_s()):
                for _ in range(2):
                    if meter.tokens_spent():
                        break
                    try:
                        checkpoint = await run_checkpoint(self.deps.gw, state, round, on_usage=meter.add)
                        break
                    except LLMError as exc:  # usage already reported by run_checkpoint
                        logger.warning("checkpoint failed round=%d: %s", round, exc)
        except TimeoutError:
            logger.warning("checkpoint hit the deadline round=%d", round)
        if checkpoint is None:
            self._turn_failed("moderator", round)
        else:
            self.log.publish(
                "checkpoint",
                {"round": round, "summary": checkpoint.summary, "top_disagreements": checkpoint.top_disagreements},
            )
            notes.append(f"Round {round}: {checkpoint.summary} Top disagreements: {'; '.join(checkpoint.top_disagreements)}")
            await self.deps.store.add_turn(
                state["debate_id"], round, "moderator", checkpoint.summary,
                tokens_in=meter.turn_tokens_in, tokens_out=meter.turn_tokens_out,
            )
        return {
            "moderator_notes": notes,
            "budget": meter.budget,
            "status": meter.status_after(state),
        }

    async def moderator_1(self, state: DebateState) -> dict[str, Any]:
        return await self._moderator(state, 1)

    async def moderator_2(self, state: DebateState) -> dict[str, Any]:
        return await self._moderator(state, 2)

    async def rebuttal(self, state: DebateState) -> dict[str, Any]:
        meter = self._meter(state)
        timeout_s = min(self.deps.settings.REBUTTAL_TIMEOUT_S, math.ceil(meter.remaining_s() - JUDGE_RESERVE_S))
        answer = interrupt({"timeout_s": timeout_s})
        text = (answer or "").strip() or None
        self.log.publish("rebuttal_received", {"text": text})
        return {"rebuttal": text, "status": meter.status_after(state)}

    async def verdict(self, state: DebateState) -> dict[str, Any]:
        meter = self._meter(state)
        remaining = meter.remaining_s()
        status = state["status"]
        if not state["transcript"]:
            result = fallback_verdict(state)  # nothing to judge
        elif meter.tokens_spent() or remaining < JUDGE_MIN_REMAINING_S:
            result, status = fallback_verdict(state), "budget_exceeded"
        else:
            try:
                async with asyncio.timeout(remaining):
                    result = await generate_verdict(
                        self.deps.gw, state, on_usage=meter.add,
                        may_continue=lambda: not meter.tokens_spent(),
                    )
                if result.fallback and meter.tokens_spent():
                    status = "budget_exceeded"
            except TimeoutError:
                logger.warning("judge hit the deadline debate=%s", state["debate_id"])
                result, status = fallback_verdict(state), "budget_exceeded"
        self.log.publish("verdict", result.model_dump(mode="json"))
        return {"verdict": result.model_dump(mode="json"), "budget": meter.budget, "status": status}

    async def report(self, state: DebateState) -> dict[str, Any]:
        status = "complete" if state["status"] == "running" else state["status"]
        debate_id, budget = state["debate_id"], state["budget"]
        await self.deps.store.save_verdict(debate_id, Verdict.model_validate(state["verdict"]))
        await self.deps.store.update_debate(
            debate_id, status=status, total_tokens=budget["tokens_used"], est_cost=budget["cost_usd"]
        )
        self.log.publish("done", {"status": status})
        return {"status": status}


def _go_on_to(next_node: str) -> Callable[[DebateState], str]:
    def route(state: DebateState) -> str:
        return next_node if state["status"] == "running" else "verdict"

    return route


def build_graph(deps: Deps, checkpointer: Any) -> CompiledStateGraph:
    debate = _Debate(deps)
    graph = StateGraph(DebateState)
    for name in (
        "setup", "round_1", "moderator_1", "rebuttal", "round_2",
        "moderator_2", "round_3", "verdict", "report",
    ):
        graph.add_node(name, getattr(debate, name))

    graph.add_edge(START, "setup")
    for node, next_node in (
        ("setup", "round_1"),
        ("round_1", "moderator_1"),
        ("moderator_1", "rebuttal"),
        ("rebuttal", "round_2"),
        ("round_2", "moderator_2"),
        ("moderator_2", "round_3"),
    ):
        graph.add_conditional_edges(node, _go_on_to(next_node), [next_node, "verdict"])
    graph.add_edge("round_3", "verdict")
    graph.add_edge("verdict", "report")
    graph.add_edge("report", END)
    return graph.compile(checkpointer=checkpointer)
