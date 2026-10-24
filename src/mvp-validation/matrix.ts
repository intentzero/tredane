/**
 * Matriz máquina-legível AC/UX/JRN → issue → ficheiro de teste (#45 / MVP-31).
 * Dados sintéticos apenas. Não declara piloto activado.
 */

export type EvidenceState =
  | 'Confirmado'
  | 'Proposto'
  | 'Em aberto'
  | 'Fora do MVP'

export type EvidenceRow = {
  id: string
  criterion: string
  issues: number[]
  tests: string[]
  state: EvidenceState
  notes: string
}

/** Cobertura consolidada para CI / `npm run mvp:evidence`. */
export const MVP_EVIDENCE_MATRIX: readonly EvidenceRow[] = [
  {
    id: 'AC-01',
    criterion: 'Acesso cruzado negado',
    issues: [20, 21, 29, 45],
    tests: [
      'src/mvp-validation/journey.e2e.test.ts',
      'src/mvp-validation/api-roles.http.test.ts',
      'src/inbox/http.test.ts',
    ],
    state: 'Confirmado',
    notes: 'Sintético; IDs forjados',
  },
  {
    id: 'AC-02',
    criterion: 'Membership revogado sem logout Clerk',
    issues: [23, 25, 45],
    tests: [
      'src/mvp-validation/api-roles.http.test.ts',
      'src/worker/runtime.harness.test.ts',
      'src/realtime/http.test.ts',
    ],
    state: 'Confirmado',
    notes: 'Sintético',
  },
  {
    id: 'AC-04',
    criterion: 'Primeiro contacto WhatsApp',
    issues: [29, 30, 32, 45],
    tests: [
      'src/mvp-validation/journey.e2e.test.ts',
      'src/clinic/pipeline/pipeline.test.ts',
      'src/whatsapp/webhook.test.ts',
    ],
    state: 'Confirmado',
    notes: 'Sintético',
  },
  {
    id: 'AC-05',
    criterion: 'Webhook repetido ou inválido',
    issues: [32],
    tests: ['src/whatsapp/webhook.test.ts'],
    state: 'Confirmado',
    notes: 'Sintético',
  },
  {
    id: 'AC-06',
    criterion: 'IA revisada por pessoa',
    issues: [41, 45],
    tests: [
      'src/mvp-validation/journey.e2e.test.ts',
      'src/clinic/ai/ai.test.ts',
    ],
    state: 'Confirmado',
    notes: 'Sintético; GATE-06 live Em aberto',
  },
  {
    id: 'AC-07',
    criterion: 'Envio com resultado desconhecido',
    issues: [33, 45],
    tests: [
      'src/mvp-validation/exceptions.e2e.test.ts',
      'src/whatsapp/send.test.ts',
    ],
    state: 'Confirmado',
    notes: 'Sintético',
  },
  {
    id: 'AC-08',
    criterion: 'Duas sessões mesma clínica',
    issues: [23, 30, 45],
    tests: [
      'src/mvp-validation/api-roles.http.test.ts',
      'src/worker/runtime.harness.test.ts',
    ],
    state: 'Confirmado',
    notes: 'Sintético',
  },
  {
    id: 'AC-09',
    criterion: 'Conflito profissional ou sala',
    issues: [35, 36, 45],
    tests: [
      'src/mvp-validation/exceptions.e2e.test.ts',
      'src/clinic/scheduling/booking.test.ts',
    ],
    state: 'Confirmado',
    notes: 'Buffers piloto Em aberto (VAL-03)',
  },
  {
    id: 'AC-11',
    criterion: 'Reconexão após evento perdido',
    issues: [23],
    tests: ['src/worker/runtime.harness.test.ts', 'src/realtime/realtime.test.ts'],
    state: 'Confirmado',
    notes: 'Sintético',
  },
  {
    id: 'AC-12',
    criterion: 'Hibernação sem vazamento',
    issues: [20, 23],
    tests: ['src/worker/runtime.harness.test.ts'],
    state: 'Confirmado',
    notes: 'Sintético',
  },
  {
    id: 'AC-47',
    criterion: 'Pagamento Pix processado uma vez',
    issues: [39, 45],
    tests: [
      'src/mvp-validation/exceptions.e2e.test.ts',
      'src/clinic/pix/payment.test.ts',
    ],
    state: 'Confirmado',
    notes: 'Sintético; GATE-08 Em aberto',
  },
  {
    id: 'AC-48',
    criterion: 'Pago sem horário',
    issues: [39, 40, 45],
    tests: [
      'src/mvp-validation/exceptions.e2e.test.ts',
      'src/clinic/pix/exceptions.test.ts',
    ],
    state: 'Confirmado',
    notes: 'Sintético',
  },
  {
    id: 'AC-49',
    criterion: 'Expiração e pagamento tardio',
    issues: [40, 45],
    tests: [
      'src/mvp-validation/exceptions.e2e.test.ts',
      'src/clinic/pix/exceptions.test.ts',
    ],
    state: 'Confirmado',
    notes: 'Sintético',
  },
  {
    id: 'AC-50',
    criterion: 'Cancelamento com estorno falhado',
    issues: [40, 45],
    tests: [
      'src/mvp-validation/exceptions.e2e.test.ts',
      'src/clinic/pix/exceptions.test.ts',
    ],
    state: 'Confirmado',
    notes: 'Sintético',
  },
  {
    id: 'AC-52',
    criterion: 'Exclusão de contacto e purge',
    issues: [43, 45],
    tests: [
      'src/mvp-validation/journey.e2e.test.ts',
      'src/clinic/retention/retention.test.ts',
      'src/retention/retention.test.ts',
    ],
    state: 'Confirmado',
    notes: 'Sintético; VAL-09 jurídico Em aberto',
  },
  {
    id: 'AC-53',
    criterion: 'Ops, staging, recovery',
    issues: [44],
    tests: ['src/ops/ops.test.ts', 'src/ops/http.test.ts'],
    state: 'Confirmado',
    notes: 'PITR live Em aberto',
  },
  {
    id: 'AC-54',
    criterion: 'Matriz E2E + go/no-go sintético (#45)',
    issues: [45],
    tests: [
      'src/mvp-validation/journey.e2e.test.ts',
      'src/mvp-validation/exceptions.e2e.test.ts',
      'src/mvp-validation/api-roles.http.test.ts',
      'docs/product/evidence-matrix.md',
      'docs/implementation/f6-e2e-validation.md',
    ],
    state: 'Proposto',
    notes: 'Harness in-repo; activação piloto Em aberto',
  },
  {
    id: 'UX-08',
    criterion: 'Fluxo completo em 360 px',
    issues: [22, 42, 45],
    tests: [],
    state: 'Em aberto',
    notes: 'Q-UX-01 aparelhos reais',
  },
  {
    id: 'JRN-16',
    criterion: 'Agendamento com sinal Pix',
    issues: [37, 38, 39, 40, 45],
    tests: [
      'src/mvp-validation/journey.e2e.test.ts',
      'src/clinic/pix/payment.test.ts',
    ],
    state: 'Confirmado',
    notes: 'Sintético',
  },
  {
    id: 'GATE-01',
    criterion: 'CNPJ / Meta Business Verification',
    issues: [18, 45],
    tests: [],
    state: 'Em aberto',
    notes: 'Bloqueado externo',
  },
  {
    id: 'GATE-05',
    criterion: 'Clerk keys / DPA / plano',
    issues: [18, 21, 45],
    tests: [],
    state: 'Em aberto',
    notes: 'Autorização humana',
  },
] as const

export function summarizeEvidenceMatrix(rows: readonly EvidenceRow[] = MVP_EVIDENCE_MATRIX) {
  const counts: Record<EvidenceState, number> = {
    Confirmado: 0,
    Proposto: 0,
    'Em aberto': 0,
    'Fora do MVP': 0,
  }
  for (const row of rows) counts[row.state] += 1
  return counts
}
