import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writePendingInviteToken } from './session'

const signInProps: Array<Record<string, unknown>> = []
const signUpProps: Array<Record<string, unknown>> = []

vi.mock('@clerk/react', () => ({
  SignIn: (props: Record<string, unknown>) => {
    signInProps.push(props)
    return <div data-testid="clerk-sign-in" />
  },
  SignUp: (props: Record<string, unknown>) => {
    signUpProps.push(props)
    return <div data-testid="clerk-sign-up" />
  },
}))

vi.mock('../ui/Brand', () => ({
  BrandHorizontal: () => <div data-testid="brand" />,
}))

describe('ClerkLogin / ClerkSignUp — convite', () => {
  beforeEach(() => {
    sessionStorage.clear()
    signInProps.length = 0
    signUpProps.length = 0
  })

  afterEach(() => {
    cleanup()
  })

  it('sem convite: SignIn sem signUpUrl (não anuncia cadastro aberto)', async () => {
    const { ClerkLogin } = await import('./ClerkLogin')
    render(<ClerkLogin />)
    expect(screen.getByTestId('clerk-sign-in')).toBeTruthy()
    expect(signInProps[0]?.signUpUrl).toBeUndefined()
    expect(signInProps[0]?.forceRedirectUrl).toBe('/clinicas')
  })

  it('com convite: SignIn aponta signUpUrl para /cadastro e volta ao aceite', async () => {
    writePendingInviteToken('tok_teste_nao_logar')
    const { ClerkLogin } = await import('./ClerkLogin')
    render(<ClerkLogin />)
    expect(signInProps[0]?.signUpUrl).toBe('/cadastro')
    expect(signInProps[0]?.forceRedirectUrl).toBe('/invite/accept')
  })

  it('SignUp liga Entrar e, com convite, redireciona para o aceite', async () => {
    writePendingInviteToken('tok_teste_nao_logar')
    const { ClerkSignUp } = await import('./ClerkSignUp')
    render(<ClerkSignUp />)
    expect(screen.getByTestId('clerk-sign-up')).toBeTruthy()
    expect(signUpProps[0]?.path).toBe('/cadastro')
    expect(signUpProps[0]?.signInUrl).toBe('/entrar')
    expect(signUpProps[0]?.forceRedirectUrl).toBe('/invite/accept')
  })
})
