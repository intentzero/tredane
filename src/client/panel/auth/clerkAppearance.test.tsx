import { describe, expect, it } from 'vitest'
import {
  clerkAppearance,
  clerkAuthAppearance,
  clerkUserProfileAppearance,
} from './clerkAppearance'

describe('clerkAppearance', () => {
  it('mantém alias clerkAppearance = auth flush (SignIn / cadastro transparente)', () => {
    expect(clerkAppearance).toBe(clerkAuthAppearance)
    expect(clerkAuthAppearance.options.elevation).toBe('flush')
    expect(clerkAuthAppearance.variables.colorBackground).toBe('transparent')
    expect(clerkAuthAppearance.elements.card).toBe('panel-clerk-card')
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
