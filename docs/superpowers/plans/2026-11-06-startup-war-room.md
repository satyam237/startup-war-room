# Startup War Room v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the v1 in `docs/plan.md`: paste a pitch, watch four adversarial agents debate live, interject once, and get a validated verdict, risks, and experiments on a shareable page.

**Architecture:** FastAPI runs one background task per debate. Each task drives a LangGraph state graph whose nodes call a single LLM gateway and publish to an in-process event log. SSE subscribers read that log by sequence number, so reconnects replay without loss. A React client renders the events.

**Tech Stack:** Python 3.12 (uv), FastAPI, sse-starlette, LangGraph, Pydantic v2, SQLAlchemy 2 async (aiosqlite, asyncpg), `openai` SDK pointed at OpenRouter; React + Vite + TypeScript + Tailwind v4, Recharts, react-router, Vitest, Playwright.

**Spec:** `docs/plan.md` (§ numbers below refer to it). Executors read both.

## Global Constraints

- Python `>=3.12,<3.14`, pinned with uv. The system Python is 3.14; do not use it.
- Every LLM call goes through `app/llm.py`. No other module imports `openai`. Model IDs live only in environment variables, so changing a model never needs a code change.
- Keys come from environment variables only. `.env` is never committed. No key reaches the client.
- Verify library APIs against installed versions or Context7 before coding (§12 says names are from memory). Model IDs below were verified against OpenRouter's live `/models` list on 2026-11-06.
- Caps: `MAX_TURNS=14`, 3 rounds, 120 words per turn, pitch 50 to 2000 chars, rebuttal max 500 chars, `RATE_LIMIT_PER_HOUR=5`.
- Run one uvicorn worker. The event log and rebuttal queues are in-process. This is a documented v1 limit.
- Never publish a metric that was not measured (§18).
- Every test runs with `LLM_PROVIDER=fake`. Tests never hit the network and never spend money.

## Decisions That Refine the Spec

| Spec item | Decision | Why |
|---|---|---|
| Provider | OpenRouter behind the gateway; `LLM_PROVIDER=openrouter\|fake`. This supersedes §12 and §16 | The owner swaps models by use case and as new ones ship |
| Model routing (§11) | `FAST_MODEL` and `AGENT_MODEL` = `openai/gpt-6.1-terra` (guards, persona, critics, checkpoints); `JUDGE_MODEL` = `openai/gpt-6.1-sol` (verdict); `ESCALATION_MODEL` = `anthropic/claude-opus-5.5` (only when the verdict has failed validation twice) | Owner's routing; Opus is reserved for the hardest step. `gpt-6-terra` is not listed on OpenRouter, so 6.1 is used |
| Hosting | Heroku web dyno (one process, `Procfile`) + external Postgres (Supabase free tier) | Owner has a subscription; dyno disk is ephemeral so SQLite would lose debates |
| 14 turns | 4+4+4 critic turns + 2 checkpoints = 14. Verdict, persona, guards, and regenerations are not turns; their tokens still count against budget | Spec arithmetic |
| Intake and clarifying questions | Runs inside `POST /debates`, not in the graph. Thin pitch returns `needs_clarification` with up to 2 questions; client resubmits with answers and `skip_clarify: true` | The API contract has no mid-graph question channel |
| Failed turn "shows retry" | One automatic retry, then a `turn_failed` note and the debate continues | Keeps a hands-free demo moving |
| Checkpointing | `InMemorySaver`; needed for `interrupt()`. On startup, rows left `running` become `failed` | Crash resume adds durable-disk needs that no exit check requires |
| Slug | `debates.id` is `secrets.token_urlsafe(16)`; no separate `share_slug` | One unguessable id meets §15 |
| Delete (§15) | `DELETE /debates/{id}` with `X-Delete-Token`, returned once at creation; SHA-256 stored | No auth in v1 |
| PDF export | Print stylesheet + `window.print()` | First item on the §17 cut list; costs almost nothing |
| Agent modules | `agents/roster.py` plus `prompts/*.md`, not one file per critic | Critics differ only by prompt |

## OpenRouter Rules for `app/llm.py`

Use `AsyncOpenAI(base_url=OPENROUTER_BASE_URL, api_key=OPENROUTER_API_KEY)`. Check each request shape below against OpenRouter's current docs before coding.

- Tiers map to models by env var: `fast`, `agent`, `judge`, `escalation`. Reasoning effort: `low` for `fast` and `agent`, `high` for `judge` and `escalation`, sent through OpenRouter's `reasoning` parameter. Max output: `agent` 600 visible tokens' worth (raise if reasoning consumes the limit), `judge` and `escalation` 16000.
- Structured output: `response_format` with `json_schema` built from the Pydantic model, with `provider.require_parameters` set so only capable hosts serve it. Always validate the reply with Pydantic locally, because models can change.
- Cost comes from OpenRouter's usage accounting (`usage.cost`), not a price table, so a new model needs no code change. Streaming calls must capture usage from the final chunk. If a response has no cost, record `cost_usd=0` and log a warning.
- `finish_reason` of `content_filter` or a refusal raises `LLMRefusal`; `length` on structured output raises `LLMError`. An error delivered mid-stream raises `LLMError`.
- Catch typed SDK errors most-specific-first. Client `max_retries=2`.
- Send an `X-Title: Startup War Room` header. Do not send the user's email or any personal data.

## SSE Event Contract

Each event carries `id: <seq>` and a JSON `data` payload. Both ends use exactly these shapes.

| event | data |
|---|---|
| `setup` | `{step: "persona"\|"competitors"\|"ready", message, persona?, competitors?}` |
| `turn_start` | `{turn_id, agent, round, attempt}` |
| `turn_token` | `{turn_id, text}` |
| `turn_reset` | `{turn_id, reason}` (client clears that turn's text; regeneration follows) |
| `turn_end` | `{turn_id, agent, round, text, final_position?}` |
| `turn_failed` | `{agent, round, note}` |
| `checkpoint` | `{round, summary, top_disagreements: [str, str]}` |
| `await_rebuttal` | `{timeout_s}` |
| `rebuttal_received` | `{text\|null}` |
| `verdict` | Full `Verdict` JSON |
| `error` | `{message, recoverable}` |
| `done` | `{status}` |

`agent` is one of `vc`, `customer`, `cto`, `competitor`, `moderator`.

## Review Focus

Inputs and conditions the spec implies but does not spell out. Each has a test in the owning task.

1. **The founder ignores or never sees the rebuttal prompt** (closed tab): the debate continues after `REBUTTAL_TIMEOUT_S` (default 45) and still ends with a verdict. Task 7.
2. **The browser drops the stream or reloads mid-debate, or two tabs watch**: `Last-Event-ID` replay has no gaps or duplicates, the debate does not stop, and both tabs see everything. Tasks 6 and 7.
3. **The pitch contains `</pitch>`, injection text, emoji, or a non-English language**: the delimiter is not escaped out of and agents treat the content as data. Task 4.
4. **The server restarts during a debate**: the row becomes `failed`, and the page shows an error rather than spinning forever. Tasks 7 and 10.
5. **Budget or wall clock runs out before Round 3, or the verdict call keeps failing**: the user still gets a clearly labelled verdict from whatever positions exist. Task 5.

---

## Phase 1: Foundations

### Task 1: Backend skeleton — model: Sonnet 5.5

**Files:**
- Create: `backend/pyproject.toml`, `backend/.python-version`, `.env.example`, `backend/app/__init__.py`, `backend/app/config.py`, `backend/app/main.py`, `backend/app/models.py`, `backend/app/db.py`
- Test: `backend/tests/conftest.py`, `backend/tests/test_health.py`, `backend/tests/test_db.py`

**Interfaces:**
- Produces: `get_settings() -> Settings` (pydantic-settings; all §16 variables plus `FAST_MODEL`, `REBUTTAL_TIMEOUT_S=45`, `DEBATE_TIMEOUT_S=240`, `MAX_CONCURRENT_DEBATES=10`; `MAX_TOKENS_PER_DEBATE=40000`; `LLM_PROVIDER` default `openrouter`; `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `ESCALATION_MODEL`; no `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`).
- Produces in `models.py`: `AgentName = Literal["vc","customer","cto","competitor","moderator"]`, `Turn`, `FinalPosition(score_1_to_10: int, top_risk: str, change_mind_if: str)`, `ScoreItem(score: int, why: str)`, `Scorecard`, `Risk(rank, risk, severity, raised_by)`, `Experiment(test, timebox_days, success_criteria, kill_criteria)`, `Verdict` exactly per §13, plus `Verdict.fallback: bool = False`. SQLAlchemy tables per §11 (no `share_slug`; add `delete_token_hash`).
- Produces in `db.py`: `init_db()`, `create_debate(...)`, `get_debate(id)`, `add_turn(...)`, `save_verdict(...)`, `update_debate(id, **fields)`, `add_feedback(...)`, `delete_debate(id)`, `mark_running_failed() -> int`.

- [ ] **Step 1:** Write failing tests: `GET /health` returns `{"status":"ok"}`; `test_debate_round_trip` creates a debate with a turn and verdict in temp SQLite and reads it back; `test_mark_running_failed` flips only `running` rows; `test_scores_outside_1_to_10_rejected` for `ScoreItem` and `FinalPosition`.
- [ ] **Step 2:** Run `cd backend && uv run pytest -q`. Expected: FAIL (no app).
- [ ] **Step 3:** Implement. `DATABASE_URL` default `sqlite+aiosqlite:///./warroom.db`. `main.py` lifespan calls `init_db()` then `mark_running_failed()`.
- [ ] **Step 4:** Run `uv run pytest -q`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(backend): skeleton, config, models, persistence`.

### Task 2: LLM gateway — model: Sonnet 5.5

**Files:**
- Create: `backend/app/llm.py`, `backend/app/fake_llm.py`
- Test: `backend/tests/test_llm.py`

**Interfaces:**
- Produces:
  ```python
  Tier = Literal["fast", "agent", "judge", "escalation"]
  class Usage(BaseModel): model: str; tokens_in: int; tokens_out: int; cost_usd: float; latency_ms: int
  class LLMError(Exception): ...
  class LLMRefusal(LLMError): ...
  class LLMGateway(Protocol):
      def stream_text(self, tier, system, user, on_usage) -> AsyncIterator[str]: ...
      async def structured(self, tier, system, user, schema: type[T]) -> tuple[T, Usage]: ...
  def get_gateway() -> LLMGateway  # by LLM_PROVIDER
  ```
- `FakeGateway(script: Callable | None = None)`: deterministic, sub-millisecond by default, with distinct text per agent and pitch-derived words, valid structured objects for any schema the app uses, and optional injected failures (`fail_on`, `refuse_on`, `delay_s`). Later tasks and the Playwright run all depend on it.

- [ ] **Step 1:** Write failing tests against a stubbed SDK client: `test_tier_uses_model_from_env` (changing `AGENT_MODEL` changes the request with no code change); `test_judge_tier_uses_high_reasoning`; `test_structured_sends_json_schema_and_require_parameters`; `test_structured_invalid_json_raises_llmerror`; `test_content_filter_raises_llmrefusal`; `test_rate_limit_error_maps_to_llmerror`; `test_midstream_error_raises_llmerror`; `test_usage_cost_read_from_response`; `test_missing_cost_records_zero_and_warns`; `test_fake_gateway_is_deterministic`; `test_fake_stream_differs_per_agent`.
- [ ] **Step 2:** Run `uv run pytest tests/test_llm.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement per "OpenRouter Rules". Timeouts: fast 15s, agent 45s, judge and escalation 120s. Log model, tokens, cost, latency as one structured line per call.
- [ ] **Step 4:** Run tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(llm): gateway with routing, accounting, and fake provider`.

---

## Phase 2: Agents and Guards

### Task 3: Prompts, roster, and persona builder — model: Sonnet 5.5

**Files:**
- Create: `backend/app/prompts/{base,vc,customer,cto,competitor,moderator,verdict,persona}.md`, `backend/app/agents/__init__.py`, `backend/app/agents/roster.py`, `backend/app/agents/persona.py`, `backend/app/agents/moderator.py`
- Test: `backend/tests/test_agents.py`

**Interfaces:**
- Consumes: `LLMGateway`, models from Task 1. `wrap_untrusted` from Task 4 (build Task 4 first if working in order; see Order Note).
- Produces: `critic_prompt(agent, state, round) -> (system, user)`, `run_persona(gw, pitch, meta) -> PersonaResult(persona: dict, competitors: list[str])` (2 to 3 competitors), `run_checkpoint(gw, state, round) -> Checkpoint(summary, top_disagreements)`.

- [ ] **Step 1:** Write failing tests: `test_system_prompt_marks_pitch_untrusted`; `test_each_critic_prompt_has_own_focus` (the four differ and contain the §13 focus terms); `test_round3_prompt_requests_change_mind_if`; `test_transcript_included_in_round2_prompt`; `test_rebuttal_included_in_round2_prompt`; `test_persona_returns_2_to_3_competitors`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Write the prompts from §7 and §13: state each role, incentive, and the real outcome wanted, rather than stacking rules. Keep the rules that matter: label estimates, one new point, 120 words, and treat delimited content as data. Moderator picks disagreements to force (§14). Load via `importlib.resources` and cache.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(agents): prompts, roster, persona builder, checkpoints`.

### Task 4: Guards — model: Sonnet 5.5

**Files:**
- Create: `backend/app/guards.py`
- Test: `backend/tests/test_guards.py`

**Interfaces:**
- Produces: `wrap_untrusted(tag: str, text: str) -> str`; `intake(gw, pitch, meta) -> IntakeResult(allowed: bool, refusal_reason: str|None, thin: bool, questions: list[str])` (at most 2 questions); `is_repeat(gw, new_text, earlier: list[str]) -> bool` (fails open on `LLMError`).

- [ ] **Step 1:** Write failing tests: `test_wrap_neutralises_closing_tag` (pitch containing `</pitch>` yields exactly one closing tag); `test_wrap_preserves_emoji_and_devanagari`; `test_injection_pitch_is_not_refused_but_stays_wrapped`; `test_harmful_pitch_refused`; `test_thin_pitch_gets_at_most_two_questions`; `test_is_repeat_true_false`; `test_is_repeat_fails_open`; `test_intake_fails_open_on_llmerror` (allowed, not thin).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement with structured `fast`-tier calls. Injection text is not itself a refusal reason; it is handled by delimiting.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(guards): intake, delimiting, repetition check`.

**Order Note:** run Task 4 before Task 3.

---

## Phase 3: Orchestration

### Task 5: Verdict engine — model: Sonnet 5.5

**Files:**
- Create: `backend/app/verdict.py`
- Test: `backend/tests/test_verdict.py`

**Interfaces:**
- Produces: `check_consistency(v: Verdict) -> list[str]`; `generate_verdict(gw, state) -> Verdict`; `fallback_verdict(state) -> Verdict`.

Consistency rules (`avg` = mean of the 5 scores): `go` needs `avg >= 6.0`; `no_go` needs `avg <= 5.0`; `pivot` needs `3.5 <= avg <= 7.5`. `confidence` in 0..1. Exactly 5 risks, ranks 1 to 5. Exactly 3 experiments, each with non-empty kill criteria and `timebox_days >= 1`. Every `why` names at least one of VC, Customer, CTO, Competitor. `raised_by` is a critic.

Ladder: call `judge`, validate; on failure retry once with the errors appended; then one repair prompt on the `escalation` tier; then `fallback_verdict`.

- [ ] **Step 1:** Write failing tests: `test_consistent_passes`; parametrised `test_go_with_avg_5_fails`, `test_no_go_with_avg_8_fails`, `test_four_risks_fails`, `test_two_experiments_fails`, `test_why_without_agent_fails`; `test_retry_includes_error_text`; `test_repair_uses_escalation_tier_after_retry`; `test_fallback_after_three_failures_sets_fallback_true`; `test_fallback_with_no_final_positions_is_valid`; `test_fallback_passes_check_consistency`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. `fallback_verdict` derives scores from final positions, the transcript, or neutral defaults, sets `fallback=True`, and its summary says the verdict is partial.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(verdict): validated verdict with repair and fallback`.

### Task 6: Event log and debate graph — model: Opus 5.5

**Files:**
- Create: `backend/app/events.py`, `backend/app/graph.py`, `backend/scripts/run_debate.py`
- Test: `backend/tests/test_events.py`, `backend/tests/test_graph.py`

**Interfaces:**
- Consumes: Tasks 2 to 5.
- Produces:
  ```python
  class EventLog:
      def publish(self, event: str, data: dict) -> int   # returns seq
      async def subscribe(self, after_seq: int = 0) -> AsyncIterator[Event]
      def close(self) -> None
  class Deps: gw; log: EventLog; settings; store  # persistence callbacks
  def build_graph(deps: Deps, checkpointer) -> CompiledGraph
  ```
- State: `DebateState` per §11. Nodes: `setup`, `round_1`, `moderator_1`, `rebuttal`, `round_2`, `moderator_2`, `round_3`, `verdict`, `report`. Conditional edges skip to `verdict` when `budget` or the deadline is exceeded. `rebuttal` calls LangGraph `interrupt()`.

Turn behaviour: publish `turn_start`, stream tokens, then `is_repeat`. On a repeat, publish `turn_reset` and regenerate once with a "make a new point" instruction, then accept the result. On `LLMError`, retry once, then publish `turn_failed` and continue. Round 3 uses `structured` and publishes `turn_end` with rendered text and `final_position`; it streams no tokens.

- [ ] **Step 1:** Write failing tests. Events: `test_subscribe_replays_then_tails`, `test_two_subscribers_each_get_all`, `test_resume_after_seq_no_dup_no_gap`, `test_subscriber_ends_on_close`. Graph (FakeGateway, resume with `Command`): `test_full_debate_event_order`, `test_exactly_14_turns`, `test_speaking_order_vc_customer_cto_competitor`, `test_repeat_triggers_reset_and_regeneration_once`, `test_failed_turn_continues_with_note`, `test_all_critics_refuse_still_ends_with_fallback`, `test_token_budget_jumps_to_verdict_status_budget_exceeded`, `test_deadline_jumps_to_verdict`, `test_rebuttal_text_reaches_round2_prompts`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement, then add `scripts/run_debate.py "<pitch>"`, which prints the debate to the terminal with either provider.
- [ ] **Step 4:** Run `uv run pytest -q` and `LLM_PROVIDER=fake uv run python scripts/run_debate.py "<50+ char pitch>"`. Expected: PASS, and a full printed debate ending in a verdict.
- [ ] **Step 5:** Commit `feat(graph): debate state machine and event log`.

---

## Phase 4: API

### Task 7: Debate runner, create, stream, rebuttal — model: Opus 5.5

**Files:**
- Create: `backend/app/runner.py`, `backend/app/routes.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_api_stream.py`

**Interfaces:**
- Produces: `DebateRunner.start(debate_id, pitch, meta)`, `.log(id) -> EventLog|None`, `.submit_rebuttal(id, text|None) -> None` (raises `RebuttalNotOpen`), `.active_count()`.
- Routes per §11. `POST /debates` body: `{pitch, target_user?, pricing?, stage?, skip_clarify?}`. Responses: `200 {status:"needs_clarification", questions}`, `201 {debate_id, delete_token}`, `422 {detail}` for length or refusal, `429`, `503` at the concurrency cap. `POST /debates/{id}/rebuttal` with `{text}` (empty means skip) returns 409 when not awaited.

The runner owns one `asyncio.Task` per debate: it drives the graph, and on interrupt publishes `await_rebuttal` and waits for the rebuttal queue with a timeout, then resumes. The debate does not depend on any client being connected. Keep the log for 10 minutes after the end. `/stream` for a debate with no log rebuilds events from the database then sends `done`; if the row is `failed`, it sends `error` then `done`. Set `X-Accel-Buffering: no`, and ping every 15s.

- [ ] **Step 1:** Write failing tests (httpx ASGI + FakeGateway): `test_create_then_stream_in_order`; `test_rebuttal_accepted_at_checkpoint`; `test_rebuttal_too_long_422`; `test_rebuttal_when_not_waiting_409`; `test_rebuttal_timeout_auto_continues` (timeout 0.05s); `test_disconnect_does_not_stop_debate`; `test_reconnect_with_last_event_id`; `test_stream_finished_debate_replays_from_db`; `test_stream_failed_debate_sends_error_done`; `test_thin_pitch_needs_clarification`; `test_skip_clarify_creates`; `test_short_pitch_422`; `test_concurrency_cap_503`; `test_get_debate_full_json`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run tests, then with fake provider `uv run uvicorn app.main:app` and stream with `curl -N`. Expected: PASS, events in contract order.
- [ ] **Step 5:** Commit `feat(api): debate runner, SSE stream, rebuttal`.

### Task 8: Export, feedback, delete, limits — model: Sonnet 5.5

**Files:**
- Create: `backend/app/export.py`, `backend/app/ratelimit.py`
- Modify: `backend/app/routes.py`, `backend/app/main.py`
- Test: `backend/tests/test_api_misc.py`

**Interfaces:**
- Produces: `render_markdown(debate) -> str`; `RateLimiter(limit, window_s).check(ip) -> bool`; `GET /debates/{id}/export?format=md`; `POST /debates/{id}/feedback`; `DELETE /debates/{id}`.

- [ ] **Step 1:** Write failing tests: `test_export_has_all_sections`; `test_export_unfinished_409`; `test_feedback_rating_range`; `test_delete_wrong_token_403`; `test_delete_then_404`; `test_sixth_create_429_per_ip`; `test_other_ip_not_limited`; `test_clarification_does_not_consume_quota`; `test_cors_only_allows_frontend_origin`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. The export includes the §15 disclaimer. Client IP comes from `request.client.host`; uvicorn resolves proxy headers (Task 14).
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(api): export, feedback, delete, rate limit, CORS`.

---

## Phase 5: Frontend

Implementers load the `frontend-design` skill. The product should feel like a tense, distinctive war room, not a default dashboard. Each agent has its own colour and tone (§10). Meet WCAG AA contrast and work at 375px wide. Dev server: `http://localhost:5173`, API from `VITE_API_URL`.

### Task 9: Scaffold, debate state, Pitch page — model: Sonnet 5.5

**Files:**
- Create: `frontend/` (Vite React TS, Tailwind v4, react-router, Vitest), `src/lib/api.ts`, `src/lib/sse.ts`, `src/lib/debateReducer.ts`, `src/pages/Pitch.tsx`
- Test: `src/lib/debateReducer.test.ts`, `src/pages/Pitch.test.tsx`

**Interfaces:**
- Produces: `debateReducer(state, event)`, with one case per SSE contract event; `connectDebate(id, dispatch) -> () => void`, using native `EventSource` and closing on `done`; `createDebate()`, `getDebate()`, `submitRebuttal()`, `deleteDebate()`, `sendFeedback()`. Routes: `/`, `/d/:id`, `/d/:id/verdict`.

- [ ] **Step 1:** Write failing tests: tokens accumulate per `turn_id`; `turn_reset` clears only that turn; a replayed event with a seen seq is ignored; submit is disabled under 50 or over 2000 chars; an example chip fills the textarea; `needs_clarification` shows the questions and resubmits with answers and `skip_clarify`; 429 shows a friendly limit message.
- [ ] **Step 2:** Run `npm test -- --run`. Expected: FAIL.
- [ ] **Step 3:** Implement Pitch with 3 example chips and the §15 confidentiality notice. A store of `delete_token` goes in `localStorage`.
- [ ] **Step 4:** Run tests and `npm run build`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(web): scaffold, event reducer, pitch page`.

### Task 10: Debate room — model: Sonnet 5.5

**Files:**
- Create: `src/pages/DebateRoom.tsx`, `src/components/{AgentCard,Transcript,ModeratorBanner,RoundIndicator,RebuttalBox}.tsx`
- Test: `src/pages/DebateRoom.test.tsx`

- [ ] **Step 1:** Write failing tests: setup messages show before any turn; the active agent's card highlights; the rebuttal box appears on `await_rebuttal` with a visible countdown and hides on `rebuttal_received`; `turn_failed` renders a note and the feed continues; an `error` with `recoverable: false` shows a message and a link home (no endless spinner); `done` navigates to the verdict; opening a completed debate redirects there.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement per §10: four panels around the central feed on desktop, a single column on mobile, and auto-scroll that pauses when the user scrolls up.
- [ ] **Step 4:** Run tests and build. Expected: PASS.
- [ ] **Step 5:** Commit `feat(web): live debate room`.

### Task 11: Verdict page — model: Sonnet 5.5

**Files:**
- Create: `src/pages/Verdict.tsx`, `src/components/{Scorecard,RiskList,ExperimentList,RecommendationCard,FeedbackBox}.tsx`, `src/print.css`
- Test: `src/pages/Verdict.test.tsx`

- [ ] **Step 1:** Write failing tests: recommendation, confidence, and all five scores render; 5 risks in rank order with agent; 3 experiments with kill criteria; Share copies the URL; Export links to the Markdown endpoint; Delete shows only with a stored token; "Run again with changes" returns to `/` prefilled; feedback submits 1 to 5; a `fallback: true` verdict shows a partial-result notice; the disclaimer shows.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement with a Recharts radar chart and a text list of the same values. Print CSS hides controls for PDF output.
- [ ] **Step 4:** Run tests and build. Expected: PASS.
- [ ] **Step 5:** Commit `feat(web): verdict and share page`.

### Task 12: Browser end-to-end test — model: Sonnet 5.5

**Files:**
- Create: `frontend/playwright.config.ts`, `frontend/e2e/debate.spec.ts`, `frontend/e2e/resilience.spec.ts`

- [ ] **Step 1:** Write tests against the real backend with `LLM_PROVIDER=fake` and a small fake delay: `pitch to verdict with a rebuttal`; `no rebuttal auto-continues` (`REBUTTAL_TIMEOUT_S=2`); `reload mid-debate catches up`; `share link opens in a fresh context`; `mobile viewport has no horizontal overflow`.
- [ ] **Step 2:** Run `npx playwright test`. Expected: PASS. Fix the owning code for any failure and keep the fix in this task.
- [ ] **Step 3:** Commit `test(e2e): browser flows against fake provider`.

---

## Phase 6: Evals

### Task 13: Eval harness — data: Haiku 5.5; script: Sonnet 5.5

**Files:**
- Create: `backend/evals/pitches.json`, `backend/evals/run_evals.py`, `backend/evals/report.py`
- Test: `backend/tests/test_evals.py`

**Interfaces:**
- `pitches.json`: 20 items `{id, category: strong|weak|vague|adversarial, pitch}`, five per category.
- `run_evals.py [--limit N] [--concurrency 3] [--out evals/results/<ts>.json]` runs each pitch through `build_graph` directly with the rebuttal skipped, and prints a per-debate cost line and a cumulative total. It refuses to run on a non-fake provider without `--yes-spend-money`.

- [ ] **Step 1:** Write failing tests: 20 pitches, 5 per category; `test_report_metrics_on_canned_results` (completion rate, p50 and p95 latency, tokens, cost, schema validity, repetition rate, cap violations, consistency, agreement-collapse rate, where all Round 1 turns share a positive stance); `test_runner_requires_flag_for_real_provider`; `test_runner_with_fake_writes_results`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement against the §14 checks, then run on fake.
- [ ] **Step 4:** Run tests. Expected: PASS. Label any fake-provider result as not meaningful for quality or cost.
- [ ] **Step 5:** Commit `feat(evals): 20-pitch harness and metrics`.

---

## Phase 7: Ship

### Task 14: Packaging and docs — model: Sonnet 5.5

**Files:**
- Create: `Procfile`, `.python-version`, `backend/Dockerfile`, `frontend/vercel.json`, `README.md`, `.github/workflows/ci.yml`

- [ ] **Step 1:** Write the `Procfile` (`web: uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 1 --proxy-headers --forwarded-allow-ips='*'`), confirming how Heroku's Python buildpack handles a uv project in a `backend/` subdirectory; the Dockerfile with the same command so the app stays portable to a free host; and `vercel.json` with SPA rewrites.
- [ ] **Step 2:** Write the README: setup, fake-provider quickstart, architecture diagram, env table, known limits (§18 honest limits, single worker, in-flight debates lost on restart), and no unmeasured metrics.
- [ ] **Step 3:** Add CI for pytest, frontend tests, and build, all with the fake provider.
- [ ] **Step 4:** Verify: `docker build ./backend` if Docker is available, and CI passes on the PR. If Docker is not available, say so.
- [ ] **Step 5:** Commit `chore: packaging, CI, README`.

### Task 15: Whole-branch review — model: Opus 5.5

- [ ] **Step 1:** Review the full diff against `docs/plan.md` §5, §9.1, §14, §15, and §21.
- [ ] **Step 2:** Fix confirmed problems, rerun all tests, and open the PR.

---

## User-Gated Steps

These need a credential, spend money, or publish something.

| Gate | Needs | What happens |
|---|---|---|
| G1: Real model run | `OPENROUTER_API_KEY` with a credit limit | Run one real debate, tune prompts on 3 pitches (§19: samey agents) |
| G2: Eval run | Your approval; roughly USD 5 at target cost, to be measured | Run all 20 pitches, fix the top 3 failure modes, record real metrics |
| G3: Deploy | Heroku app + Supabase Postgres URL; go-ahead | Deploy backend to Heroku and frontend to Vercel; fresh-browser check on production |
| G4: Public repo and demo | Your decision and your recording | Flip repo public; record the 60-second demo; fill the write-up with measured numbers |
