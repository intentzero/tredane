/**
 * Migração 18 — reserva por bloco SEMPRE com hora (decisão do fundador de
 * 27/10/2026, revertendo a etapa «A definir»).
 *
 * 1. Limpeza segura dos dados da 16: blocos em aberto (`active`/`expired`, sem
 *    compromisso) passam a `cancelled`; contatos em `a_definir` voltam para
 *    `agendado` (se já têm compromisso) ou `em_atendimento`; o histórico que
 *    citava `a_definir` é reescrito para `em_atendimento`, com nota.
 * 2. `opportunities` e `opportunity_stage_history` são reconstruídas com o
 *    CHECK sem `a_definir` (mesmo método da 16: stash do filho primeiro).
 */
export const MIGRATION_ID = 18
export const MIGRATION_NAME = '0018_holds_require_time'

const STAGES_SQL = `'novo_contato',
        'em_atendimento',
        'horario_proposto',
        'agendado',
        'concluido',
        'perdido'`

const NOW_MS = `CAST(strftime('%s', 'now') AS INTEGER) * 1000`

export const STATEMENTS: readonly string[] = [
  `PRAGMA defer_foreign_keys = ON`,

  `UPDATE schedule_holds
    SET status = 'cancelled',
        cancelled_at = COALESCE(cancelled_at, ${NOW_MS}),
        alert_dismissed_at = COALESCE(alert_dismissed_at, ${NOW_MS}),
        updated_at = ${NOW_MS}
    WHERE status IN ('active', 'expired')`,

  `UPDATE opportunities
    SET stage = CASE WHEN linked_appointment_id IS NOT NULL THEN 'agendado' ELSE 'em_atendimento' END,
        updated_at = ${NOW_MS}
    WHERE stage = 'a_definir'`,

  `UPDATE opportunity_stage_history
    SET note = TRIM(COALESCE(note, '') || ' [etapa antiga «A definir»]'),
        from_stage = CASE WHEN from_stage = 'a_definir' THEN 'em_atendimento' ELSE from_stage END,
        to_stage = CASE WHEN to_stage = 'a_definir' THEN 'em_atendimento' ELSE to_stage END
    WHERE from_stage = 'a_definir' OR to_stage = 'a_definir'`,

  `CREATE TABLE opportunity_stage_history__stash18 AS
    SELECT id, tenant_id, opportunity_id, from_stage, to_stage,
           actor_clerk_user_id, actor_display_name, note, created_at
    FROM opportunity_stage_history`,
  `DROP TABLE opportunity_stage_history`,

  `CREATE TABLE opportunities__m18 (
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

  `INSERT INTO opportunities__m18 (
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
  `ALTER TABLE opportunities__m18 RENAME TO opportunities`,

  `CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunities_open_conversation
    ON opportunities (tenant_id, conversation_id)
    WHERE status = 'open'`,
  `CREATE INDEX IF NOT EXISTS idx_opportunities_stage
    ON opportunities (tenant_id, status, stage, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_opportunities_contact
    ON opportunities (tenant_id, contact_id, cycle_number DESC)`,

  `CREATE TABLE opportunity_stage_history__m18 (
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

  `INSERT INTO opportunity_stage_history__m18 (
    id, tenant_id, opportunity_id, from_stage, to_stage,
    actor_clerk_user_id, actor_display_name, note, created_at
  )
  SELECT
    id, tenant_id, opportunity_id, from_stage, to_stage,
    actor_clerk_user_id, actor_display_name, note, created_at
  FROM opportunity_stage_history__stash18`,

  `DROP TABLE opportunity_stage_history__stash18`,
  `ALTER TABLE opportunity_stage_history__m18 RENAME TO opportunity_stage_history`,

  `CREATE INDEX IF NOT EXISTS idx_opportunity_history_time
    ON opportunity_stage_history (tenant_id, opportunity_id, created_at ASC)`,

]
