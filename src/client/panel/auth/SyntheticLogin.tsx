import { useState } from 'react'
import {
  Button,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  TextField,
} from 'react-aria-components'
import { navigatePanel } from '../routes'
import { SYNTH_PERSONAS } from './session'
import { useAuthSession } from './AuthContext'
import { BrandHorizontal } from '../ui/Brand'

/**
 * Login local quando AUTH_MODE=synthetic.
 * Visual alinhado a M-09; personas fictícias — nunca dados reais.
 * Em AUTH_MODE=clerk o componente Clerk substitui esta tela.
 */
export function SyntheticLogin() {
  const { signInSynthetic } = useAuthSession()
  const [step, setStep] = useState<'email' | 'code' | 'persona'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  function continueFromEmail() {
    if (!email.trim()) return
    setStep('code')
  }

  function continueFromCode() {
    // Em synthetic o código não é verificado — só avança ao seletor de persona.
    if (code.trim().length < 4) return
    setStep('persona')
  }

  function choosePersona(clerkUserId: string) {
    setBusy(true)
    signInSynthetic(clerkUserId)
    navigatePanel({ kind: 'clinicas' }, true)
  }

  return (
    <div className="panel-auth" lang="pt-BR">
      <div className="panel-auth-atmosphere" aria-hidden="true" />
      <div className="panel-auth-stack">
        <div className="panel-auth-brand">
          <BrandHorizontal height={48} />
        </div>

        {step === 'email' ? (
          <form
            className="panel-auth-form"
            onSubmit={(e) => {
              e.preventDefault()
              continueFromEmail()
            }}
          >
            <div className="panel-auth-copy">
              <h1 className="panel-auth-title">Entrar</h1>
              <p>
                Use o e-mail do seu convite. Em desenvolvimento local (
                <code>AUTH_MODE=synthetic</code>) o código não é verificado pela Meta/Clerk.
              </p>
            </div>
            <TextField
              className="panel-field"
              value={email}
              onChange={setEmail}
              type="email"
              isRequired
              autoComplete="email"
            >
              <Label>E-mail</Label>
              <Input className="panel-control" placeholder="nome@clinica.com.br" />
            </TextField>
            <Button type="submit" className="panel-btn-primary">
              Continuar
            </Button>
          </form>
        ) : null}

        {step === 'code' ? (
          <form
            className="panel-auth-form"
            onSubmit={(e) => {
              e.preventDefault()
              continueFromCode()
            }}
          >
            <div className="panel-auth-copy">
              <h1 className="panel-auth-title">Digite o código</h1>
              <p>
                Em produção o Clerk envia um código de 6 dígitos. Aqui qualquer código com 4+
                dígitos avança para escolher uma persona sintética.
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
            >
              <Label>Código de 6 dígitos</Label>
              <Input className="panel-control panel-otp" placeholder="000000" />
            </TextField>
            <Button type="submit" className="panel-btn-primary">
              Entrar
            </Button>
            <Button
              className="panel-link-btn"
              onPress={() => {
                setStep('email')
                setCode('')
              }}
            >
              Usar outro e-mail
            </Button>
          </form>
        ) : null}

        {step === 'persona' ? (
          <div className="panel-auth-form">
            <div className="panel-auth-copy">
              <h1 className="panel-auth-title">Persona de desenvolvimento</h1>
              <p>Escolha um usuário sintético da seed. Login não concede membership.</p>
            </div>
            <ListBox
              aria-label="Personas sintéticas"
              className="panel-persona-list"
              selectionMode="single"
              onAction={(key) => {
                if (busy) return
                choosePersona(String(key))
              }}
            >
              {SYNTH_PERSONAS.map((p) => (
                <ListBoxItem
                  key={p.clerkUserId}
                  id={p.clerkUserId}
                  className="panel-persona-item"
                  textValue={p.label}
                >
                  <span className="panel-persona-label">{p.label}</span>
                  <span className="panel-persona-detail">{p.detail}</span>
                </ListBoxItem>
              ))}
            </ListBox>
          </div>
        ) : null}

        <p className="panel-auth-foot">Sem convite? Peça ao responsável da sua clínica.</p>
      </div>
    </div>
  )
}
