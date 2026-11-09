/**
 * A one-at-a-time job queue that can drop everything still waiting. The HD worker renders chunks through
 * it, so a listener who skips five lines does not sit through five stale renders before the one they want.
 * The job already rendering cannot be interrupted; its result is simply ignored by the page.
 */
export class RenderQueue<J> {
  private jobs: J[] = []
  private busy = false
  private readonly render: (job: J) => Promise<void>

  /** `render` must handle its own errors. */
  constructor(render: (job: J) => Promise<void>) {
    this.render = render
  }

  get waiting(): number { return this.jobs.length }

  push(job: J): void {
    this.jobs.push(job)
    void this.pump()
  }

  /** Drops every job that has not started. */
  cancelAll(): void {
    this.jobs = []
  }

  private async pump(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      while (this.jobs.length) await this.render(this.jobs.shift()!)
    } finally {
      this.busy = false
    }
  }
}
