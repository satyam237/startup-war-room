/**
 * A scripted debate for `/?demo=1` (development only). It speaks the same event contract as the server, so the
 * real reducer and the real screens run unchanged, with no backend and no model calls.
 * Nothing here is imported by production code paths.
 */
import type { AgentId, DebateAction, FinalPosition, Verdict } from '../lib/debateReducer'

export interface DemoStep {
  /** Milliseconds from the start at normal speed. */
  at: number
  action: DebateAction
}

export const DEMO_PITCH =
  'An app that matches freelance electricians with last-minute jobs near them, with instant payouts after each job and a 12 percent fee charged to the homeowner.'

type Lines = Record<AgentId, string[]>

/** What each fighter says in rounds 1 to 3 (index 0 to 2). The moderator speaks only through checkpoints. */
const SAY: Lines = {
  vc: [
    'The market is huge and fragmented, and urgent repairs are the part homeowners pay a premium for. My worry is the take rate. Twelve percent on a job that costs two hundred dollars is twenty-four dollars, and you still have to win the electrician, the homeowner and the payout float.',
    'You said emergency jobs are the wedge, so show me repeat behaviour. A homeowner calls an electrician maybe once a year. Without repeat use, every job costs you a new acquisition, and that is what kills marketplaces at this stage.',
    'My position is cautious. There is a business here if you own the emergency niche in one city and prove the same electricians come back weekly. I would not fund a national launch on this plan.',
  ],
  customer: [
    'When my power went out last winter I called six numbers and nobody picked up. I would pay a fee to have someone confirmed in twenty minutes. But I would not pay twelve percent on a routine job, I would just ask my neighbour for a name.',
    'Trust is the whole thing. I am letting a stranger into my home. Show me licences, insurance and reviews on the first screen, and tell me what happens if the work is bad. A rating alone does not cover a fire hazard.',
    'I would use it once in an emergency and then forget the app exists. To keep me, there has to be a reason to open it when nothing is broken, such as booking a yearly safety check.',
  ],
  cto: [
    'Matching by distance and availability is easy. The hard parts are verifying licences per state, instant payouts without fraud losses, and keeping the electrician from taking the customer off-platform after the first job. Each is a real build, not a weekend.',
    'Instant payouts mean you front the money before the homeowner settles, so chargebacks land on you. Budget for a fraud model and a reserve. Also plan for dispatch to fail in bad weather, exactly when demand spikes.',
    'It is buildable by a small team in four months if you buy payments and identity checks instead of writing them. The risk is operational, not technical. I would rate it feasible and ship a single city first.',
  ],
  competitor: [
    'We already have a network of forty thousand licensed electricians and a booking page that ranks first for emergency electrician. We can add instant payouts in a quarter. What do you have that we cannot copy by next summer?',
    'Your supply side is the same electricians we pay today, and they will list on both apps. Without exclusivity you are a coupon for our customers. Expect us to match your fee and out-spend you on search ads.',
    'The defensible piece is not the app, it is density: enough electricians in one area that response time beats ours. If you can show that in a single city, I take you seriously. Until then, you are a feature.',
  ],
  moderator: [],
}

const CHECKPOINTS: { summary: string; top_disagreements: [string, string] }[] = [
  {
    summary: 'The room agrees the pain is real but disagrees on whether a twelve percent fee survives contact with repeat-use economics.',
    top_disagreements: ['Investor and Customer: is twelve percent too high once the job is routine?', 'Engineer and Rival: can instant payouts be built safely, and copied just as fast?'],
  },
  {
    summary: 'Trust and density came up from every side. The panel splits on whether the emergency niche is a wedge or a trap.',
    top_disagreements: ['Customer and Investor: does an emergency-only product ever earn repeat use?', 'Rival and Engineer: is density a moat, or just a head start?'],
  },
  {
    summary: 'Final positions are in. The panel sees a real need and a thin moat, and wants proof of density and repeat use before any scale-up.',
    top_disagreements: ['Investor and Rival: one dense city proves it, or proves nothing?', 'Customer and Engineer: how much verification is enough before the first job?'],
  },
]

const FINAL: Record<'vc' | 'customer' | 'cto' | 'competitor', FinalPosition> = {
  vc: { score_1_to_10: 5, top_risk: 'Fee is too thin to cover acquisition on one-off jobs', change_mind_if: 'Weekly repeat jobs from the same electricians in one city' },
  customer: { score_1_to_10: 6, top_risk: 'I will not let a stranger in without verified licences and insurance', change_mind_if: 'A clear guarantee if the work is unsafe' },
  cto: { score_1_to_10: 7, top_risk: 'Instant payouts invite chargeback losses before you have data', change_mind_if: 'A fraud reserve and a payments partner already signed' },
  competitor: { score_1_to_10: 4, top_risk: 'Incumbents match the fee and the payout speed within a quarter', change_mind_if: 'Response time under twenty minutes in a whole city' },
}

export type VerdictKind = 'pivot' | 'go' | 'no_go' | 'partial'

/** Realistic verdicts: long reasons, five risks, three experiments with long criteria. */
export function demoVerdict(kind: VerdictKind = 'pivot'): Verdict {
  const base: Verdict = {
    recommendation: 'pivot',
    confidence: 0.72,
    one_line_summary: 'Narrow to emergency jobs in one dense city before you widen the product or touch the fee.',
    fallback: false,
    scorecard: {
      market: { score: 8, why: 'Home repair is a large, fragmented trade, and urgent work is the slice where homeowners already accept a premium and skip comparison shopping.' },
      customer_pull: { score: 6, why: 'The pain is sharp in the moment but episodic. Most homeowners need an electrician about once a year, so retention has to come from somewhere other than the repair itself.' },
      feasibility: { score: 7, why: 'Matching and dispatch are standard. Licence checks by state and instant payouts add real work, but both can be bought rather than built if the team stays small.' },
      defensibility: { score: 3, why: 'An incumbent with a large network can copy the app and the fee within a quarter. Only local density, meaning response time, is hard to copy, and it is unproven here.' },
      timing: { score: 5, why: 'Skilled-trade shortages and on-demand habits help, but nothing has changed recently that makes this idea newly possible, so there is no clear window.' },
    },
    risks: [
      { rank: 1, risk: 'A twelve percent fee on a two hundred dollar job does not cover the cost of winning a homeowner who may never call again.', severity: 'high', raised_by: 'VC' },
      { rank: 2, risk: 'Homeowners will not admit a stranger into their home without verified licences, insurance, and a clear remedy when the work is unsafe.', severity: 'high', raised_by: 'Customer' },
      { rank: 3, risk: 'Instant payouts put the company on the hook for chargebacks and fraud before it has any loss data to price the risk.', severity: 'med', raised_by: 'CTO' },
      { rank: 4, risk: 'Established networks already list the same electricians and can match the fee and the payout speed, leaving no reason to switch.', severity: 'high', raised_by: 'Competitor' },
      { rank: 5, risk: 'Electricians who win a job through the app may take the customer off-platform for every repeat booking, starving the fee.', severity: 'med', raised_by: 'CTO' },
    ],
    experiments: [
      {
        test: 'Run a concierge service in one city: take emergency calls yourself, dispatch to ten electricians by phone, and log time to arrival.',
        timebox_days: 21,
        success_criteria: 'Median arrival under thirty minutes on at least forty jobs, and at least a third of electricians ask to take more work next week.',
        kill_criteria: 'Median arrival over ninety minutes, or fewer than fifteen jobs completed because electricians do not answer or homeowners will not book.',
      },
      {
        test: 'Offer the same ten electricians a flat per-job lead fee instead of a percentage, and compare their willingness to stay on the platform.',
        timebox_days: 14,
        success_criteria: 'At least seven of ten electricians accept the flat fee, and more than half of repeat customers book through the platform again.',
        kill_criteria: 'Fewer than four electricians accept, or most repeat bookings move to direct phone calls within two weeks.',
      },
      {
        test: 'Show a landing page with verified-licence badges and a safety guarantee to homeowners who recently searched for an emergency electrician.',
        timebox_days: 10,
        success_criteria: 'A booking request rate above four percent of visitors, with most requests citing the guarantee or the verification as the reason.',
        kill_criteria: 'Under one percent request a booking after paid traffic of at least a thousand visits, or most drop out at the verification step.',
      },
    ],
  }
  if (kind === 'go') {
    return {
      ...base,
      recommendation: 'go',
      confidence: 0.81,
      one_line_summary: 'Strong signals on need and density. Build the city launch and measure repeat use from week one.',
      scorecard: {
        market: { score: 9, why: 'A very large trade with clear, price-insensitive urgent demand and little brand loyalty to defend against.' },
        customer_pull: { score: 8, why: 'Interviewed homeowners described the last outage in detail and said they would pay for confirmed arrival.' },
        feasibility: { score: 8, why: 'Every hard component can be bought. The remaining work is operational and well within a four-person team.' },
        defensibility: { score: 6, why: 'Local density is a real moat if the first city shows response times incumbents cannot match.' },
        timing: { score: 7, why: 'Labour shortages and on-demand expectations are both trending in your favour.' },
      },
    }
  }
  if (kind === 'no_go') {
    return {
      ...base,
      recommendation: 'no_go',
      confidence: 0.77,
      one_line_summary: 'The fee cannot carry the acquisition cost and the incumbent can copy you; stop before building.',
      scorecard: {
        market: { score: 6, why: 'A large market, but the reachable slice is small once you remove customers already locked into an incumbent.' },
        customer_pull: { score: 3, why: 'Demand is rare and personal, and homeowners can find a name from neighbours at no cost.' },
        feasibility: { score: 5, why: 'Payments, licensing and dispatch together are more than a small team can safely launch.' },
        defensibility: { score: 2, why: 'Nothing here is hard to copy for a company with an existing network and a larger ad budget.' },
        timing: { score: 4, why: 'No new change makes this newly possible, and larger players are already moving.' },
      },
    }
  }
  if (kind === 'partial') {
    return { ...base, fallback: true, confidence: 0.45, one_line_summary: 'The debate ended early, so this is a simpler read: narrow to emergency jobs in one city.' }
  }
  return base
}

export interface ScriptOptions {
  kind?: VerdictKind
}

/**
 * The whole debate as timed events. Covers every event type: setup, turn_start, turn_token, turn_reset, turn_end,
 * turn_failed, checkpoint, await_rebuttal, rebuttal_received, verdict, error and done.
 */
export function demoScript({ kind = 'pivot' }: ScriptOptions = {}): DemoStep[] {
  const steps: DemoStep[] = []
  let seq = 0
  let t = 0
  const push = (at: number, action: DebateAction) => steps.push({ at, action: { ...action, seq: ++seq } as DebateAction })

  // About 15 seconds of setup in real life; shortened here so a demo does not stall.
  push(t += 300, { type: 'setup', data: { step: 'persona', message: 'Building your customer persona...' } })
  push(t += 1400, { type: 'setup', data: { step: 'competitors', message: 'Scouting who already sells this...' } })
  push(t += 1400, { type: 'setup', data: { step: 'ready', message: 'The panel is ready.' } })
  t += 900

  const order: Exclude<AgentId, 'moderator'>[] = ['vc', 'customer', 'cto', 'competitor']
  const speak = (round: number, agent: Exclude<AgentId, 'moderator'>, text: string, opts: { reset?: boolean; fail?: string } = {}) => {
    const id = `r${round}-${agent}`
    push(t += 500, { type: 'turn_start', data: { turn_id: id, agent, round, attempt: 1 } })
    const words = text.split(' ')
    const chunk = (from: number, to: number) => {
      for (let i = from; i < to; i += 3) push(t += 110, { type: 'turn_token', data: { turn_id: id, text: words.slice(i, Math.min(i + 3, to)).join(' ') + ' ' } })
    }
    if (opts.fail) {
      chunk(0, 6)
      push(t += 900, { type: 'turn_failed', data: { agent, round, note: opts.fail } })
      return
    }
    if (opts.reset) {
      chunk(0, 9)
      push(t += 300, { type: 'turn_reset', data: { turn_id: id, reason: 'repetition' } })
      push(t += 400, { type: 'turn_start', data: { turn_id: id, agent, round, attempt: 2 } })
    }
    chunk(0, words.length)
    const data = { turn_id: id, agent, round, text, ...(round === 3 && { final_position: FINAL[agent] }) }
    push(t += 250, { type: 'turn_end', data })
  }

  for (let round = 1; round <= 3; round++) {
    for (const agent of order) {
      if (round === 2 && agent === 'competitor') speak(round, agent, SAY[agent][1], { fail: 'The rival lost its train of thought, so this turn was skipped.' })
      else speak(round, agent, SAY[agent][round - 1], { reset: round === 2 && agent === 'cto' })
    }
    push(t += 700, { type: 'checkpoint', data: { round, ...CHECKPOINTS[round - 1] } })
    if (round === 2) {
      push(t += 400, { type: 'error', data: { message: 'The panel hit a slow response and is catching up.', recoverable: true } })
      push(t += 600, { type: 'await_rebuttal', data: { timeout_s: 30 } })
      // The demo room holds here until the viewer answers or the clock runs out.
      push(t += 30_000, { type: 'rebuttal_received', data: { text: null } })
    }
  }
  push(t += 1200, { type: 'verdict', data: demoVerdict(kind) })
  push(t += 400, { type: 'done', data: { status: kind === 'partial' ? 'partial' : 'complete' } })
  return steps
}
