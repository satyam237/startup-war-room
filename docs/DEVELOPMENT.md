# Development

Setup, configuration, tests and deployment for Startup War Room. For what the project is, see the [README](../README.md).

## Quick start

Requirements: Python 3.12 (managed by `uv`) and Node 22.

```bash
cp .env.example .env            # then edit; .env is git-ignored
cd backend && uv sync
uv run uvicorn app.main:app --reload --port 8000
# in another terminal
cd frontend && npm ci && npm run dev    # http://localhost:5173, proxies /debates to :8000
```

### Fake-provider mode (no key, no cost, no network)

```bash
cd backend
LLM_PROVIDER=fake uv run uvicorn app.main:app --port 8000
curl localhost:8000/health      # {"status":"ok","models_ok":true,"key_ok":true}
cd ../frontend && npm ci && npm run dev
```

The fake provider returns canned debate turns and a valid verdict, so the whole flow runs end to end. Tests always use it.

### Scripted demo (dev only)

With the frontend dev server running, open `http://localhost:5173/?demo=1` for a scripted debate in the browser. The demo module is not bundled in production builds.

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

### Health check

`GET /health` always returns HTTP 200 while the process is up, with `{"status":"ok","models_ok":true,"key_ok":true}`. `models_ok` is `false` when the startup check found an unusable model, and `key_ok` is `false` when the `openrouter` provider has no `OPENROUTER_API_KEY`. It does not check the database, credits, or whether the provider is reachable now.

### Debate status

| Status | Meaning |
|---|---|
| `complete` | All rounds ran. A `fallback` verdict can still appear if the judge ladder failed |
| `budget_exceeded` | A token, turn, or time limit ended the debate early |
| `partial` | The debate ended short of four final positions, or the provider refused the key or the account (HTTP 401, 402, 403) after at least one critic spoke. The evals do not count it as completed |
| `failed` | No verdict: the provider refused before any critic spoke, or the process stopped |

## Tests

```bash
cd backend && uv run pytest -q                  # backend tests, fake provider
cd frontend && npx vitest run && npm run build  # component tests, then typecheck and build
cd frontend && npx playwright test              # end to end; starts its own backend and web servers
```

CI (`.github/workflows/ci.yml`) runs pytest, vitest and the build with `LLM_PROVIDER=fake`. Playwright is not part of CI. If its browsers are missing, run `npx playwright install` first.

### Eval harness

`backend/evals/run_evals.py` runs the 20 pitches in `backend/evals/pitches.json` through the debate graph, skipping the rebuttal.

```bash
cd backend
LLM_PROVIDER=fake uv run python evals/run_evals.py                   # free
uv run python evals/run_evals.py --yes-spend-money --max-spend 5.0   # real models
```

With any provider but `fake` it refuses to run without `--yes-spend-money`. `--max-spend` (default 5.0 USD) stops the run once that much is spent. It also stops early if every debate so far failed the same way, such as an out-of-credits 402. `--limit N` runs the first N pitches and `--concurrency N` (default 3) sets parallelism.

## Deployment

- Backend: Heroku Basic dyno plus Heroku Postgres. Deploy the `backend/` directory with `git subtree push --prefix backend heroku main`, so `backend/Procfile`, `pyproject.toml`, `uv.lock` and `.python-version` sit at the build root, which is what Heroku's Python buildpack uses to detect a uv project. `backend/Dockerfile` runs the same command for any container host.
- Frontend: Vercel with root directory `frontend`, env `VITE_API_URL` set to the backend URL. `frontend/vercel.json` rewrites all paths to `index.html` for the SPA router.
- Set `FRONTEND_ORIGIN` on the backend to the Vercel URL.
- Set `TRUSTED_PROXY_HOPS=1` on the backend (`heroku config:set TRUSTED_PROXY_HOPS=1 --app <app>`). Heroku's router is the one trusted proxy; left at `0`, every visitor shares one rate-limit bucket.

