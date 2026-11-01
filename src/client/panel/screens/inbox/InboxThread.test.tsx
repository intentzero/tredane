import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../../../ui/panel.css'
import type { InboxConversationDetail, InboxMessage, PanelApi } from '../../api'
import { InboxThread } from './InboxThread'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const NOW = Date.now()
const VIEWER = 'user_ficticio_dono'

function message(over: Partial<InboxMessage>): InboxMessage {
  return {
    id: 'msg_1',
    tenantId: 'clinic-demo-a',
    conversationId: 'cnv_ficticia',
    direction: 'inbound',
    body: 'Oi! Quanto custa a limpeza de pele?',
    externalMessageId: null,
    deliveryState: 'received',
    authorClerkUserId: null,
    authorDisplayName: null,
    createdAt: NOW,
    ...over,
  }
}

function detail(over: Partial<InboxConversationDetail> = {}): InboxConversationDetail {
  return {
    id: 'cnv_ficticia',
    tenantId: 'clinic-demo-a',
    contactId: 'ctc_ficticio',
    status: 'new',
    assigneeClerkUserId: null,
    assigneeDisplayName: null,
    assignmentVersion: 0,
    lastMessageAt: NOW,
    lastMessagePreview: 'Oi!',
    lastMessageDirection: 'inbound',
    unreadCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    contact: { id: 'ctc_ficticio', waId: '5511999000111', displayName: 'Marina Fictícia' },
    messages: [message({})],
    messagesHasMore: false,
    messagesNextBefore: null,
    messagingWindow: { open: true, lastInboundAt: NOW, closesAt: NOW + 3_600_000, remainingMs: 3_600_000 },
    ...over,
  } as unknown as InboxConversationDetail
}

function mockApi(d: InboxConversationDetail, extra: Partial<PanelApi> = {}): PanelApi {
  return {
    getInboxConversation: vi.fn(async () => d),
    listConversationPixCharges: vi.fn(async () => []),
    listPixPaymentAlerts: vi.fn(async () => []),
    listWhatsappTemplates: vi.fn(async () => ({ items: [] })),
    markInboxRead: vi.fn(async () => ({ conversation: d })),
    closeInboxConversation: vi.fn(async () => ({
      conversation: { ...d, status: 'closed' },
      systemMessage: message({ id: 'sys', direction: 'system', body: 'Conversa encerrada' }),
    })),
    ...extra,
  } as unknown as PanelApi
}

function renderThread(api: PanelApi) {
  return render(
    <InboxThread
      tenantId="clinic-demo-a"
      conversationId="cnv_ficticia"
      api={api}
      generation={1}
      viewerClerkUserId={VIEWER}
    />,
  )
}

describe('InboxThread — cabeçalho e Assumir', () => {
  it('sem responsável: mostra a faixa «Ninguém está atendendo» com Assumir', async () => {
    renderThread(mockApi(detail()))
    await screen.findByText('Ninguém está atendendo esta conversa.')
    expect(screen.getByRole('button', { name: 'Assumir' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Agendar horário' })).toBeTruthy()
  })

  it('já é minha: não mostra a faixa Assumir', async () => {
    renderThread(mockApi(detail({ status: 'open', assigneeClerkUserId: VIEWER })))
    await screen.findByText('Marina Fictícia')
    expect(screen.queryByRole('button', { name: 'Assumir' })).toBeNull()
  })

  it('de outra pessoa: diz quem está atendendo', async () => {
    renderThread(
      mockApi(detail({ status: 'open', assigneeClerkUserId: 'user_outro', assigneeDisplayName: 'Bruno' })),
    )
    await screen.findByText('Bruno está atendendo esta conversa.')
  })

  it('pausa da IA mostra Devolver à IA; Assumir não religa', async () => {
    const user = userEvent.setup()
    const resumeInboxAi = vi.fn(async () => ({ aiReplyPause: null }))
    const assignInboxConversation = vi.fn()
    renderThread(
      mockApi(detail({ aiReplyPause: { at: NOW, reason: 'customer_requested' } }), {
        resumeInboxAi,
        assignInboxConversation,
      }),
    )
    await screen.findByText('A IA está pausada. Uma pessoa continua esta conversa.')
    expect(screen.getByRole('button', { name: 'Assumir' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Devolver à IA' }))
    await waitFor(() => expect(resumeInboxAi).toHaveBeenCalledTimes(1))
    expect(assignInboxConversation).not.toHaveBeenCalled()
  })
})

describe('InboxThread — Encerrar fica no menu e pede confirmação', () => {
  it('não há botão Encerrar solto; o menu leva a uma confirmação que pode ser cancelada', async () => {
    const user = userEvent.setup()
    const api = mockApi(detail({ status: 'open', assigneeClerkUserId: VIEWER }))
    renderThread(api)
    await screen.findByText('Marina Fictícia')
    expect(screen.queryByRole('button', { name: 'Encerrar' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Mais opções da conversa' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Encerrar conversa' }))
    await screen.findByText('Encerrar esta conversa?')
    expect(api.closeInboxConversation).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByText('Encerrar esta conversa?')).toBeNull()
    expect(api.closeInboxConversation).not.toHaveBeenCalled()
  })

  it('confirmar encerra de verdade', async () => {
    const user = userEvent.setup()
    const api = mockApi(detail({ status: 'open', assigneeClerkUserId: VIEWER }))
    renderThread(api)
    await screen.findByText('Marina Fictícia')
    await user.click(screen.getByRole('button', { name: 'Mais opções da conversa' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Encerrar conversa' }))
    await user.click(await screen.findByRole('button', { name: 'Encerrar' }))
    await waitFor(() => expect(api.closeInboxConversation).toHaveBeenCalledTimes(1))
  })
})

describe('InboxThread — bolhas com estado de entrega', () => {
  it('mostra hora e estado dentro da bolha; falha tem «Tentar de novo»', async () => {
    renderThread(
      mockApi(
        detail({
          status: 'open',
          assigneeClerkUserId: VIEWER,
          messages: [
            message({ id: 'a', direction: 'outbound', body: 'Pode ser às 15h?', deliveryState: 'read' }),
            message({ id: 'b', direction: 'outbound', body: 'Segue o valor.', deliveryState: 'failed' }),
          ],
        }),
      ),
    )
    const sent = (await screen.findByText('Pode ser às 15h?')).closest('.inbox-msg-bubble') as HTMLElement
    expect(within(sent).getByText('Lida')).toBeTruthy()
    const failed = screen.getByText('Segue o valor.').closest('.inbox-msg-bubble') as HTMLElement
    expect(failed.className).toContain('inbox-msg-bubble--failed')
    expect(within(failed).getByText('Não enviada')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy()
  })

  it('mostra «Hoje» e a dica da janela de 24 h', async () => {
    renderThread(mockApi(detail({ status: 'open', assigneeClerkUserId: VIEWER })))
    await screen.findByText('Hoje')
    expect(screen.getByText(/Você pode responder livremente até/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeTruthy()
  })

  it('o compositor é texto livre: fora de senha, cartão e morada, sem popover nosso', async () => {
    const user = userEvent.setup()
    renderThread(mockApi(detail({ status: 'open', assigneeClerkUserId: VIEWER })))
    const box = (await screen.findByRole('textbox', { name: 'Mensagem' })) as HTMLTextAreaElement
    expect(box.tagName).toBe('TEXTAREA')
    expect(box.getAttribute('type')).toBeNull()
    expect(box.getAttribute('autocomplete')).toBe('organization-title')
    expect(box.getAttribute('autocomplete')).not.toMatch(/password|username|cc-|address|street|postal|email|tel|webauthn|^off$/i)
    expect(box.getAttribute('name')).toBe('mensagem')
    expect(box.getAttribute('inputmode')).toBe('text')
    expect(box.getAttribute('autocorrect')).toBe('on')
    expect(box.getAttribute('autocapitalize')).toBe('sentences')
    expect(box.getAttribute('spellcheck')).toBe('true')
    await user.click(box)
    await user.type(box, 'Oi')
    expect(box.value).toBe('Oi')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText(/Você pode responder livremente até/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeTruthy()
  })
})

describe('InboxThread — estado de envio', () => {
  it('mostra «Enviando…» na hora; se falhar fica «Não enviada» com Tentar de novo, que reenvia o mesmo texto', async () => {
    const user = userEvent.setup()
    const d = detail()
    let fail = true
    let release: (() => void) | null = null
    const sendInboxMessage = vi.fn(async (_t: string, _c: string, body: { body?: string }) => {
      await new Promise<void>((r) => {
        release = r
      })
      if (fail) throw new Error('network')
      return {
        conversation: d,
        duplicate: false,
        message: message({ id: 'msg_out', direction: 'outbound', body: body.body ?? '', deliveryState: 'accepted' }),
      }
    })
    renderThread(mockApi(d, { sendInboxMessage } as Partial<PanelApi>))
    const input = await screen.findByLabelText('Mensagem')
    await user.type(input, 'Temos horário amanhã às 10h')
    await user.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(await screen.findByText('Temos horário amanhã às 10h')).toBeTruthy()
    expect(screen.getByText('Enviando…')).toBeTruthy()
    expect((input as HTMLTextAreaElement).value).toBe('')
    release!()
    const retry = await screen.findByRole('button', { name: 'Tentar de novo' })
    expect(screen.getByText('Não enviada')).toBeTruthy()
    fail = false
    await user.click(retry)
    release!()
    await waitFor(() => expect(screen.getByText('Enviada')).toBeTruthy())
    expect(screen.queryByText('Não enviada')).toBeNull()
    expect(sendInboxMessage).toHaveBeenCalledTimes(2)
    expect(sendInboxMessage.mock.calls[1]![2]).toMatchObject({ body: 'Temos horário amanhã às 10h' })
    expect(screen.getAllByText('Temos horário amanhã às 10h')).toHaveLength(1)
  })

  it('«Sugerir resposta» e «Horários livres» são ícones dentro da barra do compositor', async () => {
    renderThread(mockApi(detail()))
    const btn = await screen.findByRole('button', { name: 'Sugerir resposta com IA' })
    const bar = btn.closest('form')
    expect(bar?.querySelector('textarea')).toBeTruthy()
    const slots = screen.getByRole('button', { name: 'Horários livres' })
    expect(slots.closest('form')).toBe(bar)
    expect(slots.getAttribute('aria-expanded')).toBe('false')
  })

  it('DEC-063: «Enviar» manda a sugestão da IA inteira em 1 toque, com a origem registrada', async () => {
    const suggestion = {
      id: 'ais_ficticia',
      conversationId: 'cnv_ficticia',
      kind: 'reply',
      status: 'ok',
      provider: 'teste',
      model: 'teste',
      suggestedText: 'Claro! Tenho 14h e 16h livres na sexta. Qual prefere?',
      warningCodes: [],
      warningLabels: [],
      sourceRefs: [],
      requestMeta: { latencyMs: 1, inputTokens: null, outputTokens: null, messageCount: 1, mode: 'test' },
      errorCode: null,
      createdAt: NOW,
      messageSent: false,
    }
    const suggestAiReply = vi.fn(async () => ({ suggestion, duplicate: false, messageSent: false }))
    const sendInboxMessage = vi.fn(async () => ({
      message: message({ id: 'out_1', direction: 'outbound', body: suggestion.suggestedText }),
      conversation: detail(),
    }))
    renderThread(mockApi(detail(), { suggestAiReply, sendInboxMessage } as unknown as Partial<PanelApi>))
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Sugerir resposta com IA' }))
    const region = await screen.findByRole('region', { name: 'Sugestão da IA' })
    expect(within(region).getByText(suggestion.suggestedText)).toBeTruthy()
    await user.click(within(region).getByRole('button', { name: 'Enviar' }))
    await waitFor(() => expect(sendInboxMessage).toHaveBeenCalledTimes(1))
    expect((sendInboxMessage.mock.calls[0] as unknown[])[2]).toMatchObject({
      body: suggestion.suggestedText,
      aiSuggestionId: 'ais_ficticia',
    })
    expect(within(region).queryByRole('button', { name: 'Usar e editar' })).toBeNull()
  })
})

describe('InboxThread — etapa só de leitura e um único Agendar (DEC-062, DEC-064)', () => {
  const opportunity = { id: 'opp_ficticia', stage: 'em_atendimento', label: 'Em atendimento', updatedAt: NOW }

  it('mostra a etapa como texto (sem seletor) e um só botão Agendar', async () => {
    renderThread(mockApi(detail({ opportunity })))
    // Cabeçalho único: a etapa é um selo junto do nome; o estado da conversa não repete.
    expect(await screen.findByText('Em atendimento', { selector: '.inbox-stage-chip' })).toBeTruthy()
    expect(screen.getAllByText('Em atendimento')).toHaveLength(1)
    expect(screen.queryByRole('combobox', { name: /etapa/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /alterar etapa/i })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Agendar horário' })).toHaveLength(1)
  })

  it('sem oportunidade mostra o estado da conversa; encerrada mostra o estado e esconde o Agendar', async () => {
    renderThread(mockApi(detail({ status: 'closed', opportunity })))
    expect(await screen.findByText('Encerrada')).toBeTruthy()
    expect(screen.queryByText('Em atendimento', { selector: '.inbox-stage-chip' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Agendar horário' })).toBeNull()
  })

  it('«Marcar como perdida» no ⋮ corrige a etapa sem tocar na agenda', async () => {
    const movePipelineStage = vi.fn(async () => ({ opportunity: {} }))
    renderThread(mockApi(detail({ opportunity }), { movePipelineStage } as unknown as Partial<PanelApi>))
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Mais opções da conversa' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Marcar como perdida' }))
    await waitFor(() => expect(movePipelineStage).toHaveBeenCalledTimes(1))
    const call = movePipelineStage.mock.calls[0] as unknown[]
    expect(call[0]).toBe('clinic-demo-a')
    expect(call[1]).toBe('opp_ficticia')
    expect(call[2]).toMatchObject({ toStage: 'perdido', expectedUpdatedAt: NOW })
  })

  it('não oferece a correção que já é a etapa atual', async () => {
    renderThread(
      mockApi(detail({ opportunity: { ...opportunity, stage: 'horario_proposto', label: 'Horário proposto' } })),
    )
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Mais opções da conversa' }))
    expect(await screen.findByRole('menuitem', { name: 'Marcar como perdida' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /Horário proposto/ })).toBeNull()
  })
})

describe('InboxThread — Pix pendente em faixa compacta (DEC-065)', () => {
  const charge = {
    id: 'pix_ficticio',
    amountCents: 8000,
    status: 'awaiting_payment',
    expiresAt: NOW + 3_600_000,
    pixCopyPaste: '00020126FICTICIO',
    whatsappSendError: null,
  }

  it('mostra uma faixa; «Detalhes» abre a folha e «Cancelar cobrança» cancela', async () => {
    const cancelPixCharge = vi.fn(async () => ({}))
    renderThread(
      mockApi(detail(), {
        listConversationPixCharges: vi.fn(async () => [charge]),
        cancelPixCharge,
      } as unknown as Partial<PanelApi>),
    )
    const user = userEvent.setup()
    expect(await screen.findByText(/Aguardando Pix/)).toBeTruthy()
    expect(screen.getByText('Horário ainda não reservado')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cancelar cobrança' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Detalhes' }))
    expect(await screen.findByText('R$ 80,00')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Cancelar cobrança' }))
    await waitFor(() => expect(cancelPixCharge).toHaveBeenCalledTimes(1))
    expect((cancelPixCharge.mock.calls[0] as unknown[])[1]).toBe('pix_ficticio')
  })

  it('sem cobrança pendente não mostra a faixa', async () => {
    renderThread(mockApi(detail()))
    await screen.findByRole('button', { name: 'Mais opções da conversa' })
    expect(screen.queryByText(/Aguardando Pix/)).toBeNull()
  })
})

describe('InboxThread — painel do contato (desktop)', () => {
  it('sem painel, o nome abre a página do contato; com painel, «Contato» e o nome alternam o painel', async () => {
    const onToggle = vi.fn()
    render(
      <InboxThread
        tenantId="clinic-demo-a"
        conversationId="cnv_ficticia"
        api={mockApi(detail())}
        generation={1}
        viewerClerkUserId={VIEWER}
        contactPanel={{ open: false, controlsId: 'conversas-contact-panel', onToggle }}
      />,
    )
    const toggle = await screen.findByRole('button', { name: 'Contato' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(toggle.getAttribute('aria-controls')).toBe('conversas-contact-panel')
    const user = userEvent.setup()
    await user.click(toggle)
    await user.click(screen.getByRole('button', { name: /Informações de/ }))
    expect(onToggle).toHaveBeenCalledTimes(2)
  })

  it('sem contactPanel (celular) não há botão «Contato»', async () => {
    renderThread(mockApi(detail()))
    await screen.findByRole('button', { name: 'Agendar horário' })
    expect(screen.queryByRole('button', { name: 'Contato' })).toBeNull()
  })
})
