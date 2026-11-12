import { useAuth, useSignUp } from '@clerk/react'
import { useEffect, useState } from 'react'
import { Button, Input, Label, TextField } from 'react-aria-components'
import { BrandHorizontal } from '../ui/Brand'
import { navigatePanel, type PanelRoute } from '../routes'
import { readPendingInviteToken } from './session'

type Step = 'email' | 'code'

type ClerkLikeError = {
  code?: string
  message?: string
  longMessage?: string
}

/**
 * Cadastro para convidadas sem conta (DEC-021 / JRN-13).
 * Formulário próprio (React Aria) + `useSignUp` — UX Legal Layer transparente:
 * marca Tredane, título «Criar conta», e-mail e código; sem cartão Clerk vazio
 * «Criar sua conta / Entrar». Quem já tem conta usa «Entrar» → `/entrar`.
 *
 * Access mode Open no Dashboard continua obrigatório (TR-523): Restricted
 * falha no `create`/`sendEmailCode` e mostramos erro claro — o produto não
 * contorna Invite-only (convites D1, ADR-0008).
 *
 * Após OTP, `signUp.finalize({ navigate })` corre o callback *antes* da sessão
 * ficar ativa. Navegar já para `/invite/accept` faz o PanelRouter tratar a rota
 * como pendente e voltar a `/cadastro` (bounce). Guardamos o destino e só
 * navegamos quando `isSignedIn` for true.
 */
export function ClerkSignUp() {
  const hasInvite = Boolean(readPendingInviteToken())
  const afterSignUp: PanelRoute = hasInvite
    ? { kind: 'invite-accept' }
    : { kind: 'clinicas' }
  const { isLoaded, isSignedIn } = useAuth()
  const { signUp, errors, fetchStatus } = useSignUp()

  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  /** Destino pós-finalize; só aplica depois da sessão Clerk estar ativa. */
  const [pendingRoute, setPendingRoute] = useState<PanelRoute | null>(null)

  useEffect(() => {
    if (!pendingRoute || !isSignedIn) return
    navigatePanel(pendingRoute, true)
    setPendingRoute(null)
  }, [pendingRoute, isSignedIn])

  const busy = fetchStatus === 'fetching'
  const fieldError =
    step === 'email'
      ? errors.fields.emailAddress?.message ?? null
      : errors.fields.code?.message ?? null
  const globalError = errors.global?.[0]
    ? formatClerkError(errors.global[0] as ClerkLikeError)
    : null
  const displayError = localError ?? fieldError ?? globalError

  async function continueFromEmail() {
    if (!email.trim() || busy) return
    setLocalError(null)
    const created = await signUp.create({ emailAddress: email.trim() })
    if (created.error) {
      setLocalError(formatClerkError(created.error as ClerkLikeError, hasInvite))
      return
    }
    const sent = await signUp.verifications.sendEmailCode()
    if (sent.error) {
      setLocalError(formatClerkError(sent.error as ClerkLikeError, hasInvite))
      return
    }
    setStep('code')
    setCode('')
  }

  async function continueFromCode() {
    if (code.trim().length < 4 || busy) return
    setLocalError(null)
    const verified = await signUp.verifications.verifyEmailCode({ code: code.trim() })
    if (verified.error) {
      setLocalError(formatClerkError(verified.error as ClerkLikeError, hasInvite))
      return
    }
    if (signUp.status !== 'complete') {
      setLocalError(
        'Não foi possível concluir o cadastro. Confira o código ou peça um novo.',
      )
      return
    }
    const finalized = await signUp.finalize({
      navigate: ({ decorateUrl }) => {
        const dest = hasInvite ? '/invite/accept' : '/clinicas'
        const url = decorateUrl(dest)
        // Safari ITP: decorateUrl pode devolver URL externa — full navigation.
        if (url.startsWith('http')) {
          window.location.href = url
          return
        }
        // Sessão ainda não está activa neste instante (Clerk Core 3).
        // Adia o SPA navigate até `isSignedIn` (efeito acima).
        setPendingRoute(afterSignUp)
      },
    })
    if (finalized.error) {
      setLocalError(formatClerkError(finalized.error as ClerkLikeError, hasInvite))
    }
  }

  async function resendCode() {
    if (busy) return
    setLocalError(null)
    const sent = await signUp.verifications.sendEmailCode()
    if (sent.error) {
      setLocalError(formatClerkError(sent.error as ClerkLikeError, hasInvite))
    }
  }

  if (!isLoaded) {
    return (
      <div className="panel-auth" lang="pt-BR">
        <div className="panel-auth-atmosphere" aria-hidden="true" />
        <div className="panel-auth-stack">
          <div className="panel-auth-hero">
            <div className="panel-auth-brand">
              <BrandHorizontal height={48} />
            </div>
          </div>
          <p className="panel-auth-lead">Preparando cadastro…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="panel-auth" lang="pt-BR">
      <div className="panel-auth-atmosphere" aria-hidden="true" />
      <div className="panel-auth-stack">
        <div className="panel-auth-hero">
          <div className="panel-auth-brand">
            <BrandHorizontal height={48} />
          </div>
        </div>

        {step === 'email' ? (
          <form
            className="panel-auth-form"
            data-testid="signup-email-form"
            onSubmit={(e) => {
              e.preventDefault()
              void continueFromEmail()
            }}
          >
            <div className="panel-auth-copy">
              <h1 className="panel-auth-title">Criar conta</h1>
              <p>
                {hasInvite
                  ? 'Use o mesmo e-mail do convite. Depois você entra na clínica.'
                  : 'Cadastro aberto só com convite da clínica.'}
              </p>
            </div>
            <TextField
              className="panel-field"
              value={email}
              onChange={setEmail}
              type="email"
              isRequired
              autoComplete="email"
              isDisabled={busy}
            >
              <Label>E-mail</Label>
              <Input
                className="panel-control"
                placeholder="nome@clinica.com.br"
                aria-label="E-mail"
              />
            </TextField>
            {/* Captcha Clerk (bot protection) — elemento exigido em custom flows. */}
            <div id="clerk-captcha" />
            {displayError ? (
              <p className="panel-auth-error" role="alert" data-testid="signup-error">
                {displayError}
              </p>
            ) : null}
            <Button type="submit" className="panel-btn-primary" isDisabled={busy || !email.trim()}>
              Continuar
            </Button>
          </form>
        ) : null}

        {step === 'code' ? (
          <form
            className="panel-auth-form"
            data-testid="signup-code-form"
            onSubmit={(e) => {
              e.preventDefault()
              void continueFromCode()
            }}
          >
            <div className="panel-auth-copy">
              <h1 className="panel-auth-title">Digite o código</h1>
              <p>
                Enviamos um código de 6 dígitos para <strong>{email}</strong>.
              </p>
            </div>
            <TextField
              className="panel-field"
              value={code}
              onChange={setCode}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              isRequired
              isDisabled={busy}
            >
              <Label>Código de 6 dígitos</Label>
              <Input
                className="panel-control panel-otp"
                placeholder="000000"
                aria-label="Código de 6 dígitos"
              />
            </TextField>
            {displayError ? (
              <p className="panel-auth-error" role="alert" data-testid="signup-error">
                {displayError}
              </p>
            ) : null}
            <Button
              type="submit"
              className="panel-btn-primary"
              isDisabled={busy || code.trim().length < 4}
            >
              Criar conta
            </Button>
            <Button
              className="panel-link-btn"
              isDisabled={busy}
              onPress={() => {
                void resendCode()
              }}
            >
              Reenviar código
            </Button>
            <Button
              className="panel-link-btn"
              isDisabled={busy}
              onPress={() => {
                setStep('email')
                setCode('')
                setLocalError(null)
                void signUp.reset()
              }}
            >
              Usar outro e-mail
            </Button>
          </form>
        ) : null}

        <p className="panel-auth-foot panel-auth-note">
          {hasInvite ? (
            <>
              <span className="panel-auth-note-lead">Já tem conta?</span>
              <a className="panel-auth-inline-link" href="/entrar">
                Entrar
              </a>{' '}
              com o e-mail do convite.
            </>
          ) : (
            <>
              <span className="panel-auth-note-lead">Sem convite?</span>
              Peça ao responsável da sua clínica. Cadastro aberto só com convite.
            </>
          )}
        </p>
      </div>
    </div>
  )
}

/** Mensagens PT-BR estáveis a partir do `code` Clerk; Restricted ≠ silêncio. */
export function formatClerkError(err: ClerkLikeError, hasInvite = false): string {
  const code = (err.code ?? '').toLowerCase()
  if (
    code.includes('sign_up_mode') ||
    code.includes('signups_disabled') ||
    code.includes('restricted') ||
    code.includes('not_allowed_to_sign_up')
  ) {
    return hasInvite
      ? 'Cadastro indisponível neste momento. Peça à responsável da clínica para liberar o Access mode Open e abra o link de convite de novo.'
      : 'Cadastro indisponível neste momento. Peça ao responsável da sua clínica um convite.'
  }
  if (
    code.includes('form_identifier_exists') ||
    code.includes('identifier_exists') ||
    code.includes('email_address_exists')
  ) {
    return 'Este e-mail já tem conta. Use Entrar com o e-mail do convite.'
  }
  if (code.includes('form_code') || code.includes('incorrect') || code.includes('invalid_code')) {
    return 'Código inválido ou expirado. Confira o e-mail ou peça um novo.'
  }
  return err.longMessage || err.message || 'Não foi possível continuar o cadastro. Tente de novo.'
}
