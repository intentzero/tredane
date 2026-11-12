import { SignUp, useAuth } from '@clerk/react'
import { useEffect, useRef, useState } from 'react'
import { BrandHorizontal } from '../ui/Brand'
import { readPendingInviteToken } from './session'
import { clerkAppearance } from './clerkAppearance'

/** Tempo após Clerk loaded antes de alertar — hydrate/captcha com Access Open pode demorar. */
export const SIGNUP_FORM_WAIT_MS = 8000

/**
 * Cadastro Clerk para convidadas sem conta (DEC-021 / JRN-13).
 * Só é a entrada por defeito quando há token de convite pendente;
 * quem já tem conta usa o link «Entrar» → `/entrar`.
 *
 * UX: cartão flush/transparente + marca fora do Clerk (cadastro transparente).
 * Não contorna Access mode Invite-only do Dashboard — ver f1-login-nav.md.
 * Se o SignUp pintar só cabeçalho/«Entrar» sem e-mail/OTP (Restricted),
 * mostramos um alerta legível sem desmontar o `<SignUp />` — hydrate tardio
 * ou «Tentar novamente» recuperam sem reload da página.
 */
export function ClerkSignUp() {
  const hasInvite = Boolean(readPendingInviteToken())
  const afterSignUp = hasInvite ? '/invite/accept' : '/clinicas'
  const { isLoaded } = useAuth()
  const clerkHostRef = useRef<HTMLDivElement>(null)
  const [formReady, setFormReady] = useState(false)
  const [formMissing, setFormMissing] = useState(false)
  const [mountKey, setMountKey] = useState(0)

  useEffect(() => {
    if (!isLoaded) return
    const host = clerkHostRef.current
    if (!host) return

    let cancelled = false
    const hasFormInput = () => Boolean(host.querySelector('input'))

    const markReady = () => {
      if (cancelled) return
      setFormReady(true)
      setFormMissing(false)
    }

    if (hasFormInput()) {
      markReady()
      return
    }

    const observer = new MutationObserver(() => {
      if (!hasFormInput()) return
      markReady()
      observer.disconnect()
    })
    observer.observe(host, { childList: true, subtree: true })

    // Restricted / falha de SignUp: título + Entrar sem campos.
    // Não desmontamos o SignUp no timeout — o observer continua a ver hydrate tardio.
    const timeout = window.setTimeout(() => {
      if (cancelled || hasFormInput()) return
      setFormMissing(true)
    }, SIGNUP_FORM_WAIT_MS)

    return () => {
      cancelled = true
      observer.disconnect()
      window.clearTimeout(timeout)
    }
  }, [isLoaded, mountKey])

  const retry = () => {
    setFormMissing(false)
    setFormReady(false)
    setMountKey((k) => k + 1)
  }

  return (
    <div className="panel-auth" lang="pt-BR">
      <div className="panel-auth-atmosphere" aria-hidden="true" />
      <div className="panel-auth-stack">
        <div className="panel-auth-hero">
          <div className="panel-auth-brand">
            <BrandHorizontal height={48} />
          </div>
          {/* Mantém-se até haver input real — título Restricted não deve esconder o lead. */}
          <div className="panel-auth-fallback" hidden={formReady || formMissing}>
            <h1 className="panel-auth-title">Criar conta</h1>
            {hasInvite ? (
              <p className="panel-auth-lead">
                Use o mesmo e-mail do convite. Depois você entra na clínica.
              </p>
            ) : null}
          </div>
        </div>
        {formMissing ? (
          <div className="panel-auth-copy" role="alert" data-testid="signup-form-missing">
            <h1 className="panel-auth-title">Cadastro indisponível</h1>
            <p>
              Não foi possível abrir o formulário de criar conta (e-mail e código).
              {hasInvite
                ? ' Se você recebeu um convite e ainda não tem conta, peça à responsável da clínica para liberar o cadastro e abra o link de novo.'
                : ' Peça ao responsável da sua clínica um convite.'}
            </p>
            <p>
              <button type="button" className="panel-auth-inline-link" onClick={retry}>
                Tentar novamente
              </button>
              {' · '}
              Já tem conta?{' '}
              <a className="panel-auth-inline-link" href="/entrar">
                Entrar
              </a>
            </p>
          </div>
        ) : null}
        {/* Mantém SignUp montado (só esconde) para hydrate/captcha tardio recuperar sem reload. */}
        <div
          className="panel-auth-clerk"
          ref={clerkHostRef}
          hidden={formMissing}
          aria-hidden={formMissing || undefined}
        >
          <SignUp
            key={mountKey}
            routing="path"
            path="/cadastro"
            forceRedirectUrl={afterSignUp}
            signInUrl="/entrar"
            appearance={clerkAppearance}
          />
        </div>
        {!formMissing ? (
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
        ) : null}
      </div>
    </div>
  )
}
