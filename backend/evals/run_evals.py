"""Run the 20 eval pitches through the debate graph and report the plan's section 14 metrics.

    LLM_PROVIDER=fake uv run python evals/run_evals.py [--limit N] [--concurrency 3]
                      [--max-spend 5.0] [--out evals/results/<ts>.json]

Each pitch goes through `build_graph` directly, with the rebuttal skipped. The pitch intake
check lives in the API route, not the graph, so it is not exercised here.

With any provider but `fake` this refuses to run unless `--yes-spend-money` is given. It
stops early, and says why, when the spend reaches `--max-spend` or when every debate so far
has failed the same way (an out-of-credits 402, say), so a dead key does not burn the run.
Results are rewritten after every debate, so an interrupted run keeps its data.
"""

import argparse
import asyncio
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # uv package=false: app is not installed
sys.path.insert(0, str(Path(__file__).resolve().parent))

from langgraph.checkpoint.memory import InMemorySaver  # noqa: E402

import report  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.events import EventLog  # noqa: E402
from app.graph import Deps, InMemoryStore, build_graph, initial_state, pending_rebuttal, resume_command  # noqa: E402
from app.llm import LLMError, LLMRefusal, get_gateway  # noqa: E402
from app.models import Verdict  # noqa: E402
from app.verdict import check_consistency  # noqa: E402

EVALS_DIR = Path(__file__).resolve().parent
FAIL_STREAK = 3  # this many debates in a row, all failing identically, ends the run
MAX_ROUNDS = 3
WORD_CAP = 120


START_ESTIMATE_USD = 0.50  # assumed cost of one debate until one has finished


def outage_cause(r: dict[str, Any]) -> str | None:
    """Why a debate failed like an outage (a crash, or a gateway error behind a fallback), else None.

    A fallback with no readable cause, a budget_exceeded run and a judge validation fallback
    are genuine outcomes, not outages.
    """
    if r["error"]:
        return r["error"]
    if r["status"] == "budget_exceeded" or not (r["fallback"] or r["status"] != "complete"):
        return None
    return r.get("cause")


def outage_stop(results: list[dict[str, Any]]) -> str | None:
    """The last FAIL_STREAK results, all failing with one readable cause, mean an outage."""
    tail = results[-FAIL_STREAK:]
    if len(tail) == FAIL_STREAK:
        causes = {outage_cause(r) for r in tail}
        if len(causes) == 1 and None not in causes:
            return "same_failure"
    return None


def fits(spent: float, inflight: int, estimate: float, max_spend: float) -> bool:
    """Can one more debate launch? Counts the launching debate and every running one at `estimate`.

    One case can still overshoot: debates launched before any has finished are priced at
    START_ESTIMATE_USD, so a first debate that really costs more than that can pass the cap.
    Once one has finished, the estimate is the largest real cost seen.
    """
    return spent + (inflight + 1) * estimate <= max_spend


def _is_outage(exc: Exception) -> bool:
    """A provider or key failure; refusals and structured-output validation failures are not."""
    return not isinstance(exc, LLMRefusal) and not str(exc).startswith("structured output")


class _RecordingGateway:
    """Wraps the gateway for one debate and keeps the outage-type errors it raised."""

    def __init__(self, gw: Any, causes: list[str]) -> None:
        self._gw, self.causes = gw, causes

    def _note(self, exc: LLMError) -> None:
        if _is_outage(exc):
            self.causes.append(f"{type(exc).__name__}: {exc}"[:200])

    async def structured(self, *args: Any, **kwargs: Any):
        try:
            out = await self._gw.structured(*args, **kwargs)
        except LLMError as exc:
            self._note(exc)
            raise
        self.causes.clear()  # a later success means earlier errors were recovered
        return out

    async def stream_text(self, *args: Any, **kwargs: Any):
        try:
            async for piece in self._gw.stream_text(*args, **kwargs):
                yield piece
        except LLMError as exc:
            self._note(exc)
            raise
        self.causes.clear()


def build_record(
    item: dict[str, Any], events: list[Any], result: dict[str, Any] | None, error: str | None,
    latency_s: float, max_turns: int, causes: list[str] | None = None,
) -> dict[str, Any]:
    turns = [e.data for e in events if e.event == "turn_end"]
    budget = (result or {}).get("budget") or {}
    raw = (result or {}).get("verdict")
    verdict: Verdict | None = None
    if raw is not None:
        try:
            verdict = Verdict.model_validate(raw)
        except ValueError:
            verdict = None
    fallback = bool(raw and raw.get("fallback"))
    caps = []
    if budget.get("turns_used", 0) > max_turns:
        caps.append(f"turns_used {budget['turns_used']} > {max_turns}")
    if len(turns) > max_turns:
        caps.append(f"{len(turns)} critic turns > {max_turns}")
    if any(t["round"] > MAX_ROUNDS for t in turns):
        caps.append(f"round above {MAX_ROUNDS}")
    for t in turns:
        words = len(t["text"].split())
        if words > WORD_CAP:
            caps.append(f"{t['agent']} round {t['round']}: {words} words > {WORD_CAP}")
    status = "crashed" if error else (result or {}).get("status", "crashed")
    return {
        "id": item["id"],
        "category": item["category"],
        "status": status,
        "error": error,
        "latency_s": round(latency_s, 3),
        "tokens": budget.get("tokens_used", 0),
        "cost_usd": budget.get("cost_usd", 0.0),
        "turns_used": budget.get("turns_used", 0),
        "fallback": fallback,
        "schema_valid": verdict is not None and not fallback,
        "consistency_errors": None if verdict is None or fallback else check_consistency(verdict),
        "repeated_turns": sum(1 for e in events if e.event == "turn_reset" and e.data["reason"] == "repetition"),
        "total_turns": len(turns),
        "turn_failed": sum(1 for e in events if e.event == "turn_failed"),
        # the last error no later call recovered from, and only if the debate fell short
        "cause": causes[-1] if causes and (fallback or status != "complete") else None,
        "cap_violations": caps,
        "round1_stances": [report.stance(t["text"]) for t in turns if t["round"] == 1],
        "verdict": raw,
    }


async def run_one(item: dict[str, Any]) -> dict[str, Any]:
    settings = get_settings()
    log = EventLog()
    events: list[Any] = []

    async def collect() -> None:
        async for event in log.subscribe():
            events.append(event)

    collector = asyncio.create_task(collect())
    causes: list[str] = []
    deps = Deps(gw=_RecordingGateway(get_gateway(), causes), log=log, settings=settings, store=InMemoryStore())
    graph = build_graph(deps, InMemorySaver())
    config = {"configurable": {"thread_id": item["id"]}}
    result: dict[str, Any] | None = None
    error: str | None = None
    started = time.monotonic()
    try:
        result = await graph.ainvoke(initial_state(item["id"], item["pitch"], {}, settings), config)
        while pending_rebuttal(result) is not None:
            result = await graph.ainvoke(resume_command(""), config)  # "" is a skipped rebuttal
    except Exception as exc:  # one bad debate must not end the run
        error = f"{type(exc).__name__}: {exc}"[:300]
    latency = time.monotonic() - started
    log.close()
    await collector
    return build_record(item, events, result, error, latency, settings.MAX_TURNS, causes)


def write_results(path: Path, doc: dict[str, Any]) -> None:
    """Atomic, so an interrupt mid-write never leaves a torn file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(doc, indent=2))
    os.replace(tmp, path)


def _line(index: int, total: int, r: dict[str, Any], spent: float) -> str:
    outcome = "FALLBACK" if r["fallback"] else ("valid" if r["schema_valid"] else "invalid")
    note = f" {r['error']}" if r["error"] else ""
    return (
        f"[{index}/{total}] {r['id']:<14} {r['category']:<11} {r['status']:<9} {outcome:<8} "
        f"{r['latency_s']:6.1f}s {r['tokens']:>6} tok ${r['cost_usd']:.4f} | total ${spent:.4f}{note}"
    )


async def run_all(
    items: list[dict[str, Any]], concurrency: int, max_spend: float, out: Path, provider: str
) -> dict[str, Any]:
    doc: dict[str, Any] = {
        "meta": {
            "provider": provider,
            "meaningful": provider != "fake",
            "label": None if provider != "fake" else report.NOT_MEANINGFUL,
            "started": datetime.now(timezone.utc).isoformat(),
            "max_spend_usd": max_spend,
            "status": "running",
            "stop_reason": None,
        },
        "results": [],
    }
    results: list[dict[str, Any]] = doc["results"]
    pending = list(items)
    # The fake provider costs nothing, so it needs no estimate until a debate shows a real cost.
    start_estimate = 0.0 if provider == "fake" else START_ESTIMATE_USD
    state: dict[str, Any] = {"reason": None, "spent": 0.0, "inflight": 0, "estimate": start_estimate}
    cond = asyncio.Condition()  # guards the launch decision and the inflight count together
    write_results(out, doc)

    async def worker() -> None:
        while True:
            async with cond:
                while True:
                    if state["reason"] is not None or not pending:
                        return
                    outage = outage_stop(results)
                    if outage is not None:
                        state["reason"] = outage
                    elif fits(state["spent"], state["inflight"], state["estimate"], max_spend):
                        break
                    elif state["inflight"] == 0:  # real spend and a real estimate; nothing left to wait for
                        state["reason"] = "max_spend"
                        doc["meta"]["stop_detail"] = (
                            f"spent ${state['spent']:.4f} plus the estimated ${state['estimate']:.4f} for the "
                            f"next debate would exceed --max-spend ${max_spend:.2f}"
                        )
                    else:  # the projection may be pessimistic; wait for running debates, then re-check
                        await cond.wait()
                        continue
                    cond.notify_all()
                    return
                item = pending.pop(0)
                state["inflight"] += 1
            try:
                r = await run_one(item)
            finally:
                state["inflight"] -= 1
            async with cond:
                results.append(r)
                state["spent"] += r["cost_usd"]
                seen = max(x["cost_usd"] for x in results)
                state["estimate"] = seen if seen > 0 else start_estimate
                print(_line(len(results), len(items), r, state["spent"]), flush=True)
                write_results(out, doc)
                cond.notify_all()

    try:
        await asyncio.gather(*(worker() for _ in range(max(concurrency, 1))))
    finally:
        doc["meta"]["finished"] = datetime.now(timezone.utc).isoformat()
        doc["meta"]["status"] = "stopped" if state["reason"] else ("complete" if len(results) == len(items) else "interrupted")
        doc["meta"]["stop_reason"] = state["reason"]
        write_results(out, doc)
    return doc


def _explain_stop(reason: str, results: list[dict[str, Any]], detail: str | None) -> str:
    if reason == "max_spend":
        return f"STOPPED after {len(results)} debates: {detail}."
    return (
        f"STOPPED: the last {FAIL_STREAK} debates all failed with the same cause ({outage_cause(results[-1])}). "
        "Check the key, credits and models before spending more."
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the eval pitches through the debate graph.")
    parser.add_argument("--limit", type=int, default=None, help="run only the first N pitches")
    parser.add_argument("--concurrency", type=int, default=3)
    parser.add_argument("--max-spend", type=float, default=5.0, help="stop once this many USD are spent")
    parser.add_argument("--out", type=Path, default=None, help="default evals/results/<timestamp>.json")
    parser.add_argument("--yes-spend-money", action="store_true", help="required for any non-fake provider")
    args = parser.parse_args(argv)

    provider = get_settings().LLM_PROVIDER
    if provider != "fake" and not args.yes_spend_money:
        print(
            f"Refusing to run: LLM_PROVIDER={provider!r} would spend real money. "
            "Pass --yes-spend-money to confirm, or run with LLM_PROVIDER=fake.",
            file=sys.stderr,
        )
        return 2

    items = json.loads((EVALS_DIR / "pitches.json").read_text())
    if args.limit is not None:
        items = items[: args.limit]
    out = args.out or EVALS_DIR / "results" / f"{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"

    if provider == "fake":
        print(report.NOT_MEANINGFUL)
    doc = asyncio.run(run_all(items, args.concurrency, args.max_spend, out, provider))
    results = doc["results"]
    print()
    print(report.format_report(report.summarize(results, provider)))
    print(f"results: {out}")
    reason = doc["meta"]["stop_reason"]
    if reason:
        print(_explain_stop(reason, results, doc["meta"].get("stop_detail")))
    return 1 if reason == "same_failure" else 0


if __name__ == "__main__":
    sys.exit(main())
