import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { MAIN, SHORT_WAIT, apiUrl, webUrl } from './servers'
import { expectNoHorizontalOverflow, expectVerdict, rebuttalBox, startDebate } from './helpers'

const web = webUrl(MAIN)

test('pitch to verdict with a rebuttal', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  page.on('pageerror', (e) => consoleErrors.push(e.message))
  await startDebate(page, web)

  // Cards for the four seats, and live text in the feed.
  await expect(page.getByTestId('agent-vc')).toBeVisible()
  await expect(page.getByRole('log', { name: 'Debate transcript' }).locator('article').first()).toBeVisible()

  await rebuttalBox(page).fill('We target solo electricians first, so supply is not the bottleneck.')
  await page.getByRole('button', { name: 'Send rebuttal' }).click()
  await expect(rebuttalBox(page)).toBeHidden()

  await expectVerdict(page)
  await expect(page.getByRole('list', { name: 'Scores' }).locator('li')).toHaveCount(5)
  await expect(page.getByRole('heading', { name: /Risks/i }).first()).toBeVisible()

  // The radar draws in a real browser: a visible, non-empty SVG polygon.
  const chart = page.locator('svg.recharts-surface').first()
  await expect(chart).toBeVisible()
  const box = await chart.boundingBox()
  expect(box!.width).toBeGreaterThan(100)
  expect(box!.height).toBeGreaterThan(100)
  const outline = page.locator('.recharts-radar-polygon path').first()
  await expect(outline).toHaveAttribute('d', /^M.+/)
  expect(consoleErrors).toEqual([])
})

test('no rebuttal auto-continues', async ({ page }) => {
  await startDebate(page, webUrl(SHORT_WAIT))
  // REBUTTAL_TIMEOUT_S=2: round 2 must start well inside a 30s window. The rebuttal box is not
  // asserted because it may already be gone by the time the page has replayed.
  await expect(page.getByText('Round 2 of 3')).toBeVisible({ timeout: 15_000 })
  await expectVerdict(page)
})

test('reload mid-debate catches up', async ({ page }) => {
  await startDebate(page, web)
  await expect(page.getByRole('log').locator('article').first()).toContainText(/\S/)
  await page.reload()
  await expect(page.getByTestId('agent-vc')).toBeVisible()
  // The replay brings the earlier turns back, and the open rebuttal window with them.
  await expect(page.getByRole('log').locator('article').first()).toContainText(/\S/)
  await rebuttalBox(page).waitFor({ timeout: 60_000 })
  // No duplicated turns in the transcript itself (checked before the verdict page replaces it).
  const heads = await page.getByRole('log').getByRole('heading').allTextContents()
  expect(heads.length).toBeGreaterThan(0)
  expect(heads.length).toBe(new Set(heads).size)
  await page.getByRole('button', { name: 'Skip' }).click()
  await expectVerdict(page)
})

test('share link opens in a fresh context', async ({ page, browser }) => {
  const id = await startDebate(page, web)
  await rebuttalBox(page).waitFor({ timeout: 60_000 })
  await page.getByRole('button', { name: 'Skip' }).click()
  await expectVerdict(page)

  const fresh = await browser.newContext()
  const other = await fresh.newPage()
  await other.goto(`${web}/d/${id}/verdict`)
  await expect(other.getByRole('heading', { name: 'Scorecard' })).toBeVisible()
  // Not the owner of this debate in the new context: no delete control.
  await expect(other.getByRole('button', { name: 'Delete debate' })).toHaveCount(0)
  await fresh.close()
})

test('delete works through the CORS preflight, and export downloads the Markdown', async ({ page, request }) => {
  const id = await startDebate(page, web)
  await rebuttalBox(page).waitFor({ timeout: 60_000 })
  await page.getByRole('button', { name: 'Skip' }).click()
  await expectVerdict(page)

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Export Markdown' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe(`war-room-${id}.md`)
  const body = await readFile(await download.path(), 'utf8')
  expect(body).toMatch(/^# /m)
  expect(body).toContain('electricians')

  page.once('dialog', (d) => void d.accept())
  const deleted = page.waitForResponse((r) => r.request().method() === 'DELETE')
  await page.getByRole('button', { name: 'Delete debate' }).click()
  expect((await deleted).status()).toBe(204)
  await page.waitForURL(`${web}/`)
  expect((await request.get(`${apiUrl(MAIN)}/debates/${id}`)).status()).toBe(404)
})

test('mobile viewport has no horizontal overflow', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()

  await page.goto(`${web}/`)
  await expectNoHorizontalOverflow(page)

  await startDebate(page, web)
  await expect(page.getByTestId('agent-vc')).toBeVisible()
  await expect(page.getByRole('log').locator('article').first()).toBeVisible()
  await expectNoHorizontalOverflow(page)

  // The rebuttal form is the widest thing in the room.
  await rebuttalBox(page).waitFor({ timeout: 60_000 })
  await expectNoHorizontalOverflow(page)
  await page.getByRole('button', { name: 'Skip' }).click()

  await expectVerdict(page)
  await expectNoHorizontalOverflow(page)
  await ctx.close()
})
