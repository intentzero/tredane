/**
 * M-14 — Instalar PWA e ativar avisos de nova conversa (#42 / DEC-040).
 * Preferências extras (atribuída / falha / resposta) ficam Propostas (Q-UX-05).
 */
import { Share } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from 'react-aria-components'
import { useAuthSession } from '../auth/AuthContext'
import {
  detectInstallPlatform,
  getDeferredInstallPrompt,
  isPushSupported,
  isStandaloneDisplay,
  subscribePush,
  clearDeferredInstallPrompt,
} from '../pwa'
import { navigatePanel } from '../routes'

type Props = {
  tenantId: string
  clinicName: string
}

type Status =
  | { phase: 'idle' }
  | { phase: 'working' }
  | { phase: 'ok'; message: string }
  | { phase: 'denied'; message: string }
  | { phase: 'unsupported'; message: string }
  | { phase: 'error'; message: string }

export function AvisosScreen({ tenantId, clinicName }: Props) {
  const { api } = useAuthSession()
  const [notifyNew, setNotifyNew] = useState(true)
  const [status, setStatus] = useState<Status>({ phase: 'idle' })
  const [installed, setInstalled] = useState(isStandaloneDisplay())
  const platform = detectInstallPlatform()
  const pushOk = isPushSupported()

  useEffect(() => {
    const onChange = () => setInstalled(isStandaloneDisplay())
    window.matchMedia('(display-mode: standalone)').addEventListener('change', onChange)
    return () =>
      window
        .matchMedia('(display-mode: standalone)')
        .removeEventListener('change', onChange)
  }, [])

  const goBack = useCallback(() => {
    navigatePanel({
      kind: 'area',
      area: 'conversas',
      tenantId,
      section: 'lista',
    })
  }, [tenantId])

  const onInstallAndroid = useCallback(async () => {
    const prompt = getDeferredInstallPrompt()
    if (!prompt) {
      setStatus({
        phase: 'error',
        message:
          'No Chrome Android, use o menu do navegador → «Instalar aplicação» ou «Adicionar à tela inicial».',
      })
      return
    }
    await prompt.prompt()
    const choice = await prompt.userChoice
    clearDeferredInstallPrompt()
    if (choice.outcome === 'accepted') setInstalled(true)
  }, [])

  const onActivate = useCallback(async () => {
    if (!api) {
      setStatus({ phase: 'error', message: 'Sessão indisponível. Entre de novo.' })
      return
    }
    if (!pushOk) {
      setStatus({
        phase: 'unsupported',
        message:
          'Este navegador não suporta avisos push. O painel continua utilizável sem avisos.',
      })
      return
    }
    setStatus({ phase: 'working' })
    try {
      const vapid = await api.getPushVapidPublicKey()
      if (!vapid.supported || !vapid.publicKey) {
        setStatus({
          phase: 'unsupported',
          message: 'Avisos push ainda não estão configurados neste ambiente.',
        })
        return
      }
      const sub = await subscribePush(vapid.publicKey)
      if (!sub) {
        setStatus({
          phase: 'denied',
          message:
            'Permissão de avisos negada. O painel continua funcionando; você pode ativar depois nas configurações do celular.',
        })
        return
      }
      const json = sub.toJSON()
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        setStatus({ phase: 'error', message: 'Não foi possível ativar os avisos agora. Tente de novo.' })
        return
      }
      await api.subscribePush(tenantId, {
        subscription: {
          endpoint: json.endpoint,
          expirationTime: json.expirationTime ?? null,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        },
        notifyNewConversation: notifyNew,
      })
      setStatus({
        phase: 'ok',
        message: `Avisos ativos. Em nova conversa verá «Nova conversa na ${clinicName}» — sem o texto da mensagem.`,
      })
    } catch {
      setStatus({
        phase: 'error',
        message: 'Não foi possível ativar os avisos. Tente de novo com ligação estável.',
      })
    }
  }, [api, clinicName, notifyNew, pushOk, tenantId])

  return (
    <div className="panel-avisos" lang="pt-BR">
      <header className="panel-avisos-header">
        <Button className="panel-icon-btn" onPress={goBack} aria-label="Voltar">
          ←
        </Button>
        <h1 className="panel-title-md">Avisos no celular</h1>
      </header>

      <div className="panel-avisos-body">
        <section className="panel-card" aria-labelledby="inst-t">
          <h2 id="inst-t" className="panel-title-md">
            1. Instale o Tredane na tela inicial
          </h2>
          <p className="panel-muted">
            No iPhone, os avisos só funcionam com o app instalado. No Android, o
            navegador também oferece instalar.
          </p>
          {installed ? (
            <p className="panel-ok-text">App já aberto a partir da tela inicial.</p>
          ) : platform === 'ios' ? (
            <ol className="panel-avisos-steps">
              <li>
                <span className="panel-step-n">1</span>
                <span>
                  Toque em Compartilhar <Share size={18} aria-hidden="true" />
                </span>
              </li>
              <li>
                <span className="panel-step-n">2</span>
                <span>Escolha «Adicionar à Tela de Início»</span>
              </li>
              <li>
                <span className="panel-step-n">3</span>
                <span>Abra o Tredane pelo novo ícone</span>
              </li>
            </ol>
          ) : platform === 'android' ? (
            <div className="panel-avisos-android">
              <p className="panel-muted">
                No Chrome, toque em «Instalar» quando aparecer, ou use o menu do
                navegador.
              </p>
              <Button className="panel-btn-secondary" onPress={() => void onInstallAndroid()}>
                Instalar aplicação
              </Button>
            </div>
          ) : (
            <p className="panel-muted">
              Em computador, use o ícone de instalação do navegador (quando
              disponível) ou abra no celular da recepção.
            </p>
          )}
        </section>

        <section className="panel-card" aria-labelledby="av-t">
          <h2 id="av-t" className="panel-title-md">
            2. Quais avisos receber
          </h2>
          <label className="panel-switch-row">
            <span>
              <span className="panel-switch-label">Nova conversa</span>
              <span className="panel-muted-sm">
                Quando um contato escreve pela primeira vez
              </span>
            </span>
            <input
              type="checkbox"
              className="panel-checkbox"
              checked={notifyNew}
              onChange={(e) => setNotifyNew(e.target.checked)}
              aria-label="Nova conversa"
            />
          </label>
          <label className="panel-switch-row panel-switch-row--proposed">
            <span>
              <span className="panel-switch-label">Conversa atribuída a mim</span>
              <span className="panel-muted-sm">Em breve</span>
            </span>
            <input
              type="checkbox"
              className="panel-checkbox"
              checked
              disabled
              aria-label="Conversa atribuída (proposta)"
            />
          </label>
          <label className="panel-switch-row panel-switch-row--proposed">
            <span>
              <span className="panel-switch-label">Mensagem não enviada</span>
              <span className="panel-muted-sm">Em breve</span>
            </span>
            <input
              type="checkbox"
              className="panel-checkbox"
              checked
              disabled
              aria-label="Mensagem não enviada (proposta)"
            />
          </label>
          <label className="panel-switch-row panel-switch-row--proposed">
            <span>
              <span className="panel-switch-label">Resposta de contato</span>
              <span className="panel-muted-sm">Proposto (Q-UX-05) — desligado por omissão</span>
            </span>
            <input
              type="checkbox"
              className="panel-checkbox"
              checked={false}
              disabled
              aria-label="Resposta de contato (proposta)"
            />
          </label>
        </section>

        <p className="panel-card panel-muted-sm">
          O aviso mostra só «Nova conversa na {clinicName}». O texto da mensagem
          fica dentro do app.
        </p>

        {status.phase !== 'idle' && status.phase !== 'working' ? (
          <p
            className={
              status.phase === 'ok' ? 'panel-ok-text' : 'panel-warn-text'
            }
            role="status"
          >
            {status.message}
          </p>
        ) : null}
      </div>

      <footer className="panel-avisos-footer">
        <Button
          className="panel-btn-primary"
          onPress={() => void onActivate()}
          isDisabled={status.phase === 'working'}
        >
          {status.phase === 'working' ? 'A ativar…' : 'Ativar avisos'}
        </Button>
        <Button className="panel-btn-ghost" onPress={goBack}>
          Agora não
        </Button>
      </footer>
    </div>
  )
}
