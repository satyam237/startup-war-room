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


def _defang(text: str) -> str:
    """Stop link, image and raw-HTML syntax from rendering in text that is not ours."""
    return text.replace("![", "!\\[").replace("](", "]\\(").replace("<", "&lt;")


def quote(text: str) -> str:
    """Untrusted multi-line text as a blockquote, so no line can start a heading or list of ours."""
    return "\n".join(f"> {line}".rstrip() if line else ">" for line in _defang(text).splitlines() or [""])


def inline(text: object) -> str:
    """Untrusted text kept on one line of our own markup."""
    return " ".join(_defang(str(text)).split())


def render_markdown(debate: dict[str, Any]) -> str:
    verdict = debate["verdict"]
    out = ["# Startup War Room report", "", f"> {DISCLAIMER}", "", "## Pitch", "", quote(debate["pitch"]), ""]
    for name, value in (debate.get("pitch_meta") or {}).items():
        out.append(f"- **{name.replace('_', ' ').capitalize()}:**\n{quote(str(value))}")
    if debate.get("pitch_meta"):
        out.append("")

    out += ["## Debate", ""]
    current_round = None
    for turn in debate["turns"]:
        if turn["round"] != current_round:
            current_round = turn["round"]
            out += [f"### Round {current_round}", ""]
        speaker = AGENT_NAMES.get(turn["agent"], turn["agent"])
        out += [f"**{speaker}:**", "", quote(turn["text"]), ""]
        details = turn["details"] or {}
        for item in details.get("top_disagreements", []):
            out.append(f"- Open disagreement: {inline(item)}")
        if details.get("top_disagreements"):
            out.append("")
        position = details.get("final_position")
        if position:
            out += [
                f"Final position: {inline(position['score_1_to_10'])}/10. Top risk: {inline(position['top_risk'])} "
                f"Would change their mind if: {inline(position['change_mind_if'])}",
                "",
            ]

    if debate.get("rebuttal"):
        out += ["## Founder rebuttal", "", quote(debate["rebuttal"]), ""]

    out += ["## Verdict", ""]
    if verdict["fallback"]:
        out += [PARTIAL_NOTE, ""]
    out += [
        f"**Recommendation:** {RECOMMENDATIONS.get(verdict['recommendation'], verdict['recommendation'])} "
        f"(confidence {verdict['confidence']:.0%})",
        "",
        inline(verdict["one_line_summary"]),
        "",
        "### Scorecard",
        "",
    ]
    for key, label in SCORE_NAMES.items():
        item = verdict["scorecard"][key]
        out.append(f"- **{label}:** {item['score']}/10. {inline(item['why'])}")
    out += ["", "### Risks", ""]
    for risk in sorted(verdict["risks"], key=lambda r: r["rank"]):
        out.append(f"{risk['rank']}. [{risk['severity']}] {inline(risk['risk'])} (raised by {inline(risk['raised_by'])})")
    out += ["", "### Experiments", ""]
    for exp in verdict["experiments"]:
        out += [
            f"- **{inline(exp['test'])}** ({exp['timebox_days']} days)",
            f"  - Success: {inline(exp['success_criteria'])}",
            f"  - Kill: {inline(exp['kill_criteria'])}",
        ]
    out += ["", "---", "", f"_{DISCLAIMER} Do not rely on it for legal, financial or investment decisions._", ""]
    return "\n".join(out)
