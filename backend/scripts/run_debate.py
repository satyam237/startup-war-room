"""Run one debate in the terminal, with whichever provider LLM_PROVIDER selects.

    LLM_PROVIDER=fake uv run python scripts/run_debate.py "<pitch>" [--rebuttal "<text>"]

The provider must already be configured; this script never sets a key or a model.
"""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # uv package=false: app is not installed

from langgraph.checkpoint.memory import InMemorySaver

from app.config import get_settings
from app.events import Event, EventLog
from app.graph import Deps, InMemoryStore, build_graph, initial_state, pending_rebuttal, resume_command
from app.llm import get_gateway


def show(e: Event) -> None:
    d = e.data
    if e.event == "setup":
        print(f"[setup] {d['message']}")
    elif e.event == "turn_start":
        retry = f" (attempt {d['attempt']})" if d["attempt"] > 1 else ""
        print(f"\n--- Round {d['round']}: {d['agent']}{retry} ---")
    elif e.event == "turn_token":
        print(d["text"], end="", flush=True)
    elif e.event == "turn_reset":
        print(f"\n[reset: {d['reason']}]")
    elif e.event == "turn_end":
        print(f"\n{d['text']}" if d["round"] == 3 else "")
    elif e.event == "turn_failed":
        print(f"\n[failed] {d['note']}")
    elif e.event == "checkpoint":
        print(f"\n=== Moderator, round {d['round']} ===\n{d['summary']}")
        for point in d["top_disagreements"]:
            print(f"  - {point}")
    elif e.event == "await_rebuttal":
        print(f"\n[rebuttal window open for {d['timeout_s']}s]")
    elif e.event == "rebuttal_received":
        print(f"[rebuttal] {d['text'] or 'skipped'}")
    elif e.event == "verdict":
        label = " (fallback)" if d["fallback"] else ""
        print(f"\n=== Verdict{label}: {d['recommendation']}, confidence {d['confidence']} ===")
        print(d["one_line_summary"])
        for item in d["risks"]:
            print(f"  risk {item['rank']} [{item['severity']}] {item['raised_by']}: {item['risk']}")
        for item in d["experiments"]:
            print(f"  experiment ({item['timebox_days']}d): {item['test']}")
    elif e.event == "error":
        print(f"\n[error] {d['message']}")
    elif e.event == "done":
        print(f"\n[done] status={d['status']}")


async def drive(pitch: str, rebuttal: str | None, log: EventLog) -> dict:
    settings = get_settings()
    deps = Deps(gw=get_gateway(), log=log, settings=settings, store=InMemoryStore())
    graph = build_graph(deps, InMemorySaver())
    config = {"configurable": {"thread_id": "terminal"}}
    try:
        result = await graph.ainvoke(initial_state("terminal", pitch, {}, settings), config)
        while (payload := pending_rebuttal(result)) is not None:
            log.publish("await_rebuttal", payload)
            result = await graph.ainvoke(resume_command(rebuttal), config)
        return result
    finally:
        log.close()


async def main() -> None:
    parser = argparse.ArgumentParser(description="Print one debate to the terminal.")
    parser.add_argument("pitch")
    parser.add_argument("--rebuttal", default=None, help="founder's reply at the first checkpoint")
    args = parser.parse_args()

    log = EventLog()
    runner = asyncio.create_task(drive(args.pitch, args.rebuttal, log))
    async for event in log.subscribe():
        show(event)
    result = await runner
    budget = result["budget"]
    print(f"[usage] {budget['tokens_used']} tokens, ${budget['cost_usd']:.4f}, {budget['turns_used']} turns")


if __name__ == "__main__":
    asyncio.run(main())
