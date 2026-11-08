# Startup War Room

**Four adversarial AI agents tear into your startup pitch live. A moderator rules GO, PIVOT or NO-GO, and you get one rebuttal.**

[![CI](https://github.com/satyam237/startup-war-room/actions/workflows/ci.yml/badge.svg)](https://github.com/satyam237/startup-war-room/actions/workflows/ci.yml)

**Live: https://startup-war-room.vercel.app**

![The pitch page: four skeptics will take your idea apart](docs/screenshots/01-pitch.jpg)

## What it is

Ask a chatbot about your startup idea and it usually says it is a great idea. That feedback is pleasant and close to useless. Startup War Room points the model the other way. Four personas with conflicting incentives argue over your pitch while you watch, and the result is a schema-validated verdict with a scorecard, ranked risks, and three experiments you can run.

| Agent | Asks |
|---|---|
| Investor | Will this return the fund? |
| Customer | Would I actually pay? (a persona built from your pitch) |
| Engineer | Can it be built and kept running? |
| Rival | Why will you lose to us? |
| Moderator | Keeps the room honest, summarizes each round, rules on the verdict |

AI critique for brainstorming, not professional advice. Do not paste confidential or proprietary information.

## How a debate works

1. **Setup.** The pitch (50 to 2000 characters, plus optional target user, pricing and stage) passes an intake check. The app then builds a customer persona and names likely competitors.
2. **Three rounds.** Round 1 is the opening critique, round 2 is cross-examination, round 3 is final positions: each agent gives a 1 to 10 score, its top risk, and what would change its mind. A repeat guard regenerates a turn that only restates an earlier one.
3. **Moderator checkpoints** summarize the room after rounds 1 and 2.
4. **One rebuttal.** After the round 1 checkpoint the room pauses for up to 45 seconds. You can answer the sharpest point (500 characters at most) or skip.
5. **Verdict.** The moderator returns GO, PIVOT or NO-GO with a confidence figure, a five-dimension scorecard (market, customer pull, feasibility, defensibility, timing), ranked risks tagged by the agent that raised them, and three experiments.
6. **Experiments.** Each has a time box, a success criterion that says when to keep going, and a kill criterion that says when to stop.

The result page is shareable by link, exports to Markdown, and prints to PDF.

## Features

| | |
|---|---|
| ![Versus intro](docs/screenshots/02-versus-intro.jpg)<br>**Versus intro.** Your idea against the four agents, with the customer persona and rivals named from your pitch. | ![Debate room](docs/screenshots/03-debate-room.jpg)<br>**Live debate room.** Turns stream in over SSE. Each card shows the agent's score and its "changes my mind" condition. |
| ![Rebuttal](docs/screenshots/04-rebuttal.jpg)<br>**Founder rebuttal.** The room pauses on a countdown. Send a reply or skip. | ![Verdict stamp](docs/screenshots/05-verdict-stamp.jpg)<br>**Verdict with a stamp.** Recommendation, confidence and a radar scorecard. |
| ![Production GO verdict](docs/screenshots/06-verdict-go-production.jpg)<br>**A real GO verdict from production.** GO is rare. This run returned it in 144 seconds. | ![Night Card theme](docs/screenshots/07-theme-night-card.jpg)<br>**Four themes.** Ringside, Night Card, Courtside and Bubblegum. |

On a phone the room shows one agent tab at a time:

<p align="center"><img src="docs/screenshots/08-mobile.jpg" alt="Debate room on a 375px phone screen" width="260"></p>

Screenshots 02 to 05, 07 and 08 come from the scripted dev demo (`/?demo=1`), which is why a "Demo" badge sits in the corner. Screenshot 06 is a live production run.


## Architecture

```mermaid
flowchart LR
  Browser["React + Vite SPA<br/>Vercel"] -- "POST /debates<br/>GET SSE stream<br/>POST rebuttal" --> API["FastAPI, one uvicorn worker<br/>Heroku"]
  API --> Runner["DebateRunner<br/>event log + rebuttal queues"]
  Runner --> Graph["LangGraph state machine<br/>setup, 3 rounds, checkpoints,<br/>rebuttal, verdict, report"]
  Graph --> Gateway["app/llm.py gateway<br/>only module that calls a model"]
  Gateway -- "LLM_PROVIDER=openrouter" --> OR["OpenRouter"]
  Gateway -- "LLM_PROVIDER=fake" --> Fake["Fake provider, no network"]
  OR --> Fast["FAST_MODEL<br/>openai/gpt-6.1-terra<br/>intake, repeat guard, persona"]
  OR --> Agent["AGENT_MODEL<br/>openai/gpt-6.1-terra<br/>critic turns, checkpoints"]
  OR --> Judge["JUDGE_MODEL<br/>openai/gpt-6.1-sol<br/>verdict"]
  OR --> Esc["ESCALATION_MODEL<br/>anthropic/claude-opus-5.5<br/>verdict retry"]
  API --> DB[("SQLite locally<br/>Heroku Postgres in production")]
```

- **Frontend:** React and Vite single-page app in `frontend/`, deployed on Vercel. A reducer folds the SSE event stream into room state.
- **Backend:** FastAPI in `backend/app/`, with the debate as a LangGraph graph. Debates, turns and verdicts are stored in Postgres (SQLite in dev).
- **Model routing:** model IDs are environment variables only. Any OpenRouter model can be swapped in through configuration, with no code change; the app checks at startup that each configured model supports structured output and reasoning, and reports the result on `/health`.

### Safety

- **Untrusted input.** The pitch, its metadata and earlier turns are wrapped in delimiter tags, and prompts tell the model to treat that content as data. Markdown export quotes untrusted text so it cannot add headings or lists.
- **Rate limits.** Per-client limits on debates and on intake checks, keyed on the client IP with a configurable trusted-proxy count.
- **Budgets.** A hard token cap per debate, a reserve held back for the verdict, a turn cap, a whole-debate timeout, and a cap on concurrent debates. No model call starts once the token cap is reached.
- **Verdict validation.** The verdict is checked against a schema and for internal consistency. The ladder is judge, judge retry with the errors appended, escalation-model repair, then a fallback verdict that is flagged as one.


## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React, Vite, TypeScript, Tailwind CSS v4, Motion, Recharts |
| Live updates | Server-Sent Events with replay from the last event id |
| Backend | Python 3.12, FastAPI, LangGraph, Pydantic v2, SQLAlchemy (async) |
| Models | OpenRouter: GPT-6.1 Terra for the panel, GPT-6.1 Sol for the verdict, Claude Opus 5.5 for verdict repair |
| Data | Heroku Postgres in production, SQLite locally |
| Hosting | Vercel (frontend), Heroku (backend) |
| Quality | pytest, Vitest, Playwright, a 20-pitch evaluation harness, GitHub Actions CI |

## Measured results

Measured on 2026-11-07 over the 20 pitches in `backend/evals/pitches.json`, run directly through the graph with three debates at a time, using `openai/gpt-6.1-terra` and `openai/gpt-6.1-sol`. Latency is inflated by that concurrency.

| Metric | Value |
|---|---|
| Completion rate | 100% (20 of 20) |
| Schema-valid verdicts | 100%, no fallbacks |
| p50 / p95 latency | 128.5s / 147.4s |
| Mean cost per debate | $0.085 |
| Turns regenerated for repetition | 0% |
| Debates with a turn over 120 words | 3 of 20 |

| Pitch type | Mean score | Verdicts |
|---|---|---|
| Strong | 4.8 | 5 pivot |
| Weak | 4.1 | 3 pivot, 2 no-go |
| Vague | 3.0 | 2 pivot, 3 no-go |
| Injection attempts | 4.4 | 5 pivot |

One production browser run took 132s from pitch to verdict. Its first turn appeared after about 15s, slower than the 3-second target, because input checks and the persona run first. A separate production run returned a GO verdict in 144s.

**Known limit:** no pitch in this set reached `go`, so the panel leans strict. Human usefulness ratings have not been collected.


## Known limits

- One web process only. The event log and rebuttal queues are in process memory, so scaling to more than one dyno or worker breaks live streams.
- In-flight debates are lost on restart or dyno cycling. On startup, debates left `running` are marked `failed`.
- Rate-limit state lives per process and resets when the dyno restarts.
- No live market data. Critique reasons from the pitch and the model's knowledge, which may be out of date or wrong.
- The panel is strict, so GO is rare.
- Critique is for brainstorming and is not professional advice.
- No authentication. Debates are public to anyone with the unguessable link; deletion uses a token that the browser that created the debate keeps in `localStorage`, so only that browser can delete it.
- The automated tests run on SQLite; Postgres is exercised only in production.


## Roadmap

- Voice "Fight Night Broadcast": each agent speaks in its own voice, with live listening and a replay of the whole debate (in progress)
- Boardroom scene: an office-style table with the investors facing the founder, animated as the debate plays out
- Agent lineup selector
- Intensity slider
- Web search with citations
- History and accounts

## License

No license has been chosen yet.

---

Running it yourself or contributing? See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
