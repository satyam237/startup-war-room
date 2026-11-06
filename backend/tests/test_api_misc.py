"""Export, feedback, delete, rate limits and CORS."""

import httpx
import pytest

from app import db
from app.export import DISCLAIMER, render_markdown
from app.fake_llm import FakeGateway
from app.main import app
from app.models import Verdict
from app.ratelimit import RateLimiter
from tests.test_api_stream import BODY, PITCH, create, install, runner, thin_intake, wait_finished

VERDICT = Verdict.model_validate({
    "recommendation": "pivot", "confidence": 0.62,
    "scorecard": {k: {"score": 6, "why": f"{k} reason"} for k in
                  ("market", "customer_pull", "feasibility", "defensibility", "timing")},
    "risks": [{"rank": 1, "risk": "Designers churn after the first sprint", "severity": "high", "raised_by": "vc"}],
    "experiments": [{"test": "Pre-sell ten sprints", "timebox_days": 14,
                     "success_criteria": "3 paid", "kill_criteria": "0 paid"}],
    "one_line_summary": "Narrow to one design niche.",
})


async def finished_debate(*, rebuttal: str | None = None, fallback: bool = False, token: str = "tok") -> str:
    debate_id = f"d{abs(hash((rebuttal, fallback, token)))}"
    await db.create_debate(debate_id, PITCH, {"stage": "idea"}, db.hash_token(token))
    await db.add_turn(debate_id, 1, "vc", "The market is crowded.")
    await db.add_turn(debate_id, 1, "customer", "I would not pay for this.")
    await db.add_turn(debate_id, 1, "moderator", "Round one summary.", details={"top_disagreements": ["a", "b"]})
    await db.save_verdict(debate_id, VERDICT.model_copy(update={"fallback": fallback}))
    await db.update_debate(debate_id, status="complete", rebuttal=rebuttal)
    return debate_id


# ---- export ----

async def test_export_has_all_sections(client):
    debate_id = await finished_debate(rebuttal="We already have ten paying teams.")
    r = await client.get(f"/debates/{debate_id}/export?format=md")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/markdown")
    assert "filename=" in r.headers["content-disposition"]
    assert r.headers["content-disposition"].startswith("attachment")
    body = r.text
    for part in (DISCLAIMER, PITCH, "The market is crowded.", "I would not pay for this.", "Round one summary.",
                 "We already have ten paying teams.", "Pivot", "Designers churn", "Pre-sell ten sprints",
                 "Narrow to one design niche.", "market reason"):
        assert part in body, part
    assert "partial" not in body.lower()


async def test_export_omits_rebuttal_when_absent_and_labels_fallback(client):
    debate_id = await finished_debate(fallback=True)
    body = (await client.get(f"/debates/{debate_id}/export")).text
    assert "Founder rebuttal" not in body
    assert "partial" in body.lower()


async def test_render_markdown_is_pure(client):
    debate_id = await finished_debate()
    debate = await db.get_debate(debate_id)
    assert render_markdown(debate) == render_markdown(debate)


async def test_export_unfinished_409(client):
    await db.create_debate("running1", PITCH, {}, db.hash_token("t"))
    assert (await client.get("/debates/running1/export")).status_code == 409
    await db.update_debate("running1", status="failed")
    assert (await client.get("/debates/running1/export")).status_code == 409
    assert (await client.get("/debates/nope/export")).status_code == 404


async def test_export_rejects_unknown_format(client):
    debate_id = await finished_debate()
    assert (await client.get(f"/debates/{debate_id}/export?format=pdf")).status_code == 422


# ---- feedback ----

@pytest.mark.parametrize("rating", [0, 6, -1, "x", None])
async def test_feedback_rating_range(client, rating):
    debate_id = await finished_debate()
    r = await client.post(f"/debates/{debate_id}/feedback", json={"rating": rating})
    assert r.status_code == 422
    assert (await db.get_debate(debate_id))["feedback"] == []


async def test_feedback_stored_and_404(client):
    debate_id = await finished_debate()
    for rating in (1, 5):
        r = await client.post(f"/debates/{debate_id}/feedback", json={"rating": rating, "comment": "ok"})
        assert r.status_code == 201
    assert [f["rating"] for f in (await db.get_debate(debate_id))["feedback"]] == [1, 5]
    assert (await client.post("/debates/nope/feedback", json={"rating": 3})).status_code == 404


async def test_feedback_comment_too_long(client):
    debate_id = await finished_debate()
    r = await client.post(f"/debates/{debate_id}/feedback", json={"rating": 3, "comment": "x" * 2001})
    assert r.status_code == 422


# ---- delete ----

async def test_delete_wrong_token_403(client):
    debate_id = await finished_debate(token="right")
    for headers in ({"X-Delete-Token": "wrong"}, {}):
        r = await client.delete(f"/debates/{debate_id}", headers=headers)
        assert r.status_code == 403
    assert await db.get_debate(debate_id) is not None


async def test_delete_then_404(client):
    debate_id = await finished_debate(token="right")
    assert (await client.delete(f"/debates/{debate_id}", headers={"X-Delete-Token": "right"})).status_code == 204
    assert (await client.get(f"/debates/{debate_id}")).status_code == 404
    assert (await client.get(f"/debates/{debate_id}/export")).status_code == 404
    assert (await client.delete(f"/debates/{debate_id}", headers={"X-Delete-Token": "right"})).status_code == 404


async def test_delete_running_409_but_wrong_token_still_403(client):
    install(FakeGateway(delay_s=0.01))
    r = await client.post("/debates", json=BODY)
    debate_id, token = r.json()["debate_id"], r.json()["delete_token"]
    assert (await client.delete(f"/debates/{debate_id}", headers={"X-Delete-Token": "wrong"})).status_code == 403
    assert (await client.delete(f"/debates/{debate_id}", headers={"X-Delete-Token": token})).status_code == 409
    assert await db.get_debate(debate_id) is not None


async def test_delete_evicts_live_log_so_stream_stops_serving(client, monkeypatch):
    from tests.test_api_stream import configure
    configure(monkeypatch, REBUTTAL_TIMEOUT_S=0.01)
    install(FakeGateway())
    r = await client.post("/debates", json=BODY)
    debate_id, token = r.json()["debate_id"], r.json()["delete_token"]
    await wait_finished(debate_id)
    assert runner().log(debate_id) is not None  # still within retention
    assert (await client.delete(f"/debates/{debate_id}", headers={"X-Delete-Token": token})).status_code == 204
    assert runner().log(debate_id) is None
    assert (await client.get(f"/debates/{debate_id}/stream")).status_code == 404


async def test_delete_uses_constant_time_compare():
    import inspect
    from app import routes
    assert "hmac.compare_digest" in inspect.getsource(routes)


# ---- rate limits ----

def use_limits(create_limit: int, intake_limit: int = 100) -> None:
    app.state.create_limiter = RateLimiter(create_limit, 3600)
    app.state.intake_limiter = RateLimiter(intake_limit, 3600)


async def test_sixth_create_429_per_ip(client):
    gateway = install(FakeGateway())
    use_limits(5)
    for _ in range(5):
        await create(client)
    calls = len(gateway.calls)
    r = await client.post("/debates", json=BODY)
    assert r.status_code == 429
    assert "Retry-After" in r.headers
    assert len(gateway.calls) == calls  # refused before any paid call


async def test_other_ip_not_limited(client):
    install(FakeGateway())
    use_limits(1)
    await create(client)
    assert (await client.post("/debates", json=BODY)).status_code == 429
    transport = httpx.ASGITransport(app=app, client=("10.9.9.9", 1))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as other:
        assert (await other.post("/debates", json=BODY)).status_code == 201


async def test_clarification_does_not_consume_quota(client):
    install(FakeGateway(thin_intake))
    use_limits(1)
    for _ in range(3):
        r = await client.post("/debates", json={"pitch": PITCH})
        assert r.json()["status"] == "needs_clarification"
    assert (await client.post("/debates", json={"pitch": PITCH, "skip_clarify": True})).status_code == 201
    assert (await client.post("/debates", json={"pitch": PITCH, "skip_clarify": True})).status_code == 429


async def test_intake_limit_stops_thin_and_refused_requests_before_any_call(client):
    gateway = install(FakeGateway(thin_intake))
    use_limits(5, intake_limit=3)
    for _ in range(3):
        assert (await client.post("/debates", json={"pitch": PITCH})).status_code == 200
    calls = len(gateway.calls)
    assert (await client.post("/debates", json={"pitch": PITCH})).status_code == 429
    assert len(gateway.calls) == calls


async def test_refused_pitch_counts_against_intake_limit_not_create_quota(client):
    gateway = install(FakeGateway(lambda c: {"harmful": True, "reason": "No.", "thin": False, "questions": []}
                                  if c["schema"] is not None and c["schema"].__name__ == "_IntakeVerdict" else None))
    use_limits(1, intake_limit=2)
    for _ in range(2):
        assert (await client.post("/debates", json=BODY)).status_code == 422
    calls = len(gateway.calls)
    assert (await client.post("/debates", json=BODY)).status_code == 429
    assert len(gateway.calls) == calls


async def test_invalid_pitch_spends_no_quota(client):
    use_limits(1, intake_limit=1)
    for _ in range(3):
        assert (await client.post("/debates", json={"pitch": "short"})).status_code == 422
    install(FakeGateway())
    assert (await client.post("/debates", json=BODY)).status_code == 201


# ---- limiter unit ----

def test_limiter_allowed_is_read_only_and_window_expires():
    now = [0.0]
    lim = RateLimiter(2, 10, clock=lambda: now[0])
    for _ in range(5):
        assert lim.allowed("a")
    lim.record("a"); lim.record("a")
    assert not lim.allowed("a") and lim.allowed("b")
    now[0] = 10.5
    assert lim.allowed("a")


def test_limiter_check_combines_allowed_and_record():
    lim = RateLimiter(1, 10, clock=lambda: 0.0)
    assert lim.check("a") and not lim.check("a")


def test_limiter_memory_is_pruned():
    now = [0.0]
    lim = RateLimiter(5, 10, clock=lambda: now[0])
    for i in range(1000):
        lim.record(f"ip{i}")
    now[0] = 25.0
    lim.record("fresh")
    assert lim.tracked() == 1


# ---- CORS ----

async def test_cors_only_allows_frontend_origin(client):
    ok = await client.options("/debates", headers={"Origin": "http://localhost:5173",
                                                    "Access-Control-Request-Method": "POST"})
    assert ok.headers["access-control-allow-origin"] == "http://localhost:5173"
    bad = await client.options("/debates", headers={"Origin": "https://evil.example",
                                                     "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in bad.headers
    r = await client.get("/health", headers={"Origin": "http://localhost:5173"})
    assert "content-disposition" in r.headers.get("access-control-expose-headers", "").lower()
