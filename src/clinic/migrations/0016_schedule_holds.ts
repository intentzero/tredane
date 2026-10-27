/**
 * Migração 16 — reserva por bloco (decisões do fundador de 27/10/2026).
 *
 * 1. Nova etapa «A definir» (`a_definir`) no Acompanhamento. O SQLite não
 *    altera CHECK in-place: `opportunities` e `opportunity_stage_history` são
 *    reconstruídas (histórico para stash → mãe copiada/renomeada → histórico
 *    recriado a partir do stash).
 * 2. Tabela `schedule_holds`: o bloco segura `duration_minutes` da agenda de
 *    UMA profissional dentro de [window_starts_at, window_ends_at). Não cria
 *    alocação nem compromisso — só restringe novos agendamentos que
 *    impediriam o bloco de caber no período.
 */
export const MIGRATION_ID = 16
export const MIGRATION_NAME = '0016_schedule_holds'

const STAGES_SQL = `'novo_contato',
        'em_atendimento',
        'a_definir',
        'horario_proposto',
        'agendado',
        'concluido',
        'perdido'`

export const STATEMENTS: readonly string[] = [
  `PRAGMA defer_foreign_keys = ON`,

  // Histórico (filho) sai primeiro para um stash sem constraints: apagar a
  // tabela-mãe com filhos vivos deixaria o contador de FKs adiadas sujo
  // (o DO aplica sempre foreign_keys=ON e não deixa desligar).
  `CREATE TABLE opportunity_stage_history__stash16 AS
    SELECT id, tenant_id, opportunity_id, from_stage, to_stage,
           actor_clerk_user_id, actor_display_name, note, created_at
    FROM opportunity_stage_history`,
  `DROP TABLE opportunity_stage_history`,

  `CREATE TABLE opportunities__m16 (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    stage TEXT NOT NULL CHECK (
      stage IN (
        ${STAGES_SQL}
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

  `INSERT INTO opportunities__m16 (
    id, tenant_id, contact_id, conversation_id, stage, status, cycle_number,
    assignee_clerk_user_id, assignee_display_name, last_interaction_at,
    linked_appointment_id, created_at, updated_at
  )
  SELECT
    id, tenant_id, contact_id, conversation_id, stage, status, cycle_number,
    assignee_clerk_user_id, assignee_display_name, last_interaction_at,
    linked_appointment_id, created_at, updated_at
  FROM opportunities`,

  `DROP TABLE opportunities`,
  `ALTER TABLE opportunities__m16 RENAME TO opportunities`,

  `CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunities_open_conversation
    ON opportunities (tenant_id, conversation_id)
    WHERE status = 'open'`,
  `CREATE INDEX IF NOT EXISTS idx_opportunities_stage
    ON opportunities (tenant_id, status, stage, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_opportunities_contact
    ON opportunities (tenant_id, contact_id, cycle_number DESC)`,

  `CREATE TABLE opportunity_stage_history__m16 (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    opportunity_id TEXT NOT NULL,
    from_stage TEXT CHECK (
      from_stage IS NULL
      OR from_stage IN (
        ${STAGES_SQL}
      )
    ),
    to_stage TEXT NOT NULL CHECK (
      to_stage IN (
        ${STAGES_SQL}
      )
    ),
    actor_clerk_user_id TEXT,
    actor_display_name TEXT,
    note TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, opportunity_id) REFERENCES opportunities (tenant_id, id)
  )`,

  `INSERT INTO opportunity_stage_history__m16 (
    id, tenant_id, opportunity_id, from_stage, to_stage,
    actor_clerk_user_id, actor_display_name, note, created_at
  )
  SELECT
    id, tenant_id, opportunity_id, from_stage, to_stage,
    actor_clerk_user_id, actor_display_name, note, created_at
  FROM opportunity_stage_history__stash16`,

  `DROP TABLE opportunity_stage_history__stash16`,
  `ALTER TABLE opportunity_stage_history__m16 RENAME TO opportunity_stage_history`,

  `CREATE INDEX IF NOT EXISTS idx_opportunity_history_time
    ON opportunity_stage_history (tenant_id, opportunity_id, created_at ASC)`,

  `CREATE TABLE IF NOT EXISTS schedule_holds (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    client_request_id TEXT,
    opportunity_id TEXT,
    conversation_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    service_id TEXT NOT NULL,
    professional_id TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
    window_starts_at INTEGER NOT NULL,
    window_ends_at INTEGER NOT NULL,
    confirm_by INTEGER,
    status TEXT NOT NULL CHECK (
      status IN ('active', 'resolved', 'expired', 'cancelled')
    ),
    appointment_id TEXT,
    responsible_clerk_user_id TEXT,
    responsible_display_name TEXT,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    resolved_at INTEGER,
    expired_at INTEGER,
    cancelled_at INTEGER,
    alert_dismissed_at INTEGER,
    PRIMARY KEY (tenant_id, id),
    CHECK (window_ends_at > window_starts_at)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_schedule_holds_pro_window
    ON schedule_holds (tenant_id, professional_id, status, window_starts_at)`,
  `CREATE INDEX IF NOT EXISTS idx_schedule_holds_conversation
    ON schedule_holds (tenant_id, conversation_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_schedule_holds_status_end
    ON schedule_holds (tenant_id, status, window_ends_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_holds_request
    ON schedule_holds (tenant_id, client_request_id)
    WHERE client_request_id IS NOT NULL`,
]
