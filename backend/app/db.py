import hashlib
from typing import Any

from sqlalchemy import delete, event, select, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings
from app.models import Base, DebateRow, FeedbackRow, TurnRow, Verdict, VerdictRow

_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def _get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    """Engine is built lazily from the current DATABASE_URL (tests swap it)."""
    global _engine, _sessionmaker
    if _sessionmaker is None:
        url = get_settings().DATABASE_URL
        _engine = create_async_engine(url)
        if url.startswith("sqlite"):

            @event.listens_for(_engine.sync_engine, "connect")
            def _fk_on(dbapi_conn, _record):  # enforce ON DELETE CASCADE
                dbapi_conn.execute("PRAGMA foreign_keys=ON")

        _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False)
    return _sessionmaker


async def reset_engine() -> None:
    """Dispose the engine so the next call rebuilds it from current settings."""
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sessionmaker = None


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def init_db() -> None:
    _get_sessionmaker()
    assert _engine is not None
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


def _debate_dict(row: DebateRow) -> dict[str, Any]:
    return {
        "id": row.id,
        "created_at": row.created_at,
        "pitch": row.pitch,
        "pitch_meta": row.pitch_meta,
        "status": row.status,
        "total_tokens": row.total_tokens,
        "est_cost": row.est_cost,
        "delete_token_hash": row.delete_token_hash,
        "rebuttal": row.rebuttal,
    }


async def create_debate(
    debate_id: str,
    pitch: str,
    pitch_meta: dict | None = None,
    delete_token_hash: str | None = None,
) -> dict[str, Any]:
    async with _get_sessionmaker()() as s:
        row = DebateRow(
            id=debate_id,
            pitch=pitch,
            pitch_meta=pitch_meta or {},
            status="running",
            delete_token_hash=delete_token_hash,
        )
        s.add(row)
        await s.commit()
        return _debate_dict(row)


async def get_debate(debate_id: str) -> dict[str, Any] | None:
    """Full debate with turns, verdict (or None) and feedback; None if missing."""
    async with _get_sessionmaker()() as s:
        row = await s.get(DebateRow, debate_id)
        if row is None:
            return None
        turns = (
            await s.scalars(
                select(TurnRow).where(TurnRow.debate_id == debate_id).order_by(TurnRow.id)
            )
        ).all()
        v = await s.get(VerdictRow, debate_id)
        fb = (
            await s.scalars(
                select(FeedbackRow).where(FeedbackRow.debate_id == debate_id).order_by(FeedbackRow.id)
            )
        ).all()
        out = _debate_dict(row)
        out["turns"] = [
            {
                "id": t.id,
                "round": t.round,
                "agent": t.agent,
                "text": t.text,
                "created_at": t.created_at,
                "tokens_in": t.tokens_in,
                "tokens_out": t.tokens_out,
                "details": t.details,
            }
            for t in turns
        ]
        out["verdict"] = (
            Verdict(
                recommendation=v.recommendation,
                confidence=v.confidence,
                scorecard=v.scorecard,
                risks=v.risks,
                experiments=v.experiments,
                one_line_summary=v.one_line_summary,
                fallback=v.fallback,
            ).model_dump()
            if v
            else None
        )
        out["feedback"] = [
            {"id": f.id, "rating": f.rating, "comment": f.comment} for f in fb
        ]
        return out


async def add_turn(
    debate_id: str,
    round: int,
    agent: str,
    text: str,
    tokens_in: int = 0,
    tokens_out: int = 0,
    details: dict | None = None,
) -> int:
    async with _get_sessionmaker()() as s:
        row = TurnRow(
            debate_id=debate_id,
            round=round,
            agent=agent,
            text=text,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            details=details,
        )
        s.add(row)
        await s.commit()
        return row.id


async def save_verdict(debate_id: str, verdict: Verdict) -> None:
    async with _get_sessionmaker()() as s:
        data = verdict.model_dump()
        await s.merge(
            VerdictRow(
                debate_id=debate_id,
                recommendation=data["recommendation"],
                confidence=data["confidence"],
                scorecard=data["scorecard"],
                risks=data["risks"],
                experiments=data["experiments"],
                one_line_summary=data["one_line_summary"],
                fallback=data["fallback"],
            )
        )
        await s.commit()


async def update_debate(debate_id: str, **fields: Any) -> None:
    if not fields:
        return
    async with _get_sessionmaker()() as s:
        await s.execute(update(DebateRow).where(DebateRow.id == debate_id).values(**fields))
        await s.commit()


async def add_feedback(debate_id: str, rating: int, comment: str | None = None) -> int:
    async with _get_sessionmaker()() as s:
        row = FeedbackRow(debate_id=debate_id, rating=rating, comment=comment)
        s.add(row)
        await s.commit()
        return row.id


async def delete_debate(debate_id: str) -> bool:
    """Delete a debate and its turns, verdict and feedback. True if it existed."""
    async with _get_sessionmaker()() as s:
        for table in (TurnRow, VerdictRow, FeedbackRow):
            await s.execute(delete(table).where(table.debate_id == debate_id))
        res = await s.execute(delete(DebateRow).where(DebateRow.id == debate_id))
        await s.commit()
        return res.rowcount > 0


async def mark_running_failed() -> int:
    """Flip debates left in `running` (e.g. after a crash) to `failed`; returns count."""
    async with _get_sessionmaker()() as s:
        res = await s.execute(
            update(DebateRow).where(DebateRow.status == "running").values(status="failed")
        )
        await s.commit()
        return res.rowcount
