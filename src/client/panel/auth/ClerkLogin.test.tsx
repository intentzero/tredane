import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writePendingInviteToken } from './session'

const signInProps: Array<Record<string, unknown>> = []
const signUpProps: Array<Record<string, unknown>> = []
let signUpHasInput = false

vi.mock('@clerk/react', () => ({
  SignIn: (props: Record<string, unknown>) => {
    signInProps.push(props)
    return <div data-testid="clerk-sign-in" />
  },
  SignUp: (props: Record<string, unknown>) => {
    signUpProps.push(props)
    return (
      <div data-testid="clerk-sign-up">
        {signUpHasInput ? <input aria-label="Endereço de e-mail" /> : null}
      </div>
    )
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
    signUpHasInput = false
    vi.useRealTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
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
    expect(screen.getByRole('link', { name: 'Entrar' }).getAttribute('href')).toBe('/entrar')
  })

  it('aparência flush/transparente no SignIn e SignUp (cadastro transparente)', async () => {
    const { clerkAppearance } = await import('./clerkAppearance')
    expect(clerkAppearance.options.elevation).toBe('flush')
    expect(clerkAppearance.options.logoPlacement).toBe('none')
    expect(clerkAppearance.variables.colorBackground).toBe('transparent')

    writePendingInviteToken('tok_teste_nao_logar')
    const { ClerkLogin } = await import('./ClerkLogin')
    const { ClerkSignUp } = await import('./ClerkSignUp')
    render(<ClerkLogin />)
    render(<ClerkSignUp />)
    expect(signInProps[0]?.appearance).toBe(clerkAppearance)
    expect(signUpProps[0]?.appearance).toBe(clerkAppearance)
    expect(screen.getByRole('link', { name: 'Criar conta' }).getAttribute('href')).toBe(
      '/cadastro',
    )
  })

  it('SignUp sem campos após timeout: alerta Cadastro indisponível (dead-end Restricted)', async () => {
    vi.useFakeTimers()
    writePendingInviteToken('tok_teste_nao_logar')
    const { ClerkSignUp } = await import('./ClerkSignUp')
    render(<ClerkSignUp />)
    expect(screen.getByTestId('clerk-sign-up')).toBeTruthy()
    expect(screen.queryByTestId('signup-form-missing')).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500)
    })
    expect(screen.getByTestId('signup-form-missing')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Cadastro indisponível' })).toBeTruthy()
    expect(screen.queryByTestId('clerk-sign-up')).toBeNull()
  })

  it('SignUp com input: não troca para alerta de indisponível', async () => {
    vi.useFakeTimers()
    signUpHasInput = true
    writePendingInviteToken('tok_teste_nao_logar')
    const { ClerkSignUp } = await import('./ClerkSignUp')
    render(<ClerkSignUp />)
    expect(screen.getByLabelText('Endereço de e-mail')).toBeTruthy()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500)
    })
    expect(screen.queryByTestId('signup-form-missing')).toBeNull()
    expect(screen.getByTestId('clerk-sign-up')).toBeTruthy()
  })
})
