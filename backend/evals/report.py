"""Turn eval results into the plan's section 14 metrics.

    uv run python evals/report.py evals/results/<file>.json

Reads the file `run_evals.py` writes, partial or complete. A verdict with `fallback: true`
is counted on its own and never as a schema-valid success, so an outage or a 402 cannot
look like a pass.
"""

import json
import math
import re
import sys
from pathlib import Path
from typing import Any

NOT_MEANINGFUL = "NOT MEANINGFUL for quality or cost (fake provider: canned text, zero cost)"

# A crude lexicon, not a model: Round 1 turns carry no structured stance, so this only
# flags the obvious case of every critic opening in agreement.
_POSITIVE = (
    "strong", "promising", "compelling", "love", "great", "excited", "viable", "opportunity",
    "bullish", "would invest", "would buy", "impressive", "clear need", "well positioned",
)
_NEGATIVE = (
    "risk", "concern", "weak", "unclear", "doubt", "problem", "fail", "skeptic", "not convinced",
    "crowded", "no moat", "worried", "unproven", "struggle", "overestimat", "hard to",
)


def stance(text: str) -> str:
    """positive, negative or neutral, by counting lexicon hits."""
    t = text.casefold()
    pos = sum(len(re.findall(re.escape(w), t)) for w in _POSITIVE)
    neg = sum(len(re.findall(re.escape(w), t)) for w in _NEGATIVE)
    if pos > neg:
        return "positive"
    return "negative" if neg > pos else "neutral"


def _percentile(values: list[float], q: float) -> float | None:
    """Nearest-rank percentile; None for no data."""
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(math.ceil(q * len(ordered)), 1) - 1]


def _rate(num: int, den: int) -> float | None:
    return num / den if den else None


def summarize(results: list[dict[str, Any]], provider: str) -> dict[str, Any]:
    n = len(results)
    finished = [r for r in results if r["status"] != "crashed"]
    completed = [r for r in results if r["status"] == "complete"]
    fallbacks = [r for r in results if r["fallback"]]
    valid = [r for r in results if r["schema_valid"] and not r["fallback"]]
    real_verdicts = [r for r in results if r["consistency_errors"] is not None and not r["fallback"]]
    consistent = [r for r in real_verdicts if not r["consistency_errors"]]
    round1 = [r for r in results if len(r["round1_stances"]) >= 2]
    collapsed = [r for r in round1 if all(s == "positive" for s in r["round1_stances"])]
    turns = sum(r["total_turns"] for r in results)
    tokens = [r["tokens"] for r in results]
    costs = [r["cost_usd"] for r in results]
    latencies = [r["latency_s"] for r in finished]
    return {
        "debates": n,
        "provider": provider,
        "meaningful": provider != "fake",
        "completion_rate": _rate(len(completed), n),
        "fallback_count": len(fallbacks),
        "crashed_count": n - len(finished),
        "schema_valid_rate": _rate(len(valid), n),
        "latency_p50_s": _percentile(latencies, 0.50),
        "latency_p95_s": _percentile(latencies, 0.95),
        "tokens_total": sum(tokens),
        "tokens_mean": _rate(sum(tokens), n),
        "cost_total_usd": sum(costs),
        "cost_mean_usd": _rate(sum(costs), n),
        "repetition_rate": _rate(sum(r["repeated_turns"] for r in results), turns),
        "cap_violation_debates": sum(1 for r in results if r["cap_violations"]),
        "consistency_rate": _rate(len(consistent), len(real_verdicts)),
        "agreement_collapse_rate": _rate(len(collapsed), len(round1)),
        "by_category": {
            c: {"debates": len(rs), "valid": sum(1 for r in rs if r["schema_valid"] and not r["fallback"])}
            for c in sorted({r["category"] for r in results})
            for rs in [[r for r in results if r["category"] == c]]
        },
    }


def _pct(v: float | None) -> str:
    return "n/a" if v is None else f"{v * 100:.1f}%"


def _num(v: float | None, fmt: str) -> str:
    return "n/a" if v is None else format(v, fmt)


def format_report(s: dict[str, Any]) -> str:
    lines = ["=== Eval report ==="]
    if not s["meaningful"]:
        lines.append(NOT_MEANINGFUL)
    lines += [
        f"debates:                 {s['debates']}",
        f"completion rate:         {_pct(s['completion_rate'])}",
        f"fallback verdicts:       {s['fallback_count']}  (counted apart, never as valid)",
        f"crashed:                 {s['crashed_count']}",
        f"schema-valid rate:       {_pct(s['schema_valid_rate'])}  (real verdicts only)",
        f"latency p50 / p95:       {_num(s['latency_p50_s'], '.1f')}s / {_num(s['latency_p95_s'], '.1f')}s",
        "                         (includes fallback and budget_exceeded debates; inflated when concurrency > 1)",
        f"tokens total / mean:     {s['tokens_total']} / {_num(s['tokens_mean'], '.0f')}",
        f"cost total / mean:       ${s['cost_total_usd']:.4f} / ${_num(s['cost_mean_usd'], '.4f')}",
        f"repetition rate:         {_pct(s['repetition_rate'])}  (turns regenerated for repeating a point)",
        f"cap violations:          {s['cap_violation_debates']} debates",
        f"verdict consistency:     {_pct(s['consistency_rate'])}  (real verdicts only)",
        f"agreement collapse:      {_pct(s['agreement_collapse_rate'])}  (all Round 1 turns positive; keyword heuristic)",
    ]
    for category, c in s["by_category"].items():
        lines.append(f"  {category:<12} {c['valid']}/{c['debates']} valid")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1:
        print("usage: report.py <results.json>", file=sys.stderr)
        return 2
    doc = json.loads(Path(args[0]).read_text())
    meta = doc["meta"]
    print(format_report(summarize(doc["results"], meta["provider"])))
    if meta["status"] != "complete":
        print(f"NOTE: run {meta['status']}" + (f" ({meta['stop_reason']})" if meta.get("stop_reason") else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
