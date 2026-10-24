/**
 * Migração 5 — Acompanhamento / oportunidades (#30 / REQ-023; DEC-040/045).
 * Domínio de oportunidade + histórico de etapas; vínculo opcional a compromisso.
 *
 * VAL-02 (Em aberto / fixtures): cardinalidade = no máximo uma oportunidade
 * `open` por conversa; ciclo `cycle_number` incrementa em reabertura; «Concluído»
 * e «Perdido» fecham o ciclo sem apagar histórico. Hipótese até validação piloto.
 */
export const MIGRATION_ID = 5
export const MIGRATION_NAME = '0005_pipeline'

export const STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS opportunities (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    stage TEXT NOT NULL CHECK (
      stage IN (
        'novo_contato',
        'em_atendimento',
        'horario_proposto',
        'agendado',
        'concluido',
        'perdido'
      )
    ),
    status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
    cycle_number INTEGER NOT NULL DEFAULT 1,
    assignee_clerk_user_id TEXT,
    assignee_display_name TEXT,
    last_interaction_at INTEGER,
    linked_appointment_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts (tenant_id, id),
    FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations (tenant_id, id)
  )`,

  /** VAL-02 fixture: uma oportunidade open por conversa (hipótese). */
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunities_open_conversation
    ON opportunities (tenant_id, conversation_id)
    WHERE status = 'open'`,

  `CREATE INDEX IF NOT EXISTS idx_opportunities_stage
    ON opportunities (tenant_id, status, stage, updated_at DESC)`,

  `CREATE INDEX IF NOT EXISTS idx_opportunities_contact
    ON opportunities (tenant_id, contact_id, cycle_number DESC)`,

  `CREATE TABLE IF NOT EXISTS opportunity_stage_history (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    opportunity_id TEXT NOT NULL,
    from_stage TEXT CHECK (
      from_stage IS NULL
      OR from_stage IN (
        'novo_contato',
        'em_atendimento',
        'horario_proposto',
        'agendado',
        'concluido',
        'perdido'
      )
    ),
    to_stage TEXT NOT NULL CHECK (
      to_stage IN (
        'novo_contato',
        'em_atendimento',
        'horario_proposto',
        'agendado',
        'concluido',
        'perdido'
      )
    ),
    actor_clerk_user_id TEXT,
    actor_display_name TEXT,
    note TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, opportunity_id) REFERENCES opportunities (tenant_id, id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_opportunity_history_time
    ON opportunity_stage_history (tenant_id, opportunity_id, created_at ASC)`,

  /**
   * Vínculo mínimo conversa/oportunidade → agenda (sem UI de calendário #35/#36).
   * Mover etapa NUNCA cria nem altera compromisso (DEC-040).
   */
  `ALTER TABLE appointments ADD COLUMN contact_id TEXT`,
  `ALTER TABLE appointments ADD COLUMN conversation_id TEXT`,
  `ALTER TABLE appointments ADD COLUMN opportunity_id TEXT`,

  `CREATE INDEX IF NOT EXISTS idx_appointments_opportunity
    ON appointments (tenant_id, opportunity_id)`,
]
