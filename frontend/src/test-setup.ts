import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { stubMatchMedia } from './test-utils'

// Tests run as a visitor who asked for reduced motion, so staged reveals settle at once.
// Individual tests override this with stubMatchMedia(false).
beforeEach(() => {
  stubMatchMedia(true)
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})
