# Startup War Room: Product and Build Plan

Owner: Satyam Jadhav
Status: Ready to build (single-day sprint, with a v1.1 roadmap)
Doc type: PRD + technical design + execution plan

---

## 1. One-liner

Pitch your startup idea. Four adversarial AI agents (a skeptical VC, a real customer, a CTO, and a competitor) debate it live over structured rounds, then a moderator delivers a verdict, a ranked risk list, and the 3 experiments to run next.

## 2. Problem

Early founders, PM aspirants, and hackathon builders validate ideas with friends and ChatGPT. Both fail in the same way: they are agreeable. The result is late discovery of fatal flaws (no willingness to pay, weak moat, infeasible tech, a stronger incumbent).

Existing alternatives and their gaps:

| Alternative | Gap |
|---|---|
| Asking a single LLM "is my idea good?" | Sycophantic, one perspective, no structure |
| Friends and mentors | Polite, scarce, inconsistent |
| Idea validation templates and canvases | Static, you grade yourself |
| Paid consultants and accelerator office hours | Expensive, slow, hard to access |

## 3. Target users

1. **Primary: solo builders and student founders** (hackathons, side projects, first startups). Need fast, honest critique.
2. **Secondary: aspiring PMs** practicing product sense, market sizing, and defending decisions.
3. **Tertiary: early startup teams** pressure-testing a pivot before spending weeks building.

## 4. Value proposition

- **Adversarial by design:** each agent has a conflicting incentive, so agreement must be earned.
- **Structured output, not chat:** verdict, scorecard, ranked risks, next experiments.
- **Fast:** a full debate in under 3 minutes.
- **Watchable:** live streaming debate makes the product demo itself.

## 5. Goals and non-goals

### Goals (v1)
- Run a complete multi-round debate from a text pitch.
- Stream agent turns live to the UI.
- Produce a structured verdict with scores, risks, and experiments.
- Let the user interject mid-debate ("founder rebuttal") and have agents respond.
- Shareable result page and a downloadable report.

### Non-goals (v1)
- Real market data guarantees. Agents reason from the pitch and their general knowledge unless web search is enabled. Output is critique, not research.
- Financial or legal advice.
- User accounts and billing (v1.1).
- Voice mode (v1.1).

## 6. Success metrics

| Metric | Target for demo/launch |
|---|---|
| Time to complete a debate | under 3 minutes (p50) |
| Debate completion rate (no crashes or loops) | above 95% across 20 test pitches |
| Verdict usefulness (self-rated 1 to 5 by test users) | 4.0 or above |
| Agreement-collapse rate (all agents converge by round 1) | below 10% |
| Cost per debate | under USD 0.25 (measure, then verify) |
| Repeat usage in test group (second pitch) | 40% or above |

Note: targets are planning goals, not measured values. Measure during testing.

---

## 7. Agent roster

All agents share one base contract: stay in character, cite specifics from the pitch, make one new point per turn, never repeat earlier points, max about 120 words per turn.

| Agent | Persona and incentive | Attacks / evaluates |
|---|---|---|
| **Skeptical VC** | Wants a 10x outcome, hates small markets | Market size, business model, defensibility, unit economics, "why now" |
| **Customer** | A realistic target buyer with a persona generated from the pitch | Willingness to pay, switching cost, "would I actually use this", pricing |
| **CTO** | Pragmatic engineer | Feasibility, build time, tech risk, data needs, scaling, security |
| **Competitor** | Incumbent or fast follower | How they would copy, crush, or ignore this; distribution advantages |
| **Moderator** | Neutral facilitator and judge | Controls rounds, summarizes, detects repetition, writes the final verdict |
| **Persona Builder** (setup step) | Generates the Customer persona and names 2 to 3 likely competitors | Runs once before debate |

Design rule: every critic must also state one condition under which they would change their mind. This feeds the experiments list.

## 8. Debate flow (state machine)

```
START
  -> Intake (parse and normalize pitch, ask up to 2 clarifying questions if pitch is too thin)
  -> Setup (Persona Builder creates customer persona and competitor set)
  -> Round 1: Opening critiques (VC, Customer, CTO, Competitor, in that order)
  -> Moderator checkpoint (summary of tensions, picks top 2 disagreements)
  -> [Optional] Founder rebuttal (user input, max 500 chars)
  -> Round 2: Cross-examination (agents respond to each other and to the rebuttal)
  -> Moderator checkpoint
  -> Round 3: Final positions (each agent: score, top risk, "I'd change my mind if...")
  -> Verdict (Moderator synthesizes)
  -> Report assembly
END
```

Controls:
- Max 3 rounds, max 14 agent turns total in v1.
- Repetition guard: moderator compares each turn to earlier turns (embedding similarity or a cheap LLM check). If a turn repeats, it triggers a regeneration with "make a new point".
- Timeout and token budget per debate. Hard stop with graceful verdict if exceeded.

## 9. Features

### 9.1 MVP (must ship today)
1. **Pitch input:** textarea (min 50 chars, max 2000) plus optional fields: target user, pricing idea, stage.
2. **Live debate stream:** agent cards with avatar, name, and streaming text, via Server-Sent Events.
3. **Moderator checkpoints** between rounds.
4. **Founder rebuttal box** between Round 1 and Round 2.
5. **Final verdict:** go / pivot / no-go style recommendation with confidence, plus a scorecard (Market, Customer pull, Feasibility, Defensibility, Timing; each 1 to 10 with a one-line justification).
6. **Ranked risk list:** top 5 risks with severity and which agent raised it.
7. **Next 3 experiments:** concrete, cheap, time-boxed tests (for example "10 customer calls in 5 days, kill if fewer than 3 say they would pay").
8. **Shareable result page** (public URL by debate ID) and **Markdown/PDF export**.
9. **Example pitches** (3 one-click samples) for instant demo.

### 9.2 v1.1 (after submission)
- Choose agent lineup (add Regulator, Investor-Angel, Domain Expert, Growth Marketer).
- "Intensity" slider: friendly, balanced, brutal.
- Web-search tool for agents (market data, competitor lookup) with citations.
- Re-run after pivot and compare scorecards.
- Auth, saved history, team sharing.
- Voice debate.

### 9.3 Explicitly later
- Pitch deck upload and analysis.
- Real investor feedback marketplace.

---

## 10. User experience

### Screens
1. **Landing / Pitch:** big textarea, optional fields, example chips, "Start the debate" button.
2. **Debate room:** four agent panels around a central transcript feed, moderator banner on top, round indicator, progress bar, rebuttal input that appears at the checkpoint.
3. **Verdict:** scorecard (radar or bar chart), recommendation card, risk list, experiments list, "Run again with changes", "Share", "Export".

### UX principles
- First token visible within 3 seconds of clicking start.
- Never a blank screen: show setup steps ("Building your customer persona...").
- Each agent has a distinct color and tone so the transcript is scannable.
- Errors are recoverable: failed turn shows retry, debate continues with a note.

---

## 11. System architecture

```
[React + Vite client]
     | POST /debates          (create)
     | GET  /debates/:id/stream   (SSE: turns, checkpoints, verdict)
     | POST /debates/:id/rebuttal
     | GET  /debates/:id      (result page, export)
     v
[FastAPI backend]
     |-- Debate Orchestrator (LangGraph state graph)
     |      |-- nodes: intake, setup, round_n, moderator, rebuttal, verdict, report
     |      |-- agents: vc, customer, cto, competitor, moderator, persona_builder
     |-- LLM Gateway (one wrapper: retries, timeouts, token accounting, model routing)
     |-- Guardrails (input checks, repetition guard, output schema validation)
     |-- Persistence (debates, turns, verdicts)
     v
[SQLite (dev) / Postgres via Supabase (deploy)]
```

### Key design decisions
- **LangGraph for orchestration:** explicit state, conditional edges (repetition retry, rebuttal branch), checkpointing so a crashed debate can resume. Chosen because it matches your existing stack.
- **One LLM gateway:** all calls go through a single module so you can swap providers and log cost and latency in one place.
- **Model routing:** cheaper/faster model for agent turns and the repetition check; stronger model for Moderator verdict. Model names are read from environment variables. Verify current model names in provider docs before setting them.
- **Streaming:** SSE from FastAPI (simpler than WebSockets for one-way streams). The user rebuttal goes over a normal POST.
- **Structured outputs:** the Moderator verdict and each Round 3 final position use JSON schema outputs validated with Pydantic. If validation fails, retry once with the error message, then fall back to a repair prompt.

### Shared debate state (LangGraph)

```python
class DebateState(TypedDict):
    debate_id: str
    pitch: str
    pitch_meta: dict            # target user, pricing, stage
    customer_persona: dict
    competitors: list[str]
    round: int                  # 0..3
    transcript: list[Turn]      # {agent, round, text, ts, tokens}
    rebuttal: str | None
    moderator_notes: list[str]
    final_positions: dict       # agent -> {score, top_risk, change_mind_if}
    verdict: Verdict | None
    budget: {tokens_used, max_tokens, turns_used, max_turns}
    status: str                 # running | complete | failed | budget_exceeded
```

### Data model (Postgres/SQLite)

| Table | Columns |
|---|---|
| debates | id, created_at, pitch, pitch_meta (json), status, share_slug, total_tokens, est_cost |
| turns | id, debate_id, round, agent, text, created_at, tokens_in, tokens_out |
| verdicts | debate_id, recommendation, confidence, scorecard (json), risks (json), experiments (json) |
| feedback | id, debate_id, rating (1 to 5), comment |

### API contract (v1)

| Method | Path | Purpose |
|---|---|---|
| POST | /debates | Body: pitch, optional meta. Returns debate_id |
| GET | /debates/{id}/stream | SSE events: `setup`, `turn_start`, `turn_token`, `turn_end`, `checkpoint`, `await_rebuttal`, `verdict`, `error`, `done` |
| POST | /debates/{id}/rebuttal | Body: text (max 500 chars) |
| GET | /debates/{id} | Full debate JSON (powers share page) |
| GET | /debates/{id}/export?format=md | Markdown report |
| POST | /debates/{id}/feedback | rating, comment |

---

## 12. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Orchestration | LangGraph (Python) | Stateful graphs, conditional edges, checkpointing |
| Backend | FastAPI + Uvicorn, Pydantic v2 | Fast to build, native async and SSE |
| LLMs | Anthropic and/or OpenAI APIs via one gateway | Model routing, easy swap |
| Frontend | React + Vite + Tailwind | Quick UI, you know it |
| Charts | Recharts (radar/bar for scorecard) | Simple |
| DB | SQLite locally, Supabase Postgres for deploy | Zero setup, then durable |
| Streaming | SSE (`sse-starlette` or FastAPI StreamingResponse) | Simpler than WebSockets |
| Deploy | Frontend on Vercel; backend on Render, Railway or Cloud Run | Fast public URL |
| Observability | Structured logs plus per-debate token and latency table; optional Langfuse or LangSmith | Cost and quality tracking |
| Testing | pytest, plus an eval script over 20 pitches | See section 14 |

Library and API names above are from memory. Verify current package names, versions and syntax in each library's docs before coding.

---

## 13. Prompt design

### Shared system prompt (base)
- You are {role}. Your incentive: {incentive}.
- You are in a structured startup debate. Be direct, specific and unsentimental. Do not be polite for its own sake.
- Reference concrete details from the pitch. Never invent facts about real companies or numbers; if you estimate, say "my estimate".
- One new point per turn. Do not repeat points already made in the transcript.
- Max 120 words.
- Round 3 only: output JSON `{score_1_to_10, top_risk, change_mind_if}`.

### Per-agent additions
- **VC:** push on market size, business model, moat, why now, exit path.
- **Customer:** speak in first person as the generated persona, talk about budget, current workaround, and switching pain.
- **CTO:** estimate build effort, name the hardest technical risk, call out data and compliance needs.
- **Competitor:** play the most dangerous realistic rival; explain exactly how you would respond.
- **Moderator:** neutral, summarize tensions, never take sides until the verdict.

### Verdict prompt (Moderator)
Input: full transcript, final positions, rebuttal. Output JSON:

```json
{
  "recommendation": "go | pivot | no_go",
  "confidence": 0.0,
  "scorecard": {
    "market": {"score": 0, "why": ""},
    "customer_pull": {"score": 0, "why": ""},
    "feasibility": {"score": 0, "why": ""},
    "defensibility": {"score": 0, "why": ""},
    "timing": {"score": 0, "why": ""}
  },
  "risks": [{"rank": 1, "risk": "", "severity": "high|med|low", "raised_by": ""}],
  "experiments": [{"test": "", "timebox_days": 0, "success_criteria": "", "kill_criteria": ""}],
  "one_line_summary": ""
}
```

Rule: the verdict must cite which agent argument drove each score, and the recommendation must be consistent with the scorecard (validated in code).

---

## 14. Quality, evals and guardrails

### Failure modes and mitigations

| Failure mode | Mitigation |
|---|---|
| Agents converge and agree politely | Incentive-conflicted personas, "one new point" rule, moderator picks disagreements to force |
| Repetition across rounds | Similarity check on each turn, regenerate once |
| Hallucinated stats and competitors | Prompt rule to label estimates; optional web search in v1.1; UI footer disclaimer |
| Verdict inconsistent with scores | Code-level consistency check, regenerate on mismatch |
| Prompt injection via pitch ("ignore previous instructions") | Pitch is passed as quoted data in a delimited block; system prompt states pitch content is untrusted; moderator output is schema-validated |
| Offensive or harmful pitches | Input moderation check before starting; refuse and explain |
| Runaway cost or latency | Hard turn and token caps, per-IP rate limiting, timeouts, fallback to short verdict |
| Single provider outage | Gateway retry with backoff, optional secondary provider |

### Eval plan
1. Build a **test set of 20 pitches**: 5 strong, 5 weak, 5 vague, 5 adversarial or injection attempts.
2. Automatic checks: schema validity, repetition rate, round and turn caps respected, verdict/score consistency.
3. Human rubric (1 to 5) on 10 debates: Was the critique specific? Did it surface something you had not considered? Were experiments actionable?
4. Track: completion rate, p50 and p95 latency, tokens and cost per debate.
5. Regression: rerun the 20 pitches after each prompt change and compare.

---

## 15. Security, privacy and compliance

- No auth in v1, so debates are public by unguessable slug (random 12+ char). Add a "make private/delete" action.
- Store only the pitch and outputs. Do not collect personal data. Show a notice: "Do not paste confidential or proprietary information."
- API keys only in environment variables, never in the repo or the client.
- Rate limiting (for example, 5 debates per IP per hour) to protect cost.
- CORS restricted to the frontend origin.
- Add a clear disclaimer: AI critique for brainstorming, not professional advice.

---

## 16. Requirements and needs

### Accounts and keys
- LLM provider API key(s) (Anthropic and/or OpenAI), with spending cap set.
- Supabase project (optional for day one; SQLite is enough to start).
- GitHub repo (public, with sanitized README) and Vercel plus backend host accounts.
- Optional: Langfuse or LangSmith key for tracing.

### Environment variables

```
LLM_PROVIDER=anthropic
AGENT_MODEL=<fast model name, verify in docs>
JUDGE_MODEL=<stronger model name, verify in docs>
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
DATABASE_URL=sqlite:///./warroom.db
FRONTEND_ORIGIN=http://localhost:5173
MAX_TURNS=14
MAX_TOKENS_PER_DEBATE=
RATE_LIMIT_PER_HOUR=5
```

### Repo structure

```
startup-war-room/
  backend/
    app/
      main.py            # FastAPI app, routes, SSE
      graph.py           # LangGraph definition
      agents/            # vc.py, customer.py, cto.py, competitor.py, moderator.py, persona.py
      prompts/           # base.md, per-agent .md, verdict.md
      llm.py             # gateway: retries, timeouts, token accounting
      guards.py          # input moderation, repetition check, schema validation
      models.py          # Pydantic and DB models
      db.py
    evals/
      pitches.json       # 20 test pitches
      run_evals.py
    tests/
  frontend/
    src/
      pages/             # Pitch, DebateRoom, Verdict
      components/        # AgentCard, Transcript, Scorecard, RiskList, RebuttalBox
      lib/sse.ts
  plan.md
  README.md
```

---

## 17. Build plan (single-day sprint)

Assume about 8 focused hours. Cut scope from the bottom if you slip.

| Block | Time | Deliverable | Exit check |
|---|---|---|---|
| 1. Skeleton | 0:00 to 0:45 | Repo, FastAPI app, LLM gateway, env config, SQLite models | `/health` and one gateway test call work |
| 2. Agents and prompts | 0:45 to 2:00 | Six agent prompts, persona builder, single round runs from a script | One round produces 4 distinct, specific critiques |
| 3. LangGraph flow | 2:00 to 3:30 | Full 3-round graph, moderator checkpoints, caps, repetition guard | Full debate runs end to end in the terminal |
| 4. Verdict and schema | 3:30 to 4:15 | JSON verdict with validation and consistency check | 5 test pitches give valid verdicts |
| 5. API and SSE | 4:15 to 5:00 | Create, stream, rebuttal, get, export endpoints | `curl` streams events in order |
| 6. Frontend | 5:00 to 6:45 | Pitch page, debate room with streaming, verdict page, share link | Click-through demo works on localhost |
| 7. Evals and hardening | 6:45 to 7:30 | Run 20 pitches, fix top 3 failure modes, rate limit, input checks | Completion above 90% |
| 8. Deploy and demo | 7:30 to 8:30 | Public URL, README, 60-second recording | Fresh browser run succeeds on production |

**Cut list if time runs short (in order):** PDF export, share page polish, rebuttal box, radar chart (use bars), persona builder (use fixed customer persona).

**Critical path:** gateway, agents, graph, verdict, SSE, minimal UI. Everything else is optional.

---

## 18. Demo and submission

### 60-second demo script
1. (0 to 8s) "Founders get polite feedback. This one fights back." Paste a pitch (use a pre-loaded example).
2. (8 to 35s) Show the live debate: VC attacks market size, Customer says they would not pay, CTO flags the hard technical piece, Competitor explains how they'd copy it. Interject with a rebuttal.
3. (35 to 55s) Verdict: scorecard, top risks, 3 experiments with kill criteria.
4. (55 to 60s) "Built with LangGraph, FastAPI and React. Link below."

### Project write-up (for forms)
- **What it does:** A multi-agent debate where adversarial AI personas stress-test a startup idea and produce a verdict, risk list, and next experiments.
- **Why I built it:** AI feedback on ideas is sycophantic. I wanted critique with conflicting incentives, so weak ideas fail early and strong ones get sharper.
- **Agentic angle:** six specialized agents, a LangGraph state machine with conditional branches (repetition retry, founder rebuttal), structured outputs, human-in-the-loop interjection, and budget guards.
- **Honest limits:** reasons from the pitch and model knowledge, no live market data in v1, critique is not professional advice.

Add real metrics here after testing (completion rate, p50 latency, cost per debate). Do not publish numbers you have not measured.

---

## 19. Risks and open questions

| Risk or question | Owner | Decision needed by |
|---|---|---|
| Cost per debate may exceed target | Satyam | After eval run (block 7) |
| Streaming multi-agent turns may feel slow | Satyam | Block 5; fallback is stream each turn on completion |
| Agents may feel samey despite personas | Satyam | Block 2; tune with 3 pitches before building more |
| Which provider and models for agents vs judge | Satyam | Block 1 |
| Public repo vs private (no client data involved, so public is fine) | Satyam | Before submission |

## 20. Roadmap after v1

1. **v1.1:** agent lineup selector, intensity slider, web-search tool with citations, history and auth.
2. **v1.2:** pivot comparison (before/after scorecards), team sharing, voice debate.
3. **v2:** domain packs (fintech, health, creator economy), investor-style memo export, public benchmark of "ideas that survived the war room".

## 21. Definition of done (v1)

- A new user can paste a pitch and receive a complete, schema-valid verdict on production in under 3 minutes.
- At least 20 test pitches run with above 90% completion.
- README has setup steps, architecture diagram, and known limits.
- Demo video recorded, public URL live, submission text filled with measured numbers only.
