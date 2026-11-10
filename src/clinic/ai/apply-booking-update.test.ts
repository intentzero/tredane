/**
 * Aceite das #575–#578 e da excepção «hora já casada» (#579) contra o actualizador.
 * Os testes de funil em booking-freetext-miss.test.ts continuam a cobrir a integração.
 */
import { describe, expect, it } from 'vitest'
import {
  applyBookingUpdate,
  isStaleFlowVersusChat,
  type BookingUpdateIntent,
} from './apply-booking-update'
import type { BookingFrame } from './schedule-session'

function frame(partial: Partial<BookingFrame> = {}): BookingFrame {
  return {
    phase: 'coletando',
    serviceId: 'svc_dep',
    line: 'masculino',
    variantIds: ['z_ax', 'z_pe', 'z_to'],
    professionalPref: null,
    date: '2026-11-06',
    period: null,
    time: null,
    pending: { slot: 'horario', options: [], messageId: 'msg_offer' },
    lastOffer: null,
    proposal: null,
    rescheduleAppointmentId: null,
    catalogVersion: 'v1',
    provenance: {},
    updatedAt: 0,
    ...partial,
  }
}

const evidence = { source: 'text' as const, sourceMessageId: 'msg_1' }

function admit(
  intent: Omit<Extract<BookingUpdateIntent, { type: 'admit_variants' }>, 'type'> & {
    type?: 'admit_variants'
  },
  current: BookingFrame | null = frame(),
) {
  return applyBookingUpdate({
    frame: current,
    evidence,
    serviceId: 'svc_dep',
    intent: { type: 'admit_variants', ...intent },
  })
}

describe('applyBookingUpdate — #575 partícula/hora ≠ zona; sobra não apaga', () => {
  it('hora e partícula sem menção de zona preservam o conjunto', () => {
    const r = admit({
      mentionedIds: [],
      unrecognized: false,
      leftover: null,
      ambiguous: false,
      selectionMode: 'varias',
      priorVariantIds: ['z_ax', 'z_pe', 'z_to'],
      timeAlreadyBound: false,
    })
    expect(r.reason).toBe('variants_preserved')
    expect(r.blockProposal).toBe(false)
    // Patch vazio: não reescreve nem carimba source (preserva provenance flow).
    expect(r.patch).toEqual({})
    expect(r.resolvedVariantIds).toEqual(['z_ax', 'z_pe', 'z_to'])
  })

  it('zona desconhecida pergunta (block) e não limpa variantIds', () => {
    const r = admit({
      mentionedIds: [],
      unrecognized: true,
      leftover: 'cotovelo',
      ambiguous: false,
      selectionMode: 'varias',
      priorVariantIds: ['z_ax', 'z_pe', 'z_to'],
    })
    expect(r.reason).toBe('unresolved_variant')
    expect(r.blockProposal).toBe(true)
    expect(r.leftover).toBe('cotovelo')
    expect(r.patch.variantIds).toBeUndefined()
    expect(r.resolvedVariantIds).toEqual(['z_ax', 'z_pe', 'z_to'])
    expect(r.proposalConfirm).toBe('none')
  })

  it('parcial com menções grava o que casou e bloqueia (opção 2)', () => {
    const r = admit({
      mentionedIds: ['z_ax'],
      unrecognized: true,
      leftover: 'cotovelo',
      ambiguous: false,
      selectionMode: 'varias',
      priorVariantIds: null,
    })
    expect(r.reason).toBe('unresolved_variant')
    expect(r.blockProposal).toBe(true)
    expect(r.leftover).toBe('cotovelo')
    expect(r.resolvedVariantIds).toEqual(['z_ax'])
    expect(r.patch.variantIds).toEqual(['z_ax'])
  })

  it('parcial une menções ao prior (não apaga zonas já travadas)', () => {
    const r = admit({
      mentionedIds: ['z_ax'],
      unrecognized: true,
      leftover: 'cotovelo',
      ambiguous: false,
      selectionMode: 'varias',
      priorVariantIds: ['z_pe', 'z_to'],
    })
    expect(r.reason).toBe('unresolved_variant')
    expect(r.blockProposal).toBe(true)
    expect(r.resolvedVariantIds).toEqual(['z_pe', 'z_to', 'z_ax'])
    expect(r.patch.variantIds).toEqual(['z_pe', 'z_to', 'z_ax'])
  })
})

describe('applyBookingUpdate — #579 excepção «hora já casada»', () => {
  it('timeAlreadyBound com sobra NÃO autoriza proposta nem apaga o slot', () => {
    // Reconstitui o cheiro do `slotBound` (#574 b08bc59): hora casada na lista
    // + «cotovelo». O actualizador deve recusar o atalho.
    const r = admit({
      mentionedIds: [],
      unrecognized: true,
      leftover: 'cotovelo',
      ambiguous: false,
      zoneEcho: null,
      timeAlreadyBound: true,
      selectionMode: 'varias',
      priorVariantIds: ['z_ax', 'z_pe', 'z_to'],
    })
    expect(r.blockProposal).toBe(true)
    expect(r.reason).toBe('unresolved_variant')
    expect(r.patch.variantIds).toBeUndefined()
    expect(r.resolvedVariantIds).toEqual(['z_ax', 'z_pe', 'z_to'])
    expect(Object.keys(r.patch).some((k) => k === 'variantIds' && r.patch.variantIds === null)).toBe(
      false,
    )
  })

  it('boundSlot / confirm sem sobra trava o conjunto do quadro', () => {
    const r = admit({
      mentionedIds: [],
      unrecognized: false,
      leftover: null,
      ambiguous: false,
      zoneEcho: 'confirm',
      timeAlreadyBound: true,
      selectionMode: 'varias',
      priorVariantIds: ['z_ax', 'z_pe', 'z_to'],
    })
    expect(r.reason).toBe('echo_locked')
    expect(r.blockProposal).toBe(false)
    expect(r.patch).toEqual({})
    expect(r.resolvedVariantIds).toEqual(['z_ax', 'z_pe', 'z_to'])
  })
})

describe('applyBookingUpdate — #576 eco de substituição', () => {
  it('substituição resolvida com proposta aberta distinta suspende Confirmar', () => {
    const r = applyBookingUpdate({
      frame: frame({ proposal: { id: 'prop_1', version: 1 } }),
      evidence,
      serviceId: 'svc_dep',
      intent: {
        type: 'resolved_substitution_echo',
        nextVariantIds: ['z_pe'],
        openProposalVariantIds: ['z_ax', 'z_pe'],
      },
    })
    expect(r.proposalConfirm).toBe('suspend')
    expect(r.reason).toBe('substitution_suspend')
    expect(r.patch.variantIds).toEqual(['z_pe'])
    expect(r.blockProposal).toBe(true)
  })

  it('mesmo conjunto na proposta não suspende', () => {
    const r = applyBookingUpdate({
      frame: frame(),
      evidence,
      intent: {
        type: 'resolved_substitution_echo',
        nextVariantIds: ['z_ax', 'z_pe'],
        openProposalVariantIds: ['z_pe', 'z_ax'],
      },
    })
    expect(r.proposalConfirm).toBe('none')
    expect(r.reason).toBe('substitution_same')
  })

  it('Corrigir limpa o rascunho e pede resume do Confirmar', () => {
    const r = applyBookingUpdate({
      frame: frame({ variantIds: ['z_pe'] }),
      evidence,
      intent: { type: 'correct_echo' },
    })
    expect(r.proposalConfirm).toBe('resume')
    expect(r.patch.variantIds).toBeNull()
    expect(r.reason).toBe('echo_correct')
  })

  it('partícula/hora/sobra não pedem suspend por esta regra', () => {
    const particle = admit({
      mentionedIds: [],
      unrecognized: false,
      leftover: null,
      ambiguous: false,
      selectionMode: 'varias',
      priorVariantIds: ['z_ax', 'z_pe', 'z_to'],
    })
    expect(particle.proposalConfirm).toBe('none')

    const leftover = admit({
      mentionedIds: [],
      unrecognized: true,
      leftover: 'cotovelo',
      ambiguous: false,
      selectionMode: 'varias',
      priorVariantIds: ['z_ax', 'z_pe', 'z_to'],
    })
    expect(leftover.proposalConfirm).toBe('none')
  })
})

describe('applyBookingUpdate — #577 hora sem vaga', () => {
  it('não grava a hora nova; restaura o relógio da proposta; Confirmar intacto', () => {
    const current = frame({ time: '17:00', date: '2026-11-06' })
    const r = applyBookingUpdate({
      frame: current,
      evidence,
      serviceId: 'svc_dep',
      intent: {
        type: 'admit_temporal',
        time: '18:00',
        date: '2026-11-06',
        vacancy: 'unavailable',
        openProposalClock: { date: '2026-11-06', time: '17:00' },
      },
    })
    expect(r.reason).toBe('time_unavailable')
    expect(r.blockProposal).toBe(true)
    expect(r.proposalConfirm).toBe('none')
    expect(r.patch.time).toBe('17:00')
    expect(r.patch.date).toBe('2026-11-06')
  })

  it('sem proposta aberta omite a hora pedida (preserva o quadro)', () => {
    const r = applyBookingUpdate({
      frame: frame({ time: '17:00' }),
      evidence,
      intent: {
        type: 'admit_temporal',
        time: '18:00',
        vacancy: 'unavailable',
        openProposalClock: null,
      },
    })
    expect(r.patch.time).toBeUndefined()
    expect(r.reason).toBe('time_unavailable')
  })
})

describe('applyBookingUpdate — #578 extractor só preenche vazio', () => {
  it('id de Axila sem campo vazio não sobrescreve o conjunto', () => {
    const r = applyBookingUpdate({
      frame: frame({ variantIds: ['z_pe'] }),
      evidence: { source: 'extractor', sourceMessageId: 'msg_llm' },
      intent: {
        type: 'extractor_fill',
        candidates: { variantIds: ['z_ax'], time: '10:00' },
      },
    })
    expect(r.reason).toBe('extractor_empty_only')
    expect(r.patch.variantIds).toBeUndefined()
    expect(r.patch.time).toBe('10:00')
  })

  it('campo vazio com candidato evidenciado pode preencher', () => {
    const r = applyBookingUpdate({
      frame: frame({ variantIds: null, time: null }),
      evidence: { source: 'extractor', sourceMessageId: 'msg_llm' },
      serviceId: 'svc_dep',
      intent: {
        type: 'extractor_fill',
        candidates: { variantIds: ['z_ax'], time: '10:00' },
      },
    })
    expect(r.patch.variantIds).toEqual(['z_ax'])
    expect(r.patch.time).toBe('10:00')
    expect(r.patch.source).toBe('llm')
  })
})

describe('applyBookingUpdate — DEC-145 uma', () => {
  it('dois ids em modo uma bloqueiam sem escolher o primeiro', () => {
    const r = admit({
      mentionedIds: ['z_a', 'z_b'],
      unrecognized: false,
      leftover: null,
      ambiguous: false,
      selectionMode: 'uma',
      priorVariantIds: null,
    })
    expect(r.reason).toBe('uma_multi')
    expect(r.blockProposal).toBe(true)
    expect(r.resolvedVariantIds).toBeNull()
  })
})

describe('applyBookingUpdate — PR-D ask_info / select / choose / flow', () => {
  it('ask_info não altera variantes (D4)', () => {
    const r = applyBookingUpdate({
      frame: frame(),
      evidence,
      intent: { type: 'ask_info', topic: 'preco' },
    })
    expect(r.reason).toBe('ask_info_no_select')
    expect(r.patch).toEqual({})
    expect(r.resolvedVariantIds).toEqual(['z_ax', 'z_pe', 'z_to'])
  })

  it('select_variants remove tira a zona negada (D3)', () => {
    const r = applyBookingUpdate({
      frame: frame({ variantIds: ['z_ax', 'z_pe'] }),
      evidence,
      intent: {
        type: 'select_variants',
        variantIds: ['z_pe'],
        mode: 'remove',
        selectionMode: 'varias',
        priorVariantIds: ['z_ax', 'z_pe'],
      },
    })
    expect(r.reason).toBe('variants_selected')
    expect(r.resolvedVariantIds).toEqual(['z_ax'])
    expect(r.patch.variantIds).toEqual(['z_ax'])
    expect(r.patch.source).toBe('regra')
  })

  it('select_variants replace com só positivos', () => {
    const r = applyBookingUpdate({
      frame: frame({ variantIds: ['z_ax', 'z_pe'] }),
      evidence,
      intent: {
        type: 'select_variants',
        variantIds: ['z_ax'],
        mode: 'replace',
        selectionMode: 'varias',
        priorVariantIds: ['z_ax', 'z_pe'],
      },
    })
    expect(r.resolvedVariantIds).toEqual(['z_ax'])
  })

  it('choose_offered linha grava audience', () => {
    const r = applyBookingUpdate({
      frame: frame({ line: null }),
      evidence: { source: 'button', sourceMessageId: 'btn_1' },
      intent: { type: 'choose_offered', slot: 'linha', line: 'feminino' },
    })
    expect(r.reason).toBe('choice_applied')
    expect(r.patch.line).toBe('feminino')
    expect(r.patch.source).toBe('botao')
  })

  it('commit_flow carimba provenance flow', () => {
    const r = applyBookingUpdate({
      frame: null,
      evidence: { source: 'flow', sourceMessageId: 'flow:evt' },
      catalogVersion: 'v1',
      intent: {
        type: 'commit_flow',
        serviceId: 'svc_dep',
        line: 'feminino',
        variantIds: ['z_ax', 'z_pe'],
        date: '2026-11-05',
        time: '17:00',
      },
    })
    expect(r.reason).toBe('flow_committed')
    expect(r.patch.phase).toBe('ofertado')
    expect(r.patch.source).toBe('flow')
    expect(r.patch.time).toBe('17:00')
  })
})

describe('isStaleFlowVersusChat — D6', () => {
  it('recusa Flow antigo quando chat já corrigiu variantes', () => {
    const current = frame({
      variantIds: ['z_ax'],
      date: '2026-11-05',
      time: '17:00',
      provenance: {
        variantIds: { messageId: 'msg_chat', source: 'regra' },
        serviceId: { messageId: 'flow:old', source: 'flow' },
        date: { messageId: 'flow:old', source: 'flow' },
        time: { messageId: 'flow:old', source: 'flow' },
      },
    })
    expect(
      isStaleFlowVersusChat(current, {
        serviceId: 'svc_dep',
        variantIds: ['z_ax', 'z_pe'],
        date: '2026-11-05',
        time: '17:00',
      }),
    ).toBe(true)
  })

  it('aceita o mesmo snapshot Flow (não é stale)', () => {
    const current = frame({
      variantIds: ['z_ax', 'z_pe'],
      date: '2026-11-05',
      time: '17:00',
      provenance: {
        variantIds: { messageId: 'flow:1', source: 'flow' },
        serviceId: { messageId: 'flow:1', source: 'flow' },
      },
    })
    expect(
      isStaleFlowVersusChat(current, {
        serviceId: 'svc_dep',
        variantIds: ['z_ax', 'z_pe'],
        date: '2026-11-05',
        time: '17:00',
      }),
    ).toBe(false)
  })
})
