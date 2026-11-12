import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writePendingInviteToken } from './session'

const signInProps: Array<Record<string, unknown>> = []
let clerkLoaded = true
let fetchStatus: 'idle' | 'fetching' = 'idle'
let signUpStatus: string = 'missing_requirements'

const createMock = vi.fn(async () => ({ error: null as { code: string; message: string } | null }))
const sendEmailCodeMock = vi.fn(async () => ({ error: null as { code: string; message: string } | null }))
const verifyEmailCodeMock = vi.fn(async () => {
  signUpStatus = 'complete'
  return { error: null as { code: string; message: string } | null }
})
const finalizeMock = vi.fn(async (params?: { navigate?: (args: { decorateUrl: (u: string) => string }) => void }) => {
  params?.navigate?.({ decorateUrl: (u: string) => u })
  return { error: null as { code: string; message: string } | null }
})
const resetMock = vi.fn(async () => ({ error: null }))

const navigatePanel = vi.fn()

vi.mock('../routes', () => ({
  navigatePanel: (...args: unknown[]) => navigatePanel(...args),
}))

vi.mock('@clerk/react', () => ({
  SignIn: (props: Record<string, unknown>) => {
    signInProps.push(props)
    return <div data-testid="clerk-sign-in" />
  },
  useAuth: () => ({ isLoaded: clerkLoaded }),
  useSignUp: () => ({
    fetchStatus,
    errors: {
      fields: {
        firstName: null,
        lastName: null,
        emailAddress: null,
        phoneNumber: null,
        password: null,
        username: null,
        code: null,
        captcha: null,
        legalAccepted: null,
      },
      raw: null,
      global: null,
    },
    signUp: {
      get status() {
        return signUpStatus
      },
      create: createMock,
      verifications: {
        sendEmailCode: sendEmailCodeMock,
        verifyEmailCode: verifyEmailCodeMock,
      },
      finalize: finalizeMock,
      reset: resetMock,
    },
  }),
}))

vi.mock('../ui/Brand', () => ({
  BrandHorizontal: () => <div data-testid="brand" />,
}))

describe('ClerkLogin / ClerkSignUp — convite', () => {
  beforeEach(() => {
    sessionStorage.clear()
    signInProps.length = 0
    clerkLoaded = true
    fetchStatus = 'idle'
    signUpStatus = 'missing_requirements'
    createMock.mockClear()
    sendEmailCodeMock.mockClear()
    verifyEmailCodeMock.mockClear()
    finalizeMock.mockClear()
    resetMock.mockClear()
    navigatePanel.mockClear()
    createMock.mockResolvedValue({ error: null })
    sendEmailCodeMock.mockResolvedValue({ error: null })
    verifyEmailCodeMock.mockImplementation(async () => {
      signUpStatus = 'complete'
      return { error: null }
    })
    finalizeMock.mockImplementation(async (params?) => {
      params?.navigate?.({ decorateUrl: (u: string) => u })
      return { error: null }
    })
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

  it('SignUp mostra formulário Criar conta com e-mail (Legal Layer transparente)', async () => {
    writePendingInviteToken('tok_teste_nao_logar')
    const { ClerkSignUp } = await import('./ClerkSignUp')
    render(<ClerkSignUp />)
    expect(screen.getByTestId('signup-email-form')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Criar conta' })).toBeTruthy()
    expect(screen.getByLabelText('E-mail')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Entrar' }).getAttribute('href')).toBe('/entrar')
    expect(screen.queryByTestId('clerk-sign-up')).toBeNull()
  })

  it('aparência flush/transparente no SignIn (cadastro transparente no SignUp é form próprio)', async () => {
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
    expect(screen.getByRole('link', { name: 'Criar conta' }).getAttribute('href')).toBe(
      '/cadastro',
    )
    expect(screen.getByTestId('signup-email-form')).toBeTruthy()
  })

  it('SignUp: e-mail → código → finalize redireciona ao aceite do convite', async () => {
    writePendingInviteToken('tok_teste_nao_logar')
    const { ClerkSignUp } = await import('./ClerkSignUp')
    render(<ClerkSignUp />)

    fireEvent.change(screen.getByLabelText('E-mail'), {
      target: { value: 'nova@clinica.com.br' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith({ emailAddress: 'nova@clinica.com.br' })
      expect(sendEmailCodeMock).toHaveBeenCalled()
      expect(screen.getByTestId('signup-code-form')).toBeTruthy()
    })

    fireEvent.change(screen.getByLabelText('Código de 6 dígitos'), {
      target: { value: '123456' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))

    await waitFor(() => {
      expect(verifyEmailCodeMock).toHaveBeenCalledWith({ code: '123456' })
      expect(finalizeMock).toHaveBeenCalled()
      expect(navigatePanel).toHaveBeenCalledWith({ kind: 'invite-accept' }, true)
    })
  })

  it('SignUp Restricted: erro claro em vez de página vazia Criar sua conta', async () => {
    writePendingInviteToken('tok_teste_nao_logar')
    createMock.mockResolvedValueOnce({
      error: { code: 'sign_up_mode_restricted', message: 'Sign ups are disabled' },
    })
    const { ClerkSignUp } = await import('./ClerkSignUp')
    render(<ClerkSignUp />)

    fireEvent.change(screen.getByLabelText('E-mail'), {
      target: { value: 'nova@clinica.com.br' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    await waitFor(() => {
      expect(screen.getByTestId('signup-error').textContent).toMatch(/Cadastro indisponível/)
    })
    expect(screen.getByTestId('signup-email-form')).toBeTruthy()
    expect(screen.getByLabelText('E-mail')).toBeTruthy()
  })

  it('formatClerkError mapeia Restricted e e-mail existente', async () => {
    const { formatClerkError } = await import('./ClerkSignUp')
    expect(formatClerkError({ code: 'sign_up_mode_restricted' }, true)).toMatch(
      /Cadastro indisponível/,
    )
    expect(formatClerkError({ code: 'form_identifier_exists' })).toMatch(/já tem conta/)
  })

  it('SignUp: espera Clerk loaded antes do formulário', async () => {
    clerkLoaded = false
    writePendingInviteToken('tok_teste_nao_logar')
    const { ClerkSignUp } = await import('./ClerkSignUp')
    const { rerender } = render(<ClerkSignUp />)
    expect(screen.queryByTestId('signup-email-form')).toBeNull()
    expect(screen.getByText('Preparando cadastro…')).toBeTruthy()

    clerkLoaded = true
    rerender(<ClerkSignUp />)
    expect(screen.getByTestId('signup-email-form')).toBeTruthy()
  })
})
