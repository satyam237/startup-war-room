"""Startup check: can every configured model serve the requests this app sends?

`structured` asks for json_schema output and `reasoning`, with `provider.require_parameters`
set, so a model without them fails every call. The guards fail open on such a failure, which
would hide it, so a swap to the wrong model is caught here instead. The check itself never
stops the app: a failed lookup only warns, and an unsupported model shows in `/health`.
"""

import logging

from app.config import Settings
from app.llm import get_gateway

logger = logging.getLogger("app.model_check")

MODEL_SETTINGS = ("FAST_MODEL", "AGENT_MODEL", "JUDGE_MODEL", "ESCALATION_MODEL")
STRUCTURED_PARAMETERS = {"structured_outputs", "response_format"}


def _problem(model: str, listed: dict[str, set[str]]) -> str | None:
    if model not in listed:
        return "is not listed by OpenRouter"
    missing = []
    if not STRUCTURED_PARAMETERS & listed[model]:
        missing.append("structured_outputs or response_format")
    if "reasoning" not in listed[model]:
        missing.append("reasoning")
    return f"does not support {' and '.join(missing)}" if missing else None


async def check_models(settings: Settings) -> bool:
    """False only if a configured model is known to be unusable. Logs what it finds."""
    if settings.LLM_PROVIDER != "openrouter":
        return True
    if not settings.OPENROUTER_API_KEY:
        logger.error("OPENROUTER_API_KEY is not set, so no debate can run and models were not checked")
        return True
    try:
        listed = await get_gateway().supported_parameters()
    except Exception as exc:  # noqa: BLE001 - a startup convenience must never stop the app
        logger.warning("could not check the configured models: %s", exc)
        return True
    ok = True
    for name in MODEL_SETTINGS:
        model = getattr(settings, name)
        problem = _problem(model, listed)
        if problem is not None:
            logger.error("%s=%s %s", name, model, problem)
            ok = False
    return ok
