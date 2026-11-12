import { Check, MessageCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from 'react-aria-components'
import type { PanelApi, WhatsappConnection } from '../../api'
import { navigatePanel } from '../../routes'

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
}

/**
 * DEC-162 (M-67): lista vazia sem busca nem filtros, com o estado do WhatsApp
 * e um passo de teste. Sem acesso à conexão (atendente), mostra só o texto.
 */
export function InboxEmptyStart({ tenantId, api, generation }: Props) {
  const [conn, setConn] = useState<WhatsappConnection | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true
    setConn(null)
    api
      .getWhatsappConnection(tenantId, { generation, expectGeneration: () => generation })
      .then((c) => {
        if (alive) setConn(c)
      })
      .catch(() => {
        // Atendente não lê a conexão (DEC-042); a tela continua útil sem o cartão.
      })
    return () => {
      alive = false
    }
  }, [api, tenantId, generation])

  const connected = conn?.status === 'connected'
  const phone = conn?.displayPhone ?? null

  function openConnection() {
    navigatePanel({ kind: 'area', area: 'clinica', tenantId, section: 'whatsapp' })
  }

  async function copyPhone() {
    if (!phone) return
    try {
      await navigator.clipboard.writeText(phone)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="inbox-empty-start">
      <div className="panel-status" role="status">
        <div className="panel-status-icon panel-status-icon--empty" aria-hidden="true">
          <MessageCircle size={28} strokeWidth={2} />
        </div>
        <h2 className="panel-title">Nenhuma conversa ainda</h2>
        <p className="panel-status-desc">
          Quando uma cliente mandar mensagem para o WhatsApp da clínica, ela aparece aqui na hora.
        </p>
      </div>

      {conn ? (
        <section className="inbox-empty-steps" aria-label="Para receber a primeira conversa">
          <div className="inbox-empty-step">
            <span
              className={`inbox-empty-step-mark${connected ? ' inbox-empty-step-mark--done' : ''}`}
              aria-hidden="true"
            >
              {connected ? <Check size={16} strokeWidth={2.5} /> : '1'}
            </span>
            <span className="inbox-empty-step-text">
              <span className="inbox-empty-step-title">
                {connected ? 'WhatsApp conectado' : 'Conecte o WhatsApp da clínica'}
              </span>
              {phone ? <span className="inbox-empty-step-desc">{phone}</span> : null}
            </span>
            <Button className="panel-link-btn" onPress={openConnection}>
              {connected ? 'Ver conexão' : 'Conectar'}
            </Button>
          </div>
          {connected ? (
            <div className="inbox-empty-step">
              <span className="inbox-empty-step-mark" aria-hidden="true">
                2
              </span>
              <span className="inbox-empty-step-text">
                <span className="inbox-empty-step-title">Faça um teste</span>
                <span className="inbox-empty-step-desc">
                  De outro celular, mande «oi» para o número da clínica. A conversa aparece nesta
                  tela sem recarregar.
                </span>
              </span>
            </div>
          ) : null}
        </section>
      ) : null}

      {connected && phone ? (
        <Button className="panel-btn-secondary inbox-empty-copy" onPress={() => void copyPhone()}>
          {copied ? 'Número copiado' : 'Copiar número da clínica'}
        </Button>
      ) : null}
    </div>
  )
}
