import { SignUp } from '@clerk/react'
import { BrandHorizontal } from '../ui/Brand'
import { readPendingInviteToken } from './session'
import { clerkAppearance } from './clerkAppearance'

/**
 * Cadastro Clerk para convidadas sem conta (DEC-021 / JRN-13).
 * Só é a entrada por defeito quando há token de convite pendente;
 * quem já tem conta usa o link «Entrar» → `/entrar`.
 */
export function ClerkSignUp() {
  const afterSignUp = readPendingInviteToken() ? '/invite/accept' : '/clinicas'
  return (
    <div className="panel-auth" lang="pt-BR">
      <div className="panel-auth-atmosphere" aria-hidden="true" />
      <div className="panel-auth-stack">
        <div className="panel-auth-hero">
          <div className="panel-auth-brand">
            <BrandHorizontal height={48} />
          </div>
          <div className="panel-auth-fallback">
            <h1 className="panel-auth-title">Criar conta</h1>
          </div>
        </div>
        <div className="panel-auth-clerk">
          <SignUp
            routing="path"
            path="/cadastro"
            forceRedirectUrl={afterSignUp}
            signInUrl="/entrar"
            appearance={clerkAppearance}
          />
        </div>
        <p className="panel-auth-foot panel-auth-note">
          <span className="panel-auth-note-lead">Já tem conta?</span>
          Use Entrar com o e-mail do convite.
        </p>
      </div>
    </div>
  )
}
