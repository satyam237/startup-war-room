import type { Experiment } from '../lib/debateReducer'

export default function ExperimentList({ experiments }: { experiments: Experiment[] }) {
  return (
    <section aria-labelledby="exp-h">
      <h2 id="exp-h" className="font-display text-2xl font-bold">Run these next</h2>
      <ol aria-label="Experiments" className="mt-3 grid gap-4 md:grid-cols-3">
        {experiments.map((e, i) => (
          <li key={i} className="rounded-sm border border-line bg-panel p-4">
            <p className="text-sm text-muted">{e.timebox_days} days</p>
            <p className="mt-1 font-body text-lg leading-snug">{e.test}</p>
            <dl className="mt-3 space-y-2 text-sm">
              <div>
                <dt className="font-semibold text-customer">Keep going if</dt>
                <dd className="text-muted">{e.success_criteria}</dd>
              </div>
              <div>
                <dt className="font-semibold text-competitor">Stop if</dt>
                <dd className="text-muted">{e.kill_criteria}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>
    </section>
  )
}
