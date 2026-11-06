import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Three isolated stacks, each a backend plus a Vite dev server that talks to it directly
 * (VITE_API_URL), so every request is cross-origin and goes through CORS like production.
 *  - main:      long rebuttal window, for the ordinary flows
 *  - shortWait: REBUTTAL_TIMEOUT_S=2, for the auto-continue flow
 *  - restart:   started and killed by the test itself
 */
export interface Stack { name: string; api: number; web: number; rebuttalS: number }

export const MAIN: Stack = { name: 'main', api: 8100, web: 5180, rebuttalS: 30 }
export const SHORT_WAIT: Stack = { name: 'short', api: 8101, web: 5181, rebuttalS: 2 }
export const RESTART: Stack = { name: 'restart', api: 8102, web: 5182, rebuttalS: 30 }

export const apiUrl = (s: Stack) => `http://127.0.0.1:${s.api}`
export const webUrl = (s: Stack) => `http://127.0.0.1:${s.web}`

const RUN_DIR = join(tmpdir(), 'swr-e2e')

/** Backend environment: fake provider, quick tokens, a temp SQLite file, limits out of the way. */
export function backendEnv(s: Stack): Record<string, string> {
  return {
    LLM_PROVIDER: 'fake',
    FAKE_DELAY_S: '0.01',
    REBUTTAL_TIMEOUT_S: String(s.rebuttalS),
    DATABASE_URL: `sqlite+aiosqlite:///${join(RUN_DIR, `${s.name}.db`)}`,
    FRONTEND_ORIGIN: webUrl(s),
    RATE_LIMIT_PER_HOUR: '1000',
    INTAKE_RATE_LIMIT_PER_HOUR: '1000',
    OPENROUTER_API_KEY: '',
  }
}

export const backendCommand = (s: Stack) =>
  `uv run uvicorn app.main:app --host 127.0.0.1 --port ${s.api} --workers 1`

export const RUN_DB_DIR = RUN_DIR
