import { mkdirSync, rmSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'
import { MAIN, RESTART, RUN_DB_DIR, SHORT_WAIT, apiUrl, backendCommand, backendEnv, webUrl, type Stack } from './e2e/servers'

// Fresh databases per run. Only the main process runs the config's side effects once.
if (!process.env.TEST_WORKER_INDEX) {
  rmSync(RUN_DB_DIR, { recursive: true, force: true })
  mkdirSync(RUN_DB_DIR, { recursive: true })
}

const backend = (s: Stack) => ({
  command: backendCommand(s),
  cwd: '../backend',
  url: `${apiUrl(s)}/health`,
  env: backendEnv(s),
  reuseExistingServer: false,
  timeout: 60_000,
})

const web = (s: Stack) => ({
  command: `npx vite --host 127.0.0.1 --port ${s.web} --strictPort`,
  url: webUrl(s),
  env: { VITE_API_URL: apiUrl(s) },
  reuseExistingServer: false,
  timeout: 60_000,
})

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: { ...devices['Desktop Chrome'], trace: 'off', screenshot: 'only-on-failure' },
  webServer: [backend(MAIN), web(MAIN), backend(SHORT_WAIT), web(SHORT_WAIT), web(RESTART)],
})
