import type { Experiment } from '../lib/debateReducer'
import { CascadeItem } from './motion/reveal'

export default function ExperimentList({ experiments }: { experiments: Experiment[] }) {
  return (
    <section aria-labelledby="exp-h">
      <h2 id="exp-h" className="display text-5xl">Run these next</h2>
      <ol aria-label="Experiments" className="mt-5 grid gap-6 md:grid-cols-3">
        {experiments.map((e, i) => (
          <CascadeItem key={i} index={i} className="surface relative flex flex-col p-4 pt-6 transition-transform duration-150 hover:-translate-y-1 hover:rotate-[-0.6deg]">
            <span
              className="display absolute -top-4 left-4 -rotate-3 rounded border-[3px] border-line bg-accent px-3 py-1 text-xl text-on-accent"
              style={{ boxShadow: '3px 3px 0 var(--color-shade)' }}
            >
              {e.timebox_days} days
            </span>
            <p className="mt-2 font-body text-lg font-semibold leading-snug">{e.test}</p>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="rounded border-[3px] border-line p-2.5" style={{ background: 'color-mix(in srgb, var(--color-customer) 28%, var(--color-panel))' }}>
                <dt className="font-extrabold">Keep going if</dt>
                <dd className="mt-0.5 font-body leading-relaxed">{e.success_criteria}</dd>
              </div>
              <div className="rounded border-[3px] border-line p-2.5" style={{ background: 'color-mix(in srgb, var(--color-competitor) 24%, var(--color-panel))' }}>
                <dt className="font-extrabold">Stop if</dt>
                <dd className="mt-0.5 font-body leading-relaxed">{e.kill_criteria}</dd>
              </div>
            </dl>
          </CascadeItem>
        ))}
      </ol>
    </section>
  )
}
