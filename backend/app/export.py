"""A finished debate as a Markdown report."""

from typing import Any

DISCLAIMER = "AI critique for brainstorming, not professional advice."
PARTIAL_NOTE = (
    "**Partial result:** the debate stopped early, so this verdict is a fallback built from "
    "what was said so far."
)
AGENT_NAMES = {
    "vc": "Skeptical VC", "customer": "Customer", "cto": "CTO", "competitor": "Competitor",
    "moderator": "Moderator",
}
SCORE_NAMES = {
    "market": "Market", "customer_pull": "Customer pull", "feasibility": "Feasibility",
    "defensibility": "Defensibility", "timing": "Timing",
}
RECOMMENDATIONS = {"go": "Go", "pivot": "Pivot", "no_go": "No-go"}


def render_markdown(debate: dict[str, Any]) -> str:
    verdict = debate["verdict"]
    out = ["# Startup War Room report", "", f"> {DISCLAIMER}", "", "## Pitch", "", debate["pitch"], ""]
    for name, value in (debate.get("pitch_meta") or {}).items():
        out.append(f"- **{name.replace('_', ' ').capitalize()}:** {value}")
    if debate.get("pitch_meta"):
        out.append("")

    out += ["## Debate", ""]
    current_round = None
    for turn in debate["turns"]:
        if turn["round"] != current_round:
            current_round = turn["round"]
            out += [f"### Round {current_round}", ""]
        speaker = AGENT_NAMES.get(turn["agent"], turn["agent"])
        out += [f"**{speaker}:** {turn['text']}", ""]
        details = turn["details"] or {}
        for item in details.get("top_disagreements", []):
            out.append(f"- Open disagreement: {item}")
        if details.get("top_disagreements"):
            out.append("")
        position = details.get("final_position")
        if position:
            out += [
                f"Final position: {position['score_1_to_10']}/10. Top risk: {position['top_risk']} "
                f"Would change their mind if: {position['change_mind_if']}",
                "",
            ]

    if debate.get("rebuttal"):
        out += ["## Founder rebuttal", "", debate["rebuttal"], ""]

    out += ["## Verdict", ""]
    if verdict["fallback"]:
        out += [PARTIAL_NOTE, ""]
    out += [
        f"**Recommendation:** {RECOMMENDATIONS.get(verdict['recommendation'], verdict['recommendation'])} "
        f"(confidence {verdict['confidence']:.0%})",
        "",
        verdict["one_line_summary"],
        "",
        "### Scorecard",
        "",
    ]
    for key, label in SCORE_NAMES.items():
        item = verdict["scorecard"][key]
        out.append(f"- **{label}:** {item['score']}/10. {item['why']}")
    out += ["", "### Risks", ""]
    for risk in sorted(verdict["risks"], key=lambda r: r["rank"]):
        out.append(f"{risk['rank']}. [{risk['severity']}] {risk['risk']} (raised by {risk['raised_by']})")
    out += ["", "### Experiments", ""]
    for exp in verdict["experiments"]:
        out += [
            f"- **{exp['test']}** ({exp['timebox_days']} days)",
            f"  - Success: {exp['success_criteria']}",
            f"  - Kill: {exp['kill_criteria']}",
        ]
    out += ["", "---", "", f"_{DISCLAIMER} Do not rely on it for legal, financial or investment decisions._", ""]
    return "\n".join(out)
