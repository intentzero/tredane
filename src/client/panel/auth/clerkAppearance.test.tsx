import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  clerkAppearance,
  clerkAuthAppearance,
  clerkProviderAppearance,
  clerkUserProfileAppearance,
} from './clerkAppearance'

const panelCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../ui/panel.css'),
  'utf8',
)

describe('clerkAppearance', () => {
  it('mantém alias clerkAppearance = auth flush (SignIn / cadastro transparente)', () => {
    expect(clerkAppearance).toBe(clerkAuthAppearance)
    expect(clerkAuthAppearance.options.elevation).toBe('flush')
    expect(clerkAuthAppearance.variables.colorBackground).toBe('transparent')
    expect(clerkAuthAppearance.elements.card).toBe('panel-clerk-card')
    expect(clerkAuthAppearance.elements.otpCodeFieldInputs).toBe('panel-clerk-otp-inputs')
    expect(clerkAuthAppearance.elements.otpCodeFieldInput).toBe('panel-clerk-otp-input')
  })

  it('casas OTP têm lado explícito e não colapsam em barras', () => {
    const start = panelCss.indexOf('OTP factor-one no /entrar')
    const end = panelCss.indexOf('@media (min-width: 768px)', start)
    const block = panelCss.slice(start, end)
    expect(block).not.toMatch(/^\s*width:\s*auto/m)
    expect(block).not.toMatch(/^\s*min-width:\s*0/m)
    expect(block).not.toMatch(/^\s*flex:\s*1\s+1\s+0/m)
    expect(block).toContain('--panel-otp-digit: min(var(--size-control-lg), var(--size-touch))')
    expect(block).toContain('width: var(--panel-otp-digit) !important')
    expect(block).toContain('height: var(--panel-otp-digit) !important')
    expect(block).toContain('gap: var(--space-2) !important')
  })

  it('ClerkProvider não carimba card/rootBox de perfil (evita merge no SignIn)', () => {
    expect('card' in clerkProviderAppearance.elements).toBe(false)
    expect('rootBox' in clerkProviderAppearance.elements).toBe(false)
    expect(clerkProviderAppearance.elements.modalBackdrop).toBe(
      'panel-clerk-profile-backdrop',
    )
    expect(clerkProviderAppearance.elements.modalContent).toBe(
      'panel-clerk-profile-modal',
    )
    expect(clerkProviderAppearance.variables.colorBackground).toBe(
      'var(--color-surface-card)',
    )
  })

  it('UserProfile / Conta usa cartão opaco sem elevation flush', () => {
    expect('elevation' in clerkUserProfileAppearance.options).toBe(false)
    expect(clerkUserProfileAppearance.variables.colorBackground).toBe(
      'var(--color-surface-card)',
    )
    expect(clerkUserProfileAppearance.elements.card).toBe('panel-clerk-profile-card')
    expect(clerkUserProfileAppearance.elements.rootBox).toBe('panel-clerk-profile-root')
    expect(clerkUserProfileAppearance.elements.modalBackdrop).toBe(
      'panel-clerk-profile-backdrop',
    )
    expect(clerkUserProfileAppearance.elements.modalContent).toBe(
      'panel-clerk-profile-modal',
    )
  })
})
