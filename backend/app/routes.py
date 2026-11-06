"""HTTP routes for a debate: create it, watch it, answer it, read it back."""

import json
import secrets
from collections.abc import AsyncIterator, Iterable
from typing import Annotated, Any

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sse_starlette import EventSourceResponse, ServerSentEvent

from app import db
from app.events import Event
from app.guards import intake
from app.llm import Usage, get_gateway
from app.runner import FAILED_MESSAGE, DebateRunner, RebuttalNotOpen, RunnerFull

MIN_PITCH_CHARS = 50
MAX_PITCH_CHARS = 2000
MAX_META_CHARS = 200
MAX_REBUTTAL_CHARS = 500
PING_S = 15
AT_CAPACITY = "The war room is at capacity. Try again in a minute."
# `GET /debates/{id}` is public by unguessable id, so it lists what it returns. The delete
# token hash and feedback in `db.get_debate` stay out.
PUBLIC_DEBATE_FIELDS = ("id", "created_at", "status", "pitch", "pitch_meta", "verdict", "turns")

router = APIRouter()


class CreateDebate(BaseModel):
    pitch: str
    target_user: str | None = Field(default=None, max_length=MAX_META_CHARS)
    pricing: str | None = Field(default=None, max_length=MAX_META_CHARS)
    stage: str | None = Field(default=None, max_length=MAX_META_CHARS)
    skip_clarify: bool = False


class Rebuttal(BaseModel):
    text: str | None = None


def _runner(request: Request) -> DebateRunner:
    return request.app.state.runner


@router.post("/debates", status_code=201, response_model=None)
async def create_debate(body: CreateDebate, request: Request) -> dict[str, str] | JSONResponse:
    pitch = body.pitch.strip()  # clarification answers are already appended by the client
    if not MIN_PITCH_CHARS <= len(pitch) <= MAX_PITCH_CHARS:
        raise HTTPException(422, f"A pitch must be {MIN_PITCH_CHARS} to {MAX_PITCH_CHARS} characters.")
    runner = _runner(request)
    if runner.at_capacity():  # before intake, so a refused request spends nothing
        raise HTTPException(503, AT_CAPACITY)

    meta = body.model_dump(include={"target_user", "pricing", "stage"}, exclude_none=True)
    spent: list[Usage] = []
    screened = await intake(get_gateway(), pitch, meta, on_usage=spent.append)
    if not screened.allowed:
        raise HTTPException(422, screened.refusal_reason)
    if screened.thin and not body.skip_clarify:
        return JSONResponse({"status": "needs_clarification", "questions": screened.questions})

    debate_id = secrets.token_urlsafe(16)
    delete_token = secrets.token_urlsafe(32)
    await db.create_debate(debate_id, pitch, meta, db.hash_token(delete_token))
    try:
        runner.start(debate_id, pitch, meta, spent)
    except RunnerFull:  # other requests took the last slot during the awaits above
        await db.delete_debate(debate_id)
        raise HTTPException(503, AT_CAPACITY) from None
    return {"debate_id": debate_id, "delete_token": delete_token}


@router.get("/debates/{debate_id}")
async def get_debate(debate_id: str) -> dict[str, Any]:
    debate = await db.get_debate(debate_id)
    if debate is None:
        raise HTTPException(404, "Debate not found.")
    return {name: debate[name] for name in PUBLIC_DEBATE_FIELDS}


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
