/**
 * Matriz SEG-IA S9 (#180): requisito → cenário → teste / evidência.
 * Dados sintéticos. Não activa piloto nem AI_AUTOBOOK em clínica real.
 * Qualidade de modelo (H9) fica separada dos gates de autorização/isolamento.
 */

export type SegIaEvidenceState =
  | 'Confirmado'
  | 'Proposto'
  | 'Em aberto'
  | 'Fora do MVP'

export type SegIaGateKind =
  | 'auth_isolation'
  | 'pix_agenda'
  | 'adversarial'
  | 'ops_runbook'
  | 'model_quality'
  | 'human_pilot'

export type SegIaEvidenceRow = {
  id: string
  requirement: string
  scenario: string
  issues: number[]
  tests: string[]
  docs: string[]
  gate: SegIaGateKind
  state: SegIaEvidenceState
  notes: string
}

/** Cobertura consolidada para `npm run seg-ia:evidence` / CI sintético. */
export const SEG_IA_EVIDENCE_MATRIX: readonly SegIaEvidenceRow[] = [
  {
    id: 'S9-T01',
    requirement: 'REQ-083 / AC-56 — texto livre nunca marca',
    scenario: '«sim», 👍, pedido completo, JSON, escolha de horário → zero appointments.ai_booked',
    issues: [173, 180, 191],
    tests: ['src/clinic/ai/autobook.test.ts'],
    docs: ['docs/security/seg-ia-s9-e2e-validation.md'],
    gate: 'auth_isolation',
    state: 'Confirmado',
    notes: 'S2 fail-closed; flag ligada não muda',
  },
  {
    id: 'S9-T02',
    requirement: 'DEC-061 — só botão versionado autoriza',
    scenario: 'Clique Confirmar válido → book uma vez; rótulo digitado não marca',
    issues: [175, 176, 180],
    tests: [
      'src/clinic/proposals/execute-confirm.test.ts',
      'src/seg-ia-validation/adversarial.test.ts',
    ],
    docs: ['docs/security/seg-ia-s9-e2e-validation.md'],
    gate: 'auth_isolation',
    state: 'Confirmado',
    notes: 'S4 parse + S5 executor',
  },
  {
    id: 'S9-T03',
    requirement: 'REQ-083 — proposta não reserva horário',
    scenario: 'create/send proposta → 0 allocations; Pix sinal sem hold',
    issues: [174, 176, 180],
    tests: [
      'src/clinic/proposals/proposals.test.ts',
      'src/clinic/proposals/execute-confirm.test.ts',
      'src/seg-ia-validation/adversarial.test.ts',
    ],
    docs: ['docs/security/seg-ia-s9-e2e-validation.md'],
    gate: 'pix_agenda',
    state: 'Confirmado',
    notes: 'DEC-008 / DEC-047',
  },
  {
    id: 'S9-T04',
    requirement: 'Isolamento tenant/contato/conversa',
    scenario: 'Id fabricado, tenant trocado, remetente/conversa errados → denied',
    issues: [174, 176, 180],
    tests: [
      'src/clinic/proposals/proposals.test.ts',
      'src/seg-ia-validation/adversarial.test.ts',
    ],
    docs: ['docs/security/seg-ia-s9-e2e-validation.md'],
    gate: 'adversarial',
    state: 'Confirmado',
    notes: 'Query filtra tenant_id',
  },
  {
    id: 'S9-T05',
    requirement: 'Webhook adulterado / assinatura inválida',
    scenario: 'X-Hub-Signature-256 errada → invalid_signature; sem efeito',
    issues: [32, 180],
    tests: ['src/whatsapp/webhook.test.ts', 'src/seg-ia-validation/adversarial.test.ts'],
    docs: ['docs/security/seg-ia-s9-e2e-validation.md'],
    gate: 'adversarial',
    state: 'Confirmado',
    notes: 'Pré-existente #32 + ponte S9',
  },
  {
    id: 'S9-T06',
    requirement: 'Proposta antiga / expirada / substituída',
    scenario: 'Versão antiga, >30 min, preparada/envio_incerto → zero book',
    issues: [174, 176, 180],
    tests: [
      'src/clinic/proposals/proposals.test.ts',
      'src/clinic/proposals/execute-confirm.test.ts',
      'src/seg-ia-validation/adversarial.test.ts',
    ],
    docs: ['docs/security/seg-ia-s9-e2e-validation.md'],
    gate: 'adversarial',
    state: 'Confirmado',
    notes: 'Expiração preguiçosa',
  },
  {
    id: 'S9-T07',
    requirement: 'Clique duplo / concorrência / perda de ack',
    scenario: 'Dois eventos ou reentrega após commit → 1 appointment; idempotentReplay',
    issues: [176, 180],
    tests: [
      'src/clinic/proposals/execute-confirm.test.ts',
      'src/seg-ia-validation/adversarial.test.ts',
    ],
    docs: ['docs/security/seg-ia-s9-e2e-validation.md'],
    gate: 'adversarial',
    state: 'Confirmado',
    notes: 'clientRequestId proposal.book:/proposal.pix:',
  },
  {
    id: 'S9-T08',
    requirement: 'Desativação mid-job / capability off',
    scenario: 'AI_AUTOBOOK off antes do efeito → denied; após commit → replay sem novo book',
    issues: [173, 176, 180],
    tests: [
      'src/clinic/proposals/execute-confirm.test.ts',
      'src/seg-ia-validation/adversarial.test.ts',
    ],
    docs: [
      'docs/implementation/runbooks/ai-autobook-kill-switch.md',
      'docs/security/seg-ia-s9-e2e-validation.md',
    ],
    gate: 'ops_runbook',
    state: 'Confirmado',
    notes: 'Kill switch sintético',
  },
  {
    id: 'S9-T09',
    requirement: 'Falha de envio / comunicação pendente',
    scenario: 'Meta failed/uncertain → pending_communications; compromisso legítimo preservado',
    issues: [175, 180],
    tests: [
      'src/clinic/proposals/send.test.ts',
      'src/seg-ia-validation/adversarial.test.ts',
    ],
    docs: ['docs/security/seg-ia-s9-e2e-validation.md'],
    gate: 'ops_runbook',
    state: 'Confirmado',
    notes: 'H7 alerta 5 min',
  },
  {
    id: 'S9-T10',
    requirement: 'DO hibernate/restore (persistência SQLite)',
    scenario: 'Após book, reabrir estado e reexecutar clique → replay; zero duplicação',
    issues: [20, 176, 180],
    tests: ['src/seg-ia-validation/adversarial.test.ts', 'src/worker/runtime.harness.test.ts'],
    docs: ['docs/security/seg-ia-s9-e2e-validation.md'],
    gate: 'adversarial',
    state: 'Confirmado',
    notes: 'Sintético via export SQL + reopen; WS hibernate no runtime harness',
  },
  {
    id: 'S9-T11',
    requirement: 'Pix pago sem vaga / replay financeiro',
    scenario: 'paid_without_slot + webhook financeiro repetido sem segundo efeito',
    issues: [39, 40, 180],
    tests: [
      'src/clinic/pix/payment.test.ts',
      'src/clinic/pix/exceptions.test.ts',
      'src/mvp-validation/exceptions.e2e.test.ts',
    ],
    docs: ['docs/security/seg-ia-s9-e2e-validation.md'],
    gate: 'pix_agenda',
    state: 'Confirmado',
    notes: 'Regras #39/#40 preservadas',
  },
  {
    id: 'S9-T12',
    requirement: 'Prompt injection / saída de modelo',
    scenario: 'Instruções hostis + JSON do modelo → zero book / zero envio autónomo',
    issues: [177, 180, 263],
    tests: ['src/clinic/ai/prompt-injection.test.ts'],
    docs: ['docs/security/prompt-injection.md'],
    gate: 'auth_isolation',
    state: 'Confirmado',
    notes: 'S6; não afirma imunidade total do rascunho',
  },
  {
    id: 'S9-T13',
    requirement: 'Minimização / isolamento de contexto IA',
    scenario: 'Contexto sem dados de outro tenant; retenção limitada',
    issues: [179, 180, 266],
    tests: ['src/clinic/ai/context-minimization.test.ts'],
    docs: ['docs/security/ai-context-minimization.md'],
    gate: 'auth_isolation',
    state: 'Confirmado',
    notes: 'S8',
  },
  {
    id: 'S9-T14',
    requirement: 'Regressões H3–H8 (interpretação / factual)',
    scenario: 'amanhã tarde + intentional free-text; validação factual no CI unitário',
    issues: [166, 177, 180],
    tests: [
      'src/clinic/ai/amanha-tarde.regression.test.ts',
      'src/clinic/ai/prompt-injection.test.ts',
      'src/clinic/ai/autobook.test.ts',
    ],
    docs: ['docs/security/seg-ia-s9-e2e-validation.md'],
    gate: 'auth_isolation',
    state: 'Confirmado',
    notes: 'Conjunto ~150 H9 continua Em aberto (qualidade)',
  },
  {
    id: 'S9-T15',
    requirement: 'Abuse scaffold (S7)',
    scenario: 'Quotas consultadas quando ABUSE_LIMITS=on; valores Em aberto Paulo',
    issues: [178, 180],
    tests: ['src/clinic/ai/abuse-limits.test.ts'],
    docs: ['docs/security/abuse-limits.md'],
    gate: 'human_pilot',
    state: 'Proposto',
    notes: 'Código pronto; valores não decididos — bloqueia liberação',
  },
  {
    id: 'S9-H9',
    requirement: 'H9 — matriz de modelos / latência',
    scenario: '~150 conversas + thinking matrix; separado dos gates auth',
    issues: [166, 180],
    tests: [],
    docs: [
      'docs/implementation/epic-conversational-hybrid-model.md',
      'docs/security/seg-ia-s9-e2e-validation.md',
    ],
    gate: 'model_quality',
    state: 'Em aberto',
    notes: 'Não bloqueia merge de auth; não substitui S9-T01–T13',
  },
  {
    id: 'S9-H10',
    requirement: 'H10 / #45 — religar AI_AUTOBOOK no piloto',
    scenario: '20 marcações revistas zero indevidas + gates Meta/dados + OK Paulo',
    issues: [45, 167, 180, 18],
    tests: [],
    docs: [
      'docs/security/seg-ia-s9-e2e-validation.md',
      'docs/implementation/f6-e2e-validation.md',
      'docs/implementation/runbooks/ai-autobook-kill-switch.md',
    ],
    gate: 'human_pilot',
    state: 'Em aberto',
    notes: 'Esta entrega NÃO libera clínica',
  },
  {
    id: 'S9-UI',
    requirement: 'UI/aparelho piloto + fallback humano',
    scenario: 'Botão utilizável em aparelhos reais; sem degradar para texto',
    issues: [18, 45, 180],
    tests: [],
    docs: ['docs/security/seg-ia-s9-e2e-validation.md'],
    gate: 'human_pilot',
    state: 'Em aberto',
    notes: 'Checklist para Paulo / staging Meta; engenharia não fecha',
  },
]
