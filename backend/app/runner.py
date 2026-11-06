"""Runs debates in the background, so a debate never depends on a client being connected.

Each debate gets one asyncio task that drives its graph and owns its EventLog: the task
publishes `await_rebuttal`, and it always closes the log, so no reader waits forever. All
of this is in-process, which is why the app runs one uvicorn worker (a documented v1 limit).
"""

import asyncio
import logging
from dataclasses import dataclass
from typing import Any

from langgraph.checkpoint.memory import InMemorySaver

from app import db
from app.config import get_settings
from app.events import EventLog
from app.graph import Deps, build_graph, initial_state, pending_rebuttal, resume_command
from app.llm import Usage, get_gateway

logger = logging.getLogger("app.runner")

# How long a finished debate's log stays in memory for reconnecting clients.
LOG_RETENTION_S = 600
FAILED_MESSAGE = "This debate stopped before it finished. Please start a new one."


class RebuttalNotOpen(Exception):
    """No rebuttal window is open for this debate."""


class RunnerFull(Exception):
    """MAX_CONCURRENT_DEBATES debates are already running."""


@dataclass
class _Run:
    log: EventLog
    task: asyncio.Task[None] | None = None
    answer: asyncio.Future[str | None] | None = None  # set only while a window is open


class DebateRunner:
    def __init__(self) -> None:
        self.log_retention_s: float = LOG_RETENTION_S
        self._runs: dict[str, _Run] = {}
        self._logs: dict[str, EventLog] = {}
        self._evictions: set[asyncio.TimerHandle] = set()

    def active_count(self) -> int:
        return len(self._runs)

    def at_capacity(self) -> bool:
        return self.active_count() >= get_settings().MAX_CONCURRENT_DEBATES

    def log(self, debate_id: str) -> EventLog | None:
        return self._logs.get(debate_id)

    def start(
        self, debate_id: str, pitch: str, meta: dict[str, Any] | None, spent: list[Usage] | None = None
    ) -> None:
        """Start a debate whose row exists. `spent` is usage already owed to its budget."""
        if self.at_capacity():
            raise RunnerFull
        run = _Run(log=EventLog())
        self._logs[debate_id] = run.log
        self._runs[debate_id] = run
        run.task = asyncio.create_task(self._run(debate_id, run, pitch, meta, spent or []))

    def submit_rebuttal(self, debate_id: str, text: str | None) -> None:
        run = self._runs.get(debate_id)
        if run is None or run.answer is None:
            raise RebuttalNotOpen(debate_id)
        run.answer.set_result(text)
        run.answer = None

    async def shutdown(self) -> None:
        """Stop what is running, so each row and log ends as `failed` rather than hanging."""
        await asyncio.sleep(0)  # a task cancelled before its first step would skip its cleanup
        tasks = [run.task for run in self._runs.values() if run.task is not None]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        for handle in self._evictions:
            handle.cancel()
        self._evictions.clear()

    async def _run(
        self, debate_id: str, run: _Run, pitch: str, meta: dict[str, Any] | None, spent: list[Usage]
    ) -> None:
        try:
            await self._drive(debate_id, run, pitch, meta, spent)
        except asyncio.CancelledError:
            logger.warning("debate stopped by shutdown id=%s", debate_id)
            await self._fail(debate_id, run.log)
        except Exception:
            logger.exception("debate crashed id=%s", debate_id)
            await self._fail(debate_id, run.log)
        finally:
            run.log.close()
            del self._runs[debate_id]
            self._schedule_eviction(debate_id)

    async def _drive(
        self, debate_id: str, run: _Run, pitch: str, meta: dict[str, Any] | None, spent: list[Usage]
    ) -> None:
        settings = get_settings()
        deps = Deps(gw=get_gateway(), log=run.log, settings=settings, store=db)
        graph = build_graph(deps, InMemorySaver())
        config = {"configurable": {"thread_id": debate_id}}

        state = initial_state(debate_id, pitch, meta, settings)
        state["budget"]["tokens_used"] = sum(u.tokens_in + u.tokens_out for u in spent)
        state["budget"]["cost_usd"] = sum(u.cost_usd for u in spent)

        result = await graph.ainvoke(state, config)
        while (payload := pending_rebuttal(result)) is not None:
            text = await self._await_rebuttal(run, payload)
            result = await graph.ainvoke(resume_command(text), config)

    async def _await_rebuttal(self, run: _Run, payload: dict[str, Any]) -> str | None:
        """The founder's text, or None on a timeout."""
        answer: asyncio.Future[str | None] = asyncio.get_running_loop().create_future()
        run.answer = answer  # open before publishing, so a client can answer straight away
        run.log.publish("await_rebuttal", payload)
        # asyncio.wait never cancels `answer`, so a late submit cannot be lost to the timeout.
        await asyncio.wait({answer}, timeout=payload["timeout_s"])
        run.answer = None
        return answer.result() if answer.done() else None

    async def _fail(self, debate_id: str, log: EventLog) -> None:
        try:
            await db.update_debate(debate_id, status="failed")
        except Exception:  # whatever broke the debate may have broken this too; readers still need an end
            logger.exception("could not mark debate failed id=%s", debate_id)
        log.publish("error", {"message": FAILED_MESSAGE, "recoverable": False})
        log.publish("done", {"status": "failed"})

    def _schedule_eviction(self, debate_id: str) -> None:
        def evict() -> None:
            self._evictions.discard(handle)
            self._logs.pop(debate_id, None)

        handle = asyncio.get_running_loop().call_later(self.log_retention_s, evict)
        self._evictions.add(handle)
