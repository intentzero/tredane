import { SignIn } from '@clerk/react'
import { BrandHorizontal } from '../ui/Brand'
import { readPendingInviteToken } from './session'
import { clerkAuthAppearance } from './clerkAppearance'

/**
 * Componente Clerk real (TEL-08 / M-09).
 * Dashboard: método e-mail + código (sem Organizations, sem MFA no MVP).
 * Layout Confirmado Paulo 31/10/2026: bloco centrado + fundo surface.app.
 * Cadastro transparente: mesma aparência flush do SignUp.
 *
 * `signUpUrl` só aponta para `/cadastro` com convite pendente (DEC-021):
 * sem isso o SignIn ficava em loop em si mesmo e bloqueava conta nova
 * («Não foi possível encontrar o usuário»).
 */
export function ClerkLogin() {
  const hasInvite = Boolean(readPendingInviteToken())
  const afterLogin = hasInvite ? '/invite/accept' : '/clinicas'
  return (
    <div className="panel-auth" lang="pt-BR">
      <div className="panel-auth-atmosphere" aria-hidden="true" />
      <div className="panel-auth-stack">
        <div className="panel-auth-hero">
          <div className="panel-auth-brand">
            <BrandHorizontal height={48} />
          </div>
          {/* O Clerk traz o próprio título quando o cartão pinta. Até lá, «Entrar» (M-09) segura a nota. */}
          <div className="panel-auth-fallback">
            <h1 className="panel-auth-title">Entrar</h1>
            {hasInvite ? (
              <p className="panel-auth-lead">
                Conta nova? Crie com o e-mail do convite.
              </p>
            ) : null}
          </div>
        </div>
        <div className="panel-auth-clerk">
          <SignIn
            routing="path"
            path="/entrar"
            forceRedirectUrl={afterLogin}
            {...(hasInvite ? { signUpUrl: '/cadastro' } : {})}
            appearance={clerkAuthAppearance}
          />
        </div>
        <p className="panel-auth-foot panel-auth-note">
          {hasInvite ? (
            <>
              <span className="panel-auth-note-lead">Primeira vez?</span>
              <a className="panel-auth-inline-link" href="/cadastro">
                Criar conta
              </a>{' '}
              com o e-mail do convite.
            </>
          ) : (
            <>
              <span className="panel-auth-note-lead">Sem convite?</span>
              Peça ao responsável da sua clínica.
            </>
          )}
        </p>
      </div>
    </div>
  )
}
