# Startup War Room

A multi-agent debate that stress-tests a startup idea. Adversarial AI personas (VC, customer, CTO, competitor) argue over your pitch in rounds, you can interject with a rebuttal, and a judge returns a schema-validated verdict: recommendation, scorecard, ranked risks, and experiments with kill criteria.

AI critique for brainstorming, not professional advice. Do not paste confidential or proprietary information.

## Architecture

```mermaid
flowchart LR
  Browser["React + Vite SPA<br/>(Vercel)"] -- "POST /debates, GET SSE stream" --> API["FastAPI, one uvicorn worker<br/>(Heroku dyno)"]
  API --> Runner["DebateRunner<br/>in-process event log + rebuttal queues"]
  Runner --> Graph["LangGraph state machine<br/>3 rounds, 14 turns, checkpoints, verdict"]
  Graph --> Gateway["app/llm.py gateway<br/>(only module that talks to a model)"]
  Gateway -- "LLM_PROVIDER=openrouter" --> OR["OpenRouter"]
  Gateway -- "LLM_PROVIDER=fake" --> Fake["Fake provider (no network)"]
  API --> DB[("SQLite locally<br/>Heroku Postgres in production")]
```

## Setup

Requirements: Python 3.12 (managed by `uv`), Node 22.

```bash
cp .env.example .env            # then edit; .env is git-ignored
cd backend && uv sync
uv run uvicorn app.main:app --reload --port 8000
# in another terminal
cd frontend && npm ci && npm run dev    # http://localhost:5173, proxies /debates to :8000
```

### Fake-provider quickstart (no key, no cost, no network)

```bash
cd backend
LLM_PROVIDER=fake uv run uvicorn app.main:app --port 8000
curl localhost:8000/health      # {"status":"ok","models_ok":true,"key_ok":true}
cd ../frontend && npm ci && npm run dev
```

The fake provider returns canned debate turns and a valid verdict, so the whole flow runs end to end. Tests always use it:

```bash
cd backend && uv run pytest -q
cd frontend && npx vitest run && npm run build
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `LLM_PROVIDER` | `openrouter` | `openrouter` or `fake` |
| `OPENROUTER_API_KEY` | empty | Required when the provider is `openrouter`. Environment only |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | API base |
| `FAST_MODEL` | `openai/gpt-6.1-terra` | Intake and repeat guards, persona |
| `AGENT_MODEL` | `openai/gpt-6.1-terra` | Critic turns, final positions, checkpoints |
| `JUDGE_MODEL` | `openai/gpt-6.1-sol` | Verdict |
| `ESCALATION_MODEL` | `anthropic/claude-opus-5.5` | Verdict retry after two failed validations |
| `FAKE_DELAY_S` | `0` | Per-token delay for the fake provider |
| `DATABASE_URL` | `sqlite+aiosqlite:///./warroom.db` | Heroku's `postgres://` is converted to `postgresql+asyncpg://` with TLS |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | The one allowed CORS origin |
| `TRUSTED_PROXY_HOPS` | `0` | Proxies whose `X-Forwarded-For` entry is trusted for rate limiting. Set `1` on Heroku |
| `MAX_TURNS` | `14` | Turn cap |
| `MAX_TOKENS_PER_DEBATE` | `120000` | Hard token cap per debate. No LLM call starts once it is reached |
| `JUDGE_TOKEN_RESERVE` | `60000` | Turns and checkpoints stop this far below the cap, leaving the rest for the verdict ladder. Must be below the cap, or the app refuses to start |
| `RATE_LIMIT_PER_HOUR` | `5` | Debates per client per hour |
| `INTAKE_RATE_LIMIT_PER_HOUR` | `20` | Intake checks per client per hour |
| `REBUTTAL_TIMEOUT_S` | `45` | Wait for a founder rebuttal |
| `DEBATE_TIMEOUT_S` | `240` | Whole-debate timeout |
| `MAX_CONCURRENT_DEBATES` | `10` | Concurrent debates |
| `VITE_API_URL` | empty | Frontend build-time: backend base URL (set in Vercel) |

### Changing models

Model IDs live only in environment variables. To swap one, set it and restart; no code change:

```bash
heroku config:set JUDGE_MODEL=<openrouter-model-id> --app <app>
```

Cost is read from OpenRouter's usage accounting, so a new model needs no price table.

A swapped-in model must accept this app's requests. On OpenRouter's `/models` list, its `supported_parameters` must include `reasoning` and either `structured_outputs` or `response_format`, because every model here is sent both. The check runs at startup on the `openrouter` provider: an unsupported or unlisted model logs an ERROR and makes `/health` return `models_ok: false`. If the list cannot be fetched, the app logs a warning and starts anyway. After a swap, restart and read `/health`.

## Health check

`GET /health` always returns HTTP 200 while the process is up, with `{"status":"ok","models_ok":true,"key_ok":true}`. `models_ok` is `false` when the startup check found an unusable model, and `key_ok` is `false` when the `openrouter` provider has no `OPENROUTER_API_KEY`. It does not check the database, credits, or whether the provider is reachable now.

## Debate status

| Status | Meaning |
|---|---|
| `complete` | All rounds ran. A `fallback` verdict can still appear if the judge ladder failed |
| `budget_exceeded` | A token, turn, or time limit ended the debate early |
| `partial` | The debate ended short of four final positions, or the provider refused the key or the account (HTTP 401, 402, 403) after at least one critic spoke. The evals do not count it as completed |
| `failed` | No verdict: the provider refused before any critic spoke, or the process stopped |

## Deployment

- Backend: Heroku Basic dyno plus Heroku Postgres. Deploy the `backend/` directory with `git subtree push --prefix backend heroku main`, so `backend/Procfile`, `pyproject.toml`, `uv.lock` and `.python-version` sit at the build root, which is what Heroku's Python buildpack uses to detect a uv project. `backend/Dockerfile` runs the same command for any container host.
- Frontend: Vercel with root directory `frontend`, env `VITE_API_URL` set to the backend URL. `frontend/vercel.json` rewrites all paths to `index.html` for the SPA router.
- Set `FRONTEND_ORIGIN` on the backend to the Vercel URL.
- Set `TRUSTED_PROXY_HOPS=1` on the backend (`heroku config:set TRUSTED_PROXY_HOPS=1 --app <app>`). Heroku's router is the one trusted proxy; left at `0`, every visitor shares one rate-limit bucket.

## Known limits

- One web process only. The event log and rebuttal queues are in process memory, so scaling to more than one dyno or worker breaks live streams.
- In-flight debates are lost on restart or dyno cycling. On startup, debates left `running` are marked `failed`.
- Rate-limit state lives per process and resets when the dyno restarts.
- No live market data. Critique reasons from the pitch and the model's knowledge, which may be out of date or wrong.
- Critique is for brainstorming and is not professional advice.
- No authentication. Debates are public to anyone with the unguessable link; deletion uses a token that the browser that created the debate keeps in `localStorage`, so only that browser can delete it.
- The Postgres path has not been exercised against a live Postgres in this repository's tests, which run on SQLite.

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

One production browser run took 132s from pitch to verdict. Its first turn appeared after about 15s, slower than the 3-second target, because input checks and the persona run first.

**Known limit:** no pitch in this set reached `go`, so the panel leans strict. Human usefulness ratings have not been collected.
