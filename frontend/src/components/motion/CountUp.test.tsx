import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { stubMatchMedia } from '../../test-utils'
import CountUp from './CountUp'

/** An observer that reports nothing until told, like a score further down a page nobody has scrolled. */
class Offscreen {
  static fire: () => void = () => {}
  constructor(private cb: IntersectionObserverCallback) {
    Offscreen.fire = () => this.cb([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
  observe() {}
  disconnect() {}
}

describe('CountUp', () => {
  beforeEach(() => {
    stubMatchMedia(false)
    vi.stubGlobal('IntersectionObserver', Offscreen)
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: 5000 } as DOMRect)
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('holds the real score in the page until it is seen, so printing or reading it never shows 0', () => {
    render(<CountUp value={7} />)
    expect(document.querySelector('[data-score]')).toHaveTextContent('7')
  })

  it('reads out only the real score, never the numbers it counts through', () => {
    vi.mocked(Element.prototype.getBoundingClientRect).mockReturnValue({ top: 10 } as DOMRect)
    render(<CountUp value={7} />)
    expect(document.querySelector('[data-score]')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('7')).not.toHaveAttribute('aria-hidden') // the stable value for assistive tech
  })

  it('counts from zero once it is seen, and ends on the real score', async () => {
    render(<CountUp value={7} />)
    act(() => Offscreen.fire())
    await vi.waitFor(() => expect(document.querySelector('[data-score]')).toHaveTextContent('7'), { timeout: 3000 })
  })

  it('starts at zero when it mounts on screen, so the reveal has no flash of the final number', () => {
    vi.mocked(Element.prototype.getBoundingClientRect).mockReturnValue({ top: 10 } as DOMRect)
    render(<CountUp value={7} />)
    expect(document.querySelector('[data-score]')).toHaveTextContent('0')
  })

  it('shows the real score when printing, even if the count-up is under way or about to start', () => {
    render(<CountUp value={7} delay={5} />)
    act(() => Offscreen.fire()) // the print layout can bring a score on screen
    expect(document.querySelector('[data-score]')).toHaveTextContent('0')
    act(() => { window.dispatchEvent(new Event('beforeprint')) })
    expect(document.querySelector('[data-score]')).toHaveTextContent('7')
  })

  it('does not start counting once the page is printing', () => {
    render(<CountUp value={7} />)
    act(() => { window.dispatchEvent(new Event('beforeprint')) })
    act(() => Offscreen.fire())
    expect(document.querySelector('[data-score]')).toHaveTextContent('7')
  })
})
