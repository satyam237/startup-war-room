import { expect, type Page } from '@playwright/test'

export const PITCH =
  'An app that matches freelance electricians with last-minute jobs near them, with instant payouts after each job and a 12 percent fee charged to the homeowner.'

/** Fills the pitch form, submits, and waits for the debate room. Returns the debate id. */
export async function startDebate(page: Page, web: string): Promise<string> {
  await page.goto(`${web}/`)
  await page.getByLabel('Your pitch').fill(PITCH)
  await page.getByRole('button', { name: 'Start the debate' }).click()
  await page.waitForURL(/\/d\/[\w-]+$/)
  return page.url().split('/d/')[1]
}

export const rebuttalBox = (page: Page) => page.getByRole('textbox', { name: 'Your rebuttal' })

export async function expectVerdict(page: Page) {
  await page.waitForURL(/\/d\/[\w-]+\/verdict$/)
  await expect(page.getByRole('heading', { name: 'Scorecard' })).toBeVisible()
}

/** No horizontal scroll: the document is no wider than the viewport. */
export async function expectNoHorizontalOverflow(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }))
  expect(scroll, `scrollWidth ${scroll} > clientWidth ${client}`).toBeLessThanOrEqual(client)
}
