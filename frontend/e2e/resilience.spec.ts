import { spawn, type ChildProcess } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { RESTART, apiUrl, backendCommand, backendEnv, webUrl } from './servers'
import { startDebate } from './helpers'

let server: ChildProcess | undefined

async function healthy(): Promise<boolean> {
  try { return (await fetch(`${apiUrl(RESTART)}/health`)).ok } catch { return false }
}

async function waitUntil(ok: () => Promise<boolean>, what: string) {
  for (let i = 0; i < 100; i++) {
    if (await ok()) return
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`timed out waiting for ${what}`)
}

async function boot() {
  server = spawn(backendCommand(RESTART), {
    shell: true,
    cwd: '../backend',
    env: { ...process.env, ...backendEnv(RESTART) },
    detached: true,
    stdio: 'ignore',
  })
  await waitUntil(healthy, 'the backend to come up')
}

/** SIGKILL the whole process group, as a crash or a dyno restart would. */
async function crash() {
  if (server?.pid) process.kill(-server.pid, 'SIGKILL')
  server = undefined
  await waitUntil(async () => !(await healthy()), 'the backend to go down')
}

test.afterAll(async () => { if (server) await crash() })

test('a server restart mid-debate leaves an error, not a spinner', async ({ page }) => {
  await boot()
  await startDebate(page, webUrl(RESTART))
  // Mid-debate: the first speaker has text on screen.
  await expect(page.getByRole('log').locator('article').first()).toContainText(/\S/)

  await crash()
  await boot()

  // The restarted server marks the half-run debate failed; the open page must say so.
  const alert = page.getByRole('alert')
  await expect(alert).toBeVisible({ timeout: 60_000 })
  await expect(alert).toContainText(/ended before|did not finish|lost|failed|went wrong|stopped/i)
  await expect(page.getByRole('link', { name: 'Start a new debate' })).toBeVisible()
  await expect(page.getByRole('timer')).toHaveCount(0)
})
