import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writePendingInviteToken } from './session'
import { SIGNUP_FORM_WAIT_MS } from './ClerkSignUp'

const signInProps: Array<Record<string, unknown>> = []
const signUpProps: Array<Record<string, unknown>> = []
let signUpHasInput = false
let clerkLoaded = true

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
  useAuth: () => ({ isLoaded: clerkLoaded }),
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
    clerkLoaded = true
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
      await vi.advanceTimersByTimeAsync(SIGNUP_FORM_WAIT_MS)
    })
    expect(screen.getByTestId('signup-form-missing')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Cadastro indisponível' })).toBeTruthy()
    // SignUp stays mounted (hidden) so late hydrate can recover without reload.
    expect(screen.getByTestId('clerk-sign-up')).toBeTruthy()
    expect(screen.getByTestId('clerk-sign-up').closest('.panel-auth-clerk')?.hasAttribute('hidden')).toBe(
      true,
    )
  })

  it('SignUp com input: não troca para alerta de indisponível', async () => {
    vi.useFakeTimers()
    signUpHasInput = true
    writePendingInviteToken('tok_teste_nao_logar')
    const { ClerkSignUp } = await import('./ClerkSignUp')
    render(<ClerkSignUp />)
    expect(screen.getByLabelText('Endereço de e-mail')).toBeTruthy()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SIGNUP_FORM_WAIT_MS)
    })
    expect(screen.queryByTestId('signup-form-missing')).toBeNull()
    expect(screen.getByTestId('clerk-sign-up')).toBeTruthy()
  })

  it('SignUp: hydrate tardio após timeout remove o alerta sem reload', async () => {
    vi.useFakeTimers()
    writePendingInviteToken('tok_teste_nao_logar')
    const { ClerkSignUp } = await import('./ClerkSignUp')
    render(<ClerkSignUp />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SIGNUP_FORM_WAIT_MS)
    })
    expect(screen.getByTestId('signup-form-missing')).toBeTruthy()

    const host = screen.getByTestId('clerk-sign-up')
    await act(async () => {
      const input = document.createElement('input')
      input.setAttribute('aria-label', 'Endereço de e-mail')
      host.appendChild(input)
    })

    expect(screen.queryByTestId('signup-form-missing')).toBeNull()
    expect(screen.getByTestId('clerk-sign-up').closest('.panel-auth-clerk')?.hasAttribute('hidden')).toBe(
      false,
    )
  })

  it('SignUp: Tentar novamente remonta o formulário sem reload', async () => {
    vi.useFakeTimers()
    writePendingInviteToken('tok_teste_nao_logar')
    const { ClerkSignUp } = await import('./ClerkSignUp')
    render(<ClerkSignUp />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SIGNUP_FORM_WAIT_MS)
    })
    expect(screen.getByTestId('signup-form-missing')).toBeTruthy()
    const mountsBefore = signUpProps.length

    signUpHasInput = true
    await act(async () => {
      screen.getByRole('button', { name: 'Tentar novamente' }).click()
    })

    expect(screen.queryByTestId('signup-form-missing')).toBeNull()
    expect(signUpProps.length).toBeGreaterThan(mountsBefore)
    expect(screen.getByLabelText('Endereço de e-mail')).toBeTruthy()
  })

  it('SignUp: timeout só começa depois de Clerk loaded', async () => {
    vi.useFakeTimers()
    clerkLoaded = false
    writePendingInviteToken('tok_teste_nao_logar')
    const { ClerkSignUp } = await import('./ClerkSignUp')
    const { rerender } = render(<ClerkSignUp />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SIGNUP_FORM_WAIT_MS)
    })
    expect(screen.queryByTestId('signup-form-missing')).toBeNull()

    clerkLoaded = true
    rerender(<ClerkSignUp />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SIGNUP_FORM_WAIT_MS - 1)
    })
    expect(screen.queryByTestId('signup-form-missing')).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(screen.getByTestId('signup-form-missing')).toBeTruthy()
  })
})
