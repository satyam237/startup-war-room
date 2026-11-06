from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

AgentName = Literal["vc", "customer", "cto", "competitor", "moderator"]


# ---- Pydantic schemas ----


class Turn(BaseModel):
    agent: AgentName
    round: int
    text: str
    ts: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    tokens: int = 0


class FinalPosition(BaseModel):
    score_1_to_10: int = Field(ge=1, le=10)
    top_risk: str
    change_mind_if: str


class ScoreItem(BaseModel):
    score: int = Field(ge=1, le=10)
    why: str


class Scorecard(BaseModel):
    market: ScoreItem
    customer_pull: ScoreItem
    feasibility: ScoreItem
    defensibility: ScoreItem
    timing: ScoreItem


class Risk(BaseModel):
    rank: int
    risk: str
    severity: Literal["high", "med", "low"]
    raised_by: str


class Experiment(BaseModel):
    test: str
    timebox_days: int
    success_criteria: str
    kill_criteria: str


class Verdict(BaseModel):
    recommendation: Literal["go", "pivot", "no_go"]
    confidence: float = Field(ge=0.0, le=1.0)
    scorecard: Scorecard
    risks: list[Risk]
    experiments: list[Experiment]
    one_line_summary: str
    fallback: bool = False


# ---- SQLAlchemy tables ----


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class DebateRow(Base):
    __tablename__ = "debates"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    pitch: Mapped[str] = mapped_column(Text)
    pitch_meta: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String, default="running")
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    est_cost: Mapped[float] = mapped_column(Float, default=0.0)
    delete_token_hash: Mapped[str | None] = mapped_column(String, nullable=True)


class TurnRow(Base):
    __tablename__ = "turns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    debate_id: Mapped[str] = mapped_column(
        ForeignKey("debates.id", ondelete="CASCADE"), index=True
    )
    round: Mapped[int] = mapped_column(Integer)
    agent: Mapped[str] = mapped_column(String)
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    tokens_in: Mapped[int] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0)
    # What replay needs beyond the text: `top_disagreements` or `final_position`.
    details: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class VerdictRow(Base):
    __tablename__ = "verdicts"

    debate_id: Mapped[str] = mapped_column(
        ForeignKey("debates.id", ondelete="CASCADE"), primary_key=True
    )
    recommendation: Mapped[str] = mapped_column(String)
    confidence: Mapped[float] = mapped_column(Float)
    scorecard: Mapped[dict] = mapped_column(JSON)
    risks: Mapped[list] = mapped_column(JSON)
    experiments: Mapped[list] = mapped_column(JSON)
    one_line_summary: Mapped[str] = mapped_column(Text, default="")
    fallback: Mapped[bool] = mapped_column(default=False)


class FeedbackRow(Base):
    __tablename__ = "feedback"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    debate_id: Mapped[str] = mapped_column(
        ForeignKey("debates.id", ondelete="CASCADE"), index=True
    )
    rating: Mapped[int] = mapped_column(Integer)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
