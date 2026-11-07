import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ThemeSwitcher from './ThemeSwitcher'
import { THEMES, THEME_KEY } from '../lib/theme'

describe('ThemeSwitcher', () => {
  it('offers every theme as a radio and marks the current one', () => {
    render(<ThemeSwitcher />)
    const group = screen.getByRole('radiogroup', { name: /theme/i })
    expect(group).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(THEMES.length)
    expect(screen.getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(1)
  })

  it('switching applies the theme to the page and remembers it', async () => {
    render(<ThemeSwitcher />)
    await userEvent.click(screen.getByRole('radio', { name: /night card/i }))
    expect(document.documentElement.dataset.theme).toBe('nightcard')
    expect(localStorage.getItem(THEME_KEY)).toBe('nightcard')
    expect(screen.getByRole('radio', { name: /night card/i })).toHaveAttribute('aria-checked', 'true')
  })

  it('opens on the stored theme', () => {
    localStorage.setItem(THEME_KEY, 'courtside')
    render(<ThemeSwitcher />)
    expect(screen.getByRole('radio', { name: /courtside/i })).toHaveAttribute('aria-checked', 'true')
  })
})
