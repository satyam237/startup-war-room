"""HTTP routes for a debate: create it, watch it, answer it, read it back."""

import asyncio
import hmac
import json
import logging
import secrets
from collections.abc import AsyncIterator, Iterable
from typing import Annotated, Any

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from sse_starlette import EventSourceResponse, ServerSentEvent

from app import db
from app.events import Event
from app.export import render_markdown
from app.guards import IntakeResult, intake
from app.llm import Usage, get_gateway
from app.runner import FAILED_MESSAGE, DebateRunner, RebuttalNotOpen, RunnerFull

logger = logging.getLogger("app.routes")

MIN_PITCH_CHARS = 50
MAX_PITCH_CHARS = 2000
MAX_META_CHARS = 200
MAX_REBUTTAL_CHARS = 500
PING_S = 15
# Heroku cuts a request at 30s, then the handler would start a debate nobody can see.
# The `fast` tier alone can take 15s per attempt, with retries on top.
INTAKE_TIMEOUT_S = 20
CLIENT_CLOSED_REQUEST = 499
AT_CAPACITY = "The war room is at capacity. Try again in a minute."
TOO_MANY = "Too many requests from this address. Try again later."
MAX_COMMENT_CHARS = 2000
# `GET /debates/{id}` is public by unguessable id, so it lists what it returns. The delete
# token hash and feedback in `db.get_debate` stay out.
PUBLIC_DEBATE_FIELDS = ("id", "created_at", "status", "pitch", "pitch_meta", "rebuttal", "verdict", "turns")

router = APIRouter()


class CreateDebate(BaseModel):
    pitch: str
    target_user: str | None = Field(default=None, max_length=MAX_META_CHARS)
    pricing: str | None = Field(default=None, max_length=MAX_META_CHARS)
    stage: str | None = Field(default=None, max_length=MAX_META_CHARS)
    skip_clarify: bool = False


class Rebuttal(BaseModel):
    text: str | None = None


class Feedback(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=MAX_COMMENT_CHARS)


def _runner(request: Request) -> DebateRunner:
    return request.app.state.runner


@router.post("/debates", status_code=201, response_model=None)
async def create_debate(body: CreateDebate, request: Request) -> dict[str, str] | Response:
    pitch = body.pitch.strip()  # clarification answers are already appended by the client
    if not MIN_PITCH_CHARS <= len(pitch) <= MAX_PITCH_CHARS:
        raise HTTPException(422, f"A pitch must be {MIN_PITCH_CHARS} to {MAX_PITCH_CHARS} characters.")
    runner = _runner(request)
    if runner.at_capacity():  # before intake, so a refused request spends nothing
        raise HTTPException(503, AT_CAPACITY)

    ip = request.client.host if request.client else "unknown"
    create_limiter, intake_limiter = request.app.state.create_limiter, request.app.state.intake_limiter
    for limiter in (create_limiter, intake_limiter):  # read-only, and before any paid call
        if not limiter.allowed(ip):
            raise HTTPException(429, TOO_MANY, headers={"Retry-After": str(limiter.retry_after_s(ip))})
    intake_limiter.record(ip)  # every intake call costs money, so thin and refused pitches count here

    meta = body.model_dump(include={"target_user", "pricing", "stage"}, exclude_none=True)
    spent: list[Usage] = []
    try:
        async with asyncio.timeout(INTAKE_TIMEOUT_S):
            screened = await intake(get_gateway(), pitch, meta, on_usage=spent.append)
    except TimeoutError:  # fails open, like any other intake failure
        logger.warning("intake hit its time limit, allowing the pitch")
        screened = IntakeResult(allowed=True)
    if not screened.allowed:
        raise HTTPException(422, screened.refusal_reason)
    if screened.thin and not body.skip_clarify:
        return JSONResponse({"status": "needs_clarification", "questions": screened.questions})

    if await request.is_disconnected():  # nobody would ever hold the id or the delete token
        return Response(status_code=CLIENT_CLOSED_REQUEST)

    debate_id = secrets.token_urlsafe(16)
    delete_token = secrets.token_urlsafe(32)
    await db.create_debate(debate_id, pitch, meta, db.hash_token(delete_token))
    try:
        runner.start(debate_id, pitch, meta, spent)
    except RunnerFull:  # other requests took the last slot during the awaits above
        await db.delete_debate(debate_id)
        raise HTTPException(503, AT_CAPACITY) from None
    create_limiter.record(ip)  # only a started debate uses the per-IP debate quota
    return {"debate_id": debate_id, "delete_token": delete_token}


@router.get("/debates/{debate_id}")
async def get_debate(debate_id: str) -> dict[str, Any]:
    debate = await db.get_debate(debate_id)
    if debate is None:
        raise HTTPException(404, "Debate not found.")
    return {name: debate[name] for name in PUBLIC_DEBATE_FIELDS}


@router.get("/debates/{debate_id}/export")
async def export_debate(debate_id: str, format: Annotated[str, Query(pattern="^md$")] = "md") -> Response:
    debate = await db.get_debate(debate_id)
    if debate is None:
        raise HTTPException(404, "Debate not found.")
    if debate["status"] == "running" or debate["verdict"] is None:
        raise HTTPException(409, "This debate has no finished report to export.")
    return Response(
        render_markdown(debate),
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="war-room-{debate_id}.md"'},
    )


@router.post("/debates/{debate_id}/feedback", status_code=201)
async def post_feedback(debate_id: str, body: Feedback) -> dict[str, str]:
    if await db.get_debate(debate_id) is None:
        raise HTTPException(404, "Debate not found.")
    await db.add_feedback(debate_id, body.rating, body.comment)
    return {"status": "recorded"}


@router.delete("/debates/{debate_id}", status_code=204)
async def delete_debate(
    debate_id: str,
    request: Request,
    delete_token: Annotated[str | None, Header(alias="X-Delete-Token")] = None,
) -> Response:
    debate = await db.get_debate(debate_id)
    if debate is None:
        raise HTTPException(404, "Debate not found.")
    stored_hash = debate["delete_token_hash"]
    # Check the token before anything else, so a wrong token learns nothing about the state.
    if not delete_token or not stored_hash or not hmac.compare_digest(db.hash_token(delete_token), stored_hash):
        raise HTTPException(403, "Invalid delete token.")
    runner = _runner(request)
    if debate["status"] == "running" or runner.is_running(debate_id):
        raise HTTPException(409, "This debate is still running. Delete it once it has finished.")
    await db.delete_debate(debate_id)
    runner.evict_log(debate_id)
    return Response(status_code=204)


@router.post("/debates/{debate_id}/rebuttal")
async def post_rebuttal(debate_id: str, body: Rebuttal, request: Request) -> dict[str, str]:
    if len(body.text or "") > MAX_REBUTTAL_CHARS:
        raise HTTPException(422, f"A rebuttal must be at most {MAX_REBUTTAL_CHARS} characters.")
    try:
        _runner(request).submit_rebuttal(debate_id, body.text or None)
    except RebuttalNotOpen:
        if await db.get_debate(debate_id) is None:
            raise HTTPException(404, "Debate not found.") from None
        raise HTTPException(409, "This debate is not waiting for a rebuttal.") from None
    return {"status": "accepted"}


@router.get("/debates/{debate_id}/stream")
async def stream_debate(
    debate_id: str,
    request: Request,
    last_event_id: Annotated[str | None, Header(alias="Last-Event-ID")] = None,
) -> EventSourceResponse:
    after = _parse_seq(last_event_id)
    log = _runner(request).log(debate_id)
    if log is not None:
        events = log.subscribe(after)
    else:
        debate = await db.get_debate(debate_id)
        if debate is None:
            raise HTTPException(404, "Debate not found.")
        events = _iterate(rebuilt_events(debate, after))
    return EventSourceResponse(_to_sse(events), ping=PING_S, headers={"X-Accel-Buffering": "no"})


def _parse_seq(header: str | None) -> int:
    try:
        return max(int(header or 0), 0)
    except ValueError:
        return 0


async def _to_sse(events: AsyncIterator[Event]) -> AsyncIterator[ServerSentEvent]:
    async for e in events:
        yield ServerSentEvent(data=json.dumps(e.data, ensure_ascii=False), event=e.event, id=str(e.seq))


async def _iterate(events: list[Event]) -> AsyncIterator[Event]:
    for event in events:
        yield event


def _numbered(events: Iterable[tuple[str, dict[str, Any]]], first_seq: int) -> list[Event]:
    return [Event(seq=seq, event=name, data=data) for seq, (name, data) in enumerate(events, first_seq)]


def _stored_events(debate: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    """A finished debate as the contract's events. Tokens, persona and rebuttal are not stored."""
    events: list[tuple[str, dict[str, Any]]] = []
    for turn in debate["turns"]:
        details = turn["details"] or {}
        if turn["agent"] == "moderator":
            data = {
                "round": turn["round"],
                "summary": turn["text"],
                "top_disagreements": details.get("top_disagreements", []),
            }
            events.append(("checkpoint", data))
        else:
            data = {
                "turn_id": f"r{turn['round']}-{turn['agent']}",
                "agent": turn["agent"],
                "round": turn["round"],
                "text": turn["text"],
            }
            if "final_position" in details:
                data["final_position"] = details["final_position"]
            events.append(("turn_end", data))
    if debate["verdict"] is not None:
        events.append(("verdict", debate["verdict"]))
    events.append(("done", {"status": debate["status"]}))
    return events


def rebuilt_events(debate: dict[str, Any], after: int) -> list[Event]:
    """What a client gets once the live log is gone, past `after` (its Last-Event-ID).

    Rebuilt events number from 1, but a client may hold a higher id from the live log,
    which also had tokens. The client drops any seq it has passed, so an ending that must
    reach it is numbered after `after`, or the page would wait forever. `running` can only
    mean the log is gone with no ending recorded, so it is reported as failed.
    """
    if debate["status"] in ("failed", "running"):
        ending = [("error", {"message": FAILED_MESSAGE, "recoverable": False}), ("done", {"status": "failed"})]
        return _numbered(ending, after + 1)
    stored = _stored_events(debate)
    if after < len(stored):
        return _numbered(stored, 1)[after:]
    return _numbered([e for e in stored if e[0] in ("verdict", "done")], after + 1)
