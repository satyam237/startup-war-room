"""HTTP surface of a debate: create, stream, rebuttal, and read back.

httpx's ASGITransport buffers a whole response, which suits a stream that runs to its end.
`LiveStream` drives the app directly for the tests that read part of a stream or drop it.
"""

import asyncio
import hashlib
import json
import time
from collections.abc import Callable
from typing import Any

import pytest
from sqlalchemy import func, select

from app import db, llm, routes
from app.config import get_settings
from app.events import EventLog
from app.fake_llm import FakeGateway
from app.llm import Usage
from app.main import app
from app.models import DebateRow, FinalPosition
from app.runner import DebateRunner, RebuttalNotOpen, _Run

PITCH = "An app that matches freelance designers with early-stage startups for fixed-price sprints."
BODY = {"pitch": PITCH, "skip_clarify": True}


def configure(monkeypatch: pytest.MonkeyPatch, **env: Any) -> None:
    for name, value in env.items():
        monkeypatch.setenv(name, str(value))
    get_settings.cache_clear()


def runner():
    return app.state.runner


def parse_sse(body: str) -> list[dict[str, Any]]:
    events = []
    for block in body.replace("\r\n", "\n").split("\n\n"):
        fields = dict(
            line.split(": ", 1) for line in block.split("\n") if ": " in line and not line.startswith(":")
        )
        if "event" in fields:
            events.append({"id": fields.get("id"), "event": fields["event"], "data": json.loads(fields["data"])})
    return events


def names(events: list[dict[str, Any]]) -> list[str]:
    return [e["event"] for e in events]


def named(events: list[dict[str, Any]], name: str) -> list[dict[str, Any]]:
    return [e["data"] for e in events if e["event"] == name]


def ids(events: list[dict[str, Any]]) -> list[int]:
    return [int(e["id"]) for e in events]


async def wait_until(condition: Callable[[], Any], timeout: float = 5.0) -> None:
    async with asyncio.timeout(timeout):
        while not condition():
            await asyncio.sleep(0.005)


async def wait_finished(debate_id: str) -> None:
    await wait_until(lambda: runner().active_count() == 0)


class LiveStream:
    def __init__(self, debate_id: str, last_event_id: int | None = None) -> None:
        self.events: list[dict[str, Any]] = []
        self.raw = ""
        self._buffer = ""
        self._gone = asyncio.Event()
        self._asked = False
        headers = [(b"host", b"test")]
        if last_event_id is not None:
            headers.append((b"last-event-id", str(last_event_id).encode()))
        self._scope = {
            "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "GET",
            "scheme": "http", "path": f"/debates/{debate_id}/stream", "raw_path": b"", "query_string": b"",
            "root_path": "", "headers": headers, "client": ("127.0.0.1", 1), "server": ("test", 80),
        }

    async def _receive(self) -> dict[str, Any]:
        if not self._asked:
            self._asked = True
            return {"type": "http.request", "body": b"", "more_body": False}
        await self._gone.wait()
        return {"type": "http.disconnect"}

    async def _send(self, message: dict[str, Any]) -> None:
        if message["type"] != "http.response.body":
            return
        self.raw += message.get("body", b"").decode()
        self._buffer += message.get("body", b"").decode()
        *complete, self._buffer = self._buffer.replace("\r\n", "\n").split("\n\n")
        for block in complete:
            self.events.extend(parse_sse(block + "\n\n"))

    async def __aenter__(self) -> "LiveStream":
        self._task = asyncio.create_task(app(self._scope, self._receive, self._send))
        return self

    async def __aexit__(self, *_exc: Any) -> None:
        await self.drop()

    async def drop(self) -> None:
        self._gone.set()
        await self._task

    async def until(self, name: str) -> None:
        await wait_until(lambda: name in names(self.events))


def install(gateway: FakeGateway) -> FakeGateway:
    llm.set_gateway(gateway)
    return gateway


async def create(client, body: dict[str, Any] = BODY) -> str:
    r = await client.post("/debates", json=body)
    assert r.status_code == 201, r.text
    return r.json()["debate_id"]


async def run_to_end(client, monkeypatch) -> str:
    """A finished debate whose log has already been evicted."""
    configure(monkeypatch, REBUTTAL_TIMEOUT_S=0.01)
    runner().log_retention_s = 0
    debate_id = await create(client)
    await wait_finished(debate_id)
    await wait_until(lambda: runner().log(debate_id) is None)
    return debate_id


async def test_create_then_stream_in_order(client, monkeypatch):
    configure(monkeypatch, REBUTTAL_TIMEOUT_S=0.05)
    r = await client.post("/debates", json=BODY)
    assert r.status_code == 201
    debate_id, token = r.json()["debate_id"], r.json()["delete_token"]
    assert len(debate_id) >= 16 and token

    r = await client.get(f"/debates/{debate_id}/stream")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    assert r.headers["x-accel-buffering"] == "no"
    events = parse_sse(r.text)

    assert ids(events) == list(range(1, len(events) + 1))
    order = [n for n in names(events) if n not in ("turn_token", "setup", "turn_start")]
    assert order == (
        ["turn_end"] * 4 + ["checkpoint", "await_rebuttal", "rebuttal_received"]
        + ["turn_end"] * 4 + ["checkpoint"] + ["turn_end"] * 4 + ["verdict", "done"]
    )
    assert events[0]["event"] == "setup"
    assert named(events, "done") == [{"status": "complete"}]

    stored = await db.get_debate(debate_id)
    assert stored["delete_token_hash"] == hashlib.sha256(token.encode()).hexdigest()
    assert stored["status"] == "complete"


async def test_stream_of_unknown_debate_404(client):
    assert (await client.get("/debates/nope/stream")).status_code == 404


async def test_rebuttal_accepted_at_checkpoint(client):
    gateway = install(FakeGateway())
    debate_id = await create(client)
    async with LiveStream(debate_id) as stream:
        await stream.until("await_rebuttal")
        r = await client.post(f"/debates/{debate_id}/rebuttal", json={"text": "We already have ten paying teams."})
        assert r.status_code == 200
        await stream.until("done")
    assert named(stream.events, "rebuttal_received") == [{"text": "We already have ten paying teams."}]
    assert any("We already have ten paying teams." in c["user"] for c in gateway.calls)


async def test_empty_rebuttal_is_a_skip(client):
    debate_id = await create(client)
    async with LiveStream(debate_id) as stream:
        await stream.until("await_rebuttal")
        r = await client.post(f"/debates/{debate_id}/rebuttal", json={"text": ""})
        assert r.status_code == 200
        await stream.until("done")
    assert named(stream.events, "rebuttal_received") == [{"text": None}]


async def test_second_rebuttal_for_the_same_window_409(client):
    debate_id = await create(client)
    async with LiveStream(debate_id) as stream:
        await stream.until("await_rebuttal")
        first = await client.post(f"/debates/{debate_id}/rebuttal", json={"text": "first"})
        second = await client.post(f"/debates/{debate_id}/rebuttal", json={"text": "second"})
        await stream.until("done")
    assert (first.status_code, second.status_code) == (200, 409)
    assert named(stream.events, "rebuttal_received") == [{"text": "first"}]


async def test_rebuttal_too_long_422(client):
    debate_id = await create(client)
    async with LiveStream(debate_id) as stream:
        await stream.until("await_rebuttal")
        r = await client.post(f"/debates/{debate_id}/rebuttal", json={"text": "x" * 501})
        assert r.status_code == 422 and isinstance(r.json()["detail"], str)
        r = await client.post(f"/debates/{debate_id}/rebuttal", json={"text": "x" * 500})
        assert r.status_code == 200
        await stream.until("done")


async def test_rebuttal_when_not_waiting_409(client):
    install(FakeGateway(delay_s=0.002))
    debate_id = await create(client)
    r = await client.post(f"/debates/{debate_id}/rebuttal", json={"text": "too early"})
    assert r.status_code == 409 and isinstance(r.json()["detail"], str)

    log = runner().log(debate_id)
    await wait_until(lambda: log._events[-1].event == "await_rebuttal")
    await client.post(f"/debates/{debate_id}/rebuttal", json={"text": ""})
    await wait_finished(debate_id)
    r = await client.post(f"/debates/{debate_id}/rebuttal", json={"text": "too late"})
    assert r.status_code == 409


async def test_rebuttal_for_unknown_debate_404(client):
    r = await client.post("/debates/nope/rebuttal", json={"text": "hello"})
    assert r.status_code == 404


async def test_rebuttal_timeout_auto_continues(client, monkeypatch):
    """Review Focus 1: nobody is connected, and the debate still ends with a verdict."""
    configure(monkeypatch, REBUTTAL_TIMEOUT_S=0.05)
    debate_id = await create(client)
    log = runner().log(debate_id)
    await wait_finished(debate_id)

    events = [(e.event, e.data) async for e in log.subscribe()]
    assert ("await_rebuttal", {"timeout_s": 0.05}) in events
    assert ("rebuttal_received", {"text": None}) in events
    stored = await db.get_debate(debate_id)
    assert stored["status"] == "complete" and stored["verdict"] is not None


async def test_disconnect_does_not_stop_debate(client):
    install(FakeGateway(delay_s=0.001))
    debate_id = await create(client)
    async with LiveStream(debate_id) as stream:
        await stream.until("turn_token")
        await stream.drop()
        seen = len(stream.events)
        await wait_until(lambda: runner().log(debate_id)._events[-1].event == "await_rebuttal")
        await client.post(f"/debates/{debate_id}/rebuttal", json={"text": ""})
        await wait_finished(debate_id)
    assert len(stream.events) == seen
    stored = await db.get_debate(debate_id)
    assert stored["status"] == "complete" and stored["verdict"] is not None


async def test_reconnect_with_last_event_id(client):
    """Review Focus 2: no gaps, no duplicates, and a no-header tab replays from the first event."""
    install(FakeGateway(delay_s=0.001))
    debate_id = await create(client)
    async with LiveStream(debate_id) as first:
        await first.until("turn_end")
        await first.drop()
    seen = first.events
    assert seen

    async with LiveStream(debate_id, last_event_id=int(seen[-1]["id"])) as resumed:
        async with LiveStream(debate_id) as second_tab:
            await resumed.until("await_rebuttal")
            await client.post(f"/debates/{debate_id}/rebuttal", json={"text": ""})
            await resumed.until("done")
            await second_tab.until("done")

    joined = seen + resumed.events
    assert ids(joined) == list(range(1, len(joined) + 1))
    assert second_tab.events == joined
    assert names(joined)[-1] == "done"


async def test_stream_ignores_a_malformed_last_event_id(client, monkeypatch):
    debate_id = await run_to_end(client, monkeypatch)
    r = await client.get(f"/debates/{debate_id}/stream", headers={"Last-Event-ID": "junk"})
    assert ids(parse_sse(r.text))[0] == 1


async def test_stream_finished_log_within_retention_replays_the_log(client, monkeypatch):
    configure(monkeypatch, REBUTTAL_TIMEOUT_S=0.01)
    debate_id = await create(client)
    await wait_finished(debate_id)
    assert runner().log(debate_id) is not None
    events = parse_sse((await client.get(f"/debates/{debate_id}/stream")).text)
    assert "turn_token" in names(events)
    assert names(events)[-1] == "done"


async def test_stream_finished_debate_replays_from_db(client, monkeypatch):
    debate_id = await run_to_end(client, monkeypatch)
    events = parse_sse((await client.get(f"/debates/{debate_id}/stream")).text)

    assert ids(events) == list(range(1, len(events) + 1))
    assert names(events) == (
        ["turn_end"] * 4 + ["checkpoint"] + ["turn_end"] * 4 + ["checkpoint"] + ["turn_end"] * 4 + ["verdict", "done"]
    )
    turn = named(events, "turn_end")[0]
    assert turn["turn_id"] == f"r1-{turn['agent']}" and turn["round"] == 1 and turn["text"]
    assert "final_position" not in turn
    for checkpoint in named(events, "checkpoint"):
        assert checkpoint["summary"]
        assert len(checkpoint["top_disagreements"]) == 2
    finals = [t for t in named(events, "turn_end") if t["round"] == 3]
    assert len(finals) == 4
    for final in finals:
        FinalPosition.model_validate(final["final_position"])
    assert named(events, "verdict")[0]["recommendation"] == "pivot"
    assert named(events, "done") == [{"status": "complete"}]


async def test_rebuilt_stream_honours_last_event_id(client, monkeypatch):
    debate_id = await run_to_end(client, monkeypatch)
    url = f"/debates/{debate_id}/stream"
    full = parse_sse((await client.get(url)).text)
    rest = parse_sse((await client.get(url, headers={"Last-Event-ID": "5"})).text)
    assert rest == full[5:]


async def test_client_ahead_of_the_rebuilt_stream_still_gets_a_usable_ending(client, monkeypatch):
    """Its id came from the longer live log. The reducer drops any seq it has passed."""
    debate_id = await run_to_end(client, monkeypatch)
    r = await client.get(f"/debates/{debate_id}/stream", headers={"Last-Event-ID": "500"})
    events = parse_sse(r.text)
    assert names(events) == ["verdict", "done"]
    assert ids(events) == [501, 502]


async def test_stream_failed_debate_sends_error_done(client):
    await db.create_debate("gone", PITCH)
    await db.add_turn("gone", 1, "vc", "a turn from before the crash")
    await db.update_debate("gone", status="failed")
    events = parse_sse((await client.get("/debates/gone/stream")).text)
    assert names(events) == ["error", "done"]
    assert ids(events) == [1, 2]
    assert events[0]["data"]["recoverable"] is False and events[0]["data"]["message"]
    assert events[1]["data"] == {"status": "failed"}


async def test_failed_debate_reaches_a_client_that_was_mid_stream(client):
    """Review Focus 4: after a restart the reconnecting tab has a high id and must not hang."""
    await db.create_debate("gone", PITCH)
    await db.update_debate("gone", status="failed")
    r = await client.get("/debates/gone/stream", headers={"Last-Event-ID": "300"})
    events = parse_sse(r.text)
    assert names(events) == ["error", "done"]
    assert ids(events) == [301, 302]


async def test_running_row_with_no_log_is_reported_failed(client):
    await db.create_debate("orphan", PITCH)
    events = parse_sse((await client.get("/debates/orphan/stream")).text)
    assert names(events) == ["error", "done"]
    assert events[1]["data"] == {"status": "failed"}


def thin_intake(call: dict[str, Any]) -> Any:
    if call["schema"] is not None and call["schema"].__name__ == "_IntakeVerdict":
        return {"harmful": False, "reason": None, "thin": True, "questions": ["Who pays?", "How much?", "Why now?"]}
    return None


async def test_thin_pitch_needs_clarification(client):
    install(FakeGateway(thin_intake))
    r = await client.post("/debates", json={"pitch": PITCH})
    assert r.status_code == 200
    assert r.json() == {"status": "needs_clarification", "questions": ["Who pays?", "How much?"]}
    assert runner().active_count() == 0


async def test_skip_clarify_creates(client):
    install(FakeGateway(thin_intake))
    r = await client.post("/debates", json={"pitch": PITCH, "skip_clarify": True})
    assert r.status_code == 201
    stored = await db.get_debate(r.json()["debate_id"])
    assert stored["pitch"] == PITCH


async def test_meta_is_stored_and_blanks_are_left_out(client):
    r = await client.post("/debates", json={**BODY, "target_user": "Designers", "pricing": "$99", "stage": None})
    stored = await db.get_debate(r.json()["debate_id"])
    assert stored["pitch_meta"] == {"target_user": "Designers", "pricing": "$99"}


@pytest.mark.parametrize("pitch", ["x" * 49, "x" * 2001, " " * 60])
async def test_short_pitch_422(client, pitch):
    gateway = install(FakeGateway())
    r = await client.post("/debates", json={"pitch": pitch})
    assert r.status_code == 422 and isinstance(r.json()["detail"], str)
    assert gateway.calls == []


@pytest.mark.parametrize("length", [50, 2000])
async def test_pitch_length_boundaries_accepted(client, length):
    r = await client.post("/debates", json={"pitch": "x" * length, "skip_clarify": True})
    assert r.status_code == 201


async def test_clarification_answers_count_towards_the_limit(client):
    answers = "\n\nWho pays? Founders."
    r = await client.post("/debates", json={"pitch": "x" * 1990 + answers, "skip_clarify": True})
    assert r.status_code == 422


async def test_oversized_meta_422(client):
    r = await client.post("/debates", json={**BODY, "target_user": "x" * 201})
    assert r.status_code == 422


async def test_refused_pitch_422(client):
    def script(call):
        if call["schema"] is not None and call["schema"].__name__ == "_IntakeVerdict":
            return {"harmful": True, "reason": "This would facilitate fraud.", "thin": False, "questions": []}
        return None

    install(FakeGateway(script))
    r = await client.post("/debates", json=BODY)
    assert r.status_code == 422
    assert r.json()["detail"] == "This would facilitate fraud."


async def test_intake_tokens_count_against_the_debate(client, monkeypatch):
    configure(monkeypatch, REBUTTAL_TIMEOUT_S=0.01, MAX_TOKENS_PER_DEBATE=100)
    install(FakeGateway(usage_per_call=(60, 40, 0.25)))
    debate_id = await create(client)
    await wait_finished(debate_id)
    stored = await db.get_debate(debate_id)
    # Intake spends the whole budget, so only the persona call runs before the fallback.
    assert stored["status"] == "budget_exceeded"
    assert stored["total_tokens"] == 200 and stored["est_cost"] == 0.5


async def test_concurrency_cap_503(client, monkeypatch):
    configure(monkeypatch, MAX_CONCURRENT_DEBATES=1)
    gateway = install(FakeGateway())
    debate_id = await create(client)
    assert runner().active_count() == 1

    assert (await client.post("/debates", json=BODY)).status_code == 503
    async with LiveStream(debate_id) as stream:
        await stream.until("await_rebuttal")
        calls_before = len(gateway.calls)
        assert (await client.post("/debates", json=BODY)).status_code == 503
        assert len(gateway.calls) == calls_before  # the refusal spent nothing
        await client.post(f"/debates/{debate_id}/rebuttal", json={"text": ""})
        await stream.until("done")
    await wait_finished(debate_id)
    assert runner().active_count() == 0
    assert (await client.post("/debates", json=BODY)).status_code == 201


async def test_cap_reached_during_intake_leaves_no_row(client, monkeypatch):
    configure(monkeypatch, MAX_CONCURRENT_DEBATES=1)
    install(FakeGateway(delay_s=0.01))
    first, second = await asyncio.gather(
        client.post("/debates", json=BODY), client.post("/debates", json=BODY)
    )
    assert sorted((first.status_code, second.status_code)) == [201, 503]
    winner = first if first.status_code == 201 else second
    async with db._get_sessionmaker()() as session:
        assert await session.scalar(select(func.count()).select_from(DebateRow)) == 1
    assert winner.json()["debate_id"]


async def test_get_debate_full_json(client, monkeypatch):
    debate_id = await run_to_end(client, monkeypatch)
    r = await client.get(f"/debates/{debate_id}")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == debate_id and body["status"] == "complete" and body["pitch"] == PITCH
    assert body["pitch_meta"] == {} and body["created_at"]
    assert body["verdict"]["recommendation"] == "pivot"
    assert len(body["turns"]) == 14
    moderator = next(t for t in body["turns"] if t["agent"] == "moderator")
    assert len(moderator["details"]["top_disagreements"]) == 2
    assert "delete_token_hash" not in r.text
    assert (await db.get_debate(debate_id))["delete_token_hash"] not in r.text


async def test_get_unknown_debate_404(client):
    assert (await client.get("/debates/nope")).status_code == 404


async def test_runner_crash_marks_failed_and_ends_the_stream(client, monkeypatch):
    async def explode(*_args, **_kwargs):
        raise RuntimeError("secret database detail")

    monkeypatch.setattr(db, "add_turn", explode)
    debate_id = await create(client)
    log = runner().log(debate_id)
    events = parse_sse((await client.get(f"/debates/{debate_id}/stream")).text)

    assert names(events)[-2:] == ["error", "done"]
    assert events[-2]["data"]["recoverable"] is False
    assert "secret" not in json.dumps(events[-2]["data"])
    assert events[-1]["data"] == {"status": "failed"}
    assert ids(events) == list(range(1, len(events) + 1))
    assert log._closed
    await wait_finished(debate_id)
    assert (await db.get_debate(debate_id))["status"] == "failed"


async def test_crash_with_a_broken_database_still_ends_the_stream(client, monkeypatch):
    async def explode(*_args, **_kwargs):
        raise RuntimeError("database down")

    monkeypatch.setattr(db, "add_turn", explode)
    monkeypatch.setattr(db, "update_debate", explode)
    debate_id = await create(client)
    events = parse_sse((await client.get(f"/debates/{debate_id}/stream")).text)
    assert names(events)[-2:] == ["error", "done"]
    assert runner().active_count() == 0


async def test_closed_log_is_evicted_after_the_retention_period(client, monkeypatch):
    configure(monkeypatch, REBUTTAL_TIMEOUT_S=0.01)
    assert runner().log_retention_s == 600
    runner().log_retention_s = 0.05
    debate_id = await create(client)
    await wait_finished(debate_id)
    assert runner().log(debate_id) is not None
    await wait_until(lambda: runner().log(debate_id) is None)


async def test_crashed_debate_log_is_evicted_too(client, monkeypatch):
    async def explode(*_args, **_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(db, "add_turn", explode)
    runner().log_retention_s = 0
    debate_id = await create(client)
    await wait_finished(debate_id)
    await wait_until(lambda: runner().log(debate_id) is None)


async def test_shutdown_marks_running_debates_failed(client):
    install(FakeGateway(delay_s=0.01))
    debate_id = await create(client)
    log = runner().log(debate_id)
    await runner().shutdown()
    assert (await db.get_debate(debate_id))["status"] == "failed"
    assert log._events[-1].event == "done" and log._closed
    assert runner().active_count() == 0


async def test_intake_has_a_wall_clock_limit_and_fails_open(client, monkeypatch):
    """A hung provider must not outlast the platform's 30s request limit."""
    assert routes.INTAKE_TIMEOUT_S == 20
    monkeypatch.setattr(routes, "INTAKE_TIMEOUT_S", 0.02)

    def refuse(call):  # would refuse, if intake ever got to answer
        if call["schema"] is not None and call["schema"].__name__ == "_IntakeVerdict":
            return {"harmful": True, "reason": "No.", "thin": False, "questions": []}
        return None

    install(FakeGateway(refuse, delay_s=0.3))
    started = time.monotonic()
    r = await client.post("/debates", json=BODY)
    assert r.status_code == 201
    assert time.monotonic() - started < 0.25


async def test_intake_timeout_keeps_usage_so_far(client, monkeypatch):
    configure(monkeypatch, REBUTTAL_TIMEOUT_S=0.01, MAX_TOKENS_PER_DEBATE=100)
    monkeypatch.setattr(routes, "INTAKE_TIMEOUT_S", 0.02)

    async def slow_intake(_gw, _pitch, _meta, on_usage):
        on_usage(Usage(model="fake/fast", tokens_in=70, tokens_out=30, cost_usd=0.25, latency_ms=0))
        await asyncio.sleep(1)

    monkeypatch.setattr(routes, "intake", slow_intake)
    install(FakeGateway(usage_per_call=(1, 1, 0.0)))
    debate_id = await create(client)
    await wait_finished(debate_id)
    stored = await db.get_debate(debate_id)
    assert stored["status"] == "budget_exceeded"  # the budget was spent before the persona ran
    assert stored["total_tokens"] == 102 and stored["est_cost"] == 0.25


async def post_then_vanish(body: dict[str, Any]) -> list[dict[str, Any]]:
    """POST through ASGI with a client that has gone by the time the handler looks."""
    sent: list[dict[str, Any]] = []
    messages = [{"type": "http.request", "body": json.dumps(body).encode(), "more_body": False}]

    async def receive() -> dict[str, Any]:
        return messages.pop() if messages else {"type": "http.disconnect"}

    async def send(message: dict[str, Any]) -> None:
        sent.append(message)

    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST",
        "scheme": "http", "path": "/debates", "raw_path": b"/debates", "query_string": b"",
        "root_path": "", "headers": [(b"host", b"test"), (b"content-type", b"application/json")],
        "client": ("127.0.0.1", 1), "server": ("test", 80),
    }
    await app(scope, receive, send)
    return sent


async def test_client_gone_after_intake_starts_nothing(client):
    gateway = install(FakeGateway())
    sent = await post_then_vanish(BODY)
    assert sent[0]["status"] == 499
    assert len(gateway.calls) == 1  # intake only
    assert runner().active_count() == 0
    async with db._get_sessionmaker()() as session:
        assert await session.scalar(select(func.count()).select_from(DebateRow)) == 0


async def test_shutdown_after_report_keeps_the_finished_status(client, monkeypatch):
    async def finish_then_linger(self, debate_id, run, *_args):
        await db.update_debate(debate_id, status="complete")
        run.log.publish("done", {"status": "complete"})
        await asyncio.sleep(60)  # stands in for the final checkpoint write

    monkeypatch.setattr(DebateRunner, "_drive", finish_then_linger)
    debate_id = await create(client)
    log = runner().log(debate_id)
    await wait_until(lambda: log.last_event is not None)
    await runner().shutdown()

    assert (await db.get_debate(debate_id))["status"] == "complete"
    assert [e.event async for e in log.subscribe()] == ["done"]


async def test_crash_after_report_keeps_the_finished_status(client, monkeypatch):
    async def finish_then_crash(self, debate_id, run, *_args):
        await db.update_debate(debate_id, status="complete")
        run.log.publish("done", {"status": "complete"})
        raise RuntimeError("the final checkpoint write failed")

    monkeypatch.setattr(DebateRunner, "_drive", finish_then_crash)
    debate_id = await create(client)
    log = runner().log(debate_id)
    await wait_finished(debate_id)
    assert (await db.get_debate(debate_id))["status"] == "complete"
    assert [e.event async for e in log.subscribe()] == ["done"]


async def test_failed_debate_saves_what_it_spent(client, monkeypatch):
    real_add_turn, written = db.add_turn, []

    async def fail_on_second_turn(*args, **kwargs):
        written.append(args)
        if len(written) == 2:
            raise RuntimeError("boom")
        return await real_add_turn(*args, **kwargs)

    monkeypatch.setattr(db, "add_turn", fail_on_second_turn)
    install(FakeGateway(usage_per_call=(10, 5, 0.01)))
    debate_id = await create(client)
    await wait_finished(debate_id)
    stored = await db.get_debate(debate_id)
    assert stored["status"] == "failed"
    # Intake, persona, turn 1, then turn 2 and its repeat check, which were still in the
    # node that crashed: 5 calls.
    assert stored["total_tokens"] == 75
    assert stored["est_cost"] == pytest.approx(0.05)


async def test_debate_stopped_by_shutdown_saves_what_it_spent(client):
    install(FakeGateway(usage_per_call=(10, 5, 0.01)))
    debate_id = await create(client)
    log = runner().log(debate_id)
    await wait_until(lambda: "await_rebuttal" in [e.event for e in log._events])
    await runner().shutdown()
    stored = await db.get_debate(debate_id)
    assert stored["status"] == "failed" and stored["total_tokens"] > 0


async def test_rebuttal_text_is_stored_and_returned(client):
    debate_id = await create(client)
    async with LiveStream(debate_id) as stream:
        await stream.until("await_rebuttal")
        await client.post(f"/debates/{debate_id}/rebuttal", json={"text": "  We have ten paying teams.  "})
        await stream.until("done")
    assert (await client.get(f"/debates/{debate_id}")).json()["rebuttal"] == "We have ten paying teams."


async def test_skipped_rebuttal_is_null(client, monkeypatch):
    debate_id = await run_to_end(client, monkeypatch)
    body = (await client.get(f"/debates/{debate_id}")).json()
    assert "rebuttal" in body and body["rebuttal"] is None


async def open_window(timeout_s: float) -> tuple[DebateRunner, asyncio.Task[str | None]]:
    debate_runner, run = DebateRunner(), _Run(log=EventLog())
    debate_runner._runs["d"] = run
    waiting = asyncio.create_task(debate_runner._await_rebuttal(run, {"timeout_s": timeout_s}))
    await asyncio.sleep(0)  # the window is open
    return debate_runner, waiting


async def test_rebuttal_at_the_timeout_boundary_is_kept():
    """The answer lands after the deadline passed but before the timer has been handled."""
    debate_runner, waiting = await open_window(0.01)
    time.sleep(0.03)  # blocks the loop on purpose, so the timer cannot fire first
    debate_runner.submit_rebuttal("d", "just in time")
    assert await waiting == "just in time"


async def test_rebuttal_after_the_window_closed_is_refused():
    debate_runner, waiting = await open_window(0.01)
    assert await waiting is None
    with pytest.raises(RebuttalNotOpen):
        debate_runner.submit_rebuttal("d", "too late")


async def test_stream_sends_keep_alive_pings(client, monkeypatch):
    assert routes.PING_S == 15
    monkeypatch.setattr(routes, "PING_S", 0.01)
    debate_id = await create(client)
    async with LiveStream(debate_id) as stream:
        await stream.until("await_rebuttal")
        await wait_until(lambda: ": ping" in stream.raw)
        await client.post(f"/debates/{debate_id}/rebuttal", json={"text": ""})
        await stream.until("done")
