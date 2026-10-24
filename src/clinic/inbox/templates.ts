/**
 * Catálogo local de modelos WhatsApp (#33).
 * Textos Meta reais = GATE-10; aqui seed sintético alinhado a TMPL-01/02/(03).
 * Preços: nunca inventados — só categoria + nota «consultar tabela vigente».
 */
import type { Clock } from '../../db/clock'
import type { WhatsappTemplateStatus } from '../constants'
import { ValidationError } from '../errors'
import { assertClinicSchemaReady } from '../migrations'
import type { ClinicDb } from '../store'

export type WhatsappTemplateRow = {
  tenantId: string
  name: string
  language: string
  status: WhatsappTemplateStatus
  category: string
  bodyPreview: string
  paramKeys: string[]
  pricingCategory: string | null
  pricingNote: string
  syncedAt: number
}

/** Catálogo sintético do piloto (DEC-040 / whatsapp-templates-draft.md). */
export const SYNTHETIC_WHATSAPP_TEMPLATES: readonly Omit<
  WhatsappTemplateRow,
  'tenantId' | 'syncedAt'
>[] = [
  {
    name: 'tredane_retomada_contato',
    language: 'pt_BR',
    status: 'approved',
    category: 'UTILITY',
    bodyPreview:
      'Olá, {{nome_contato}}! Aqui é a {{nome_clinica}}. Podemos continuar seu atendimento?',
    paramKeys: ['nome_contato', 'nome_clinica'],
    pricingCategory: 'utility',
    pricingNote: 'Consultar tabela vigente Meta (categoria utility) — sem preço fixo no Tredane.',
  },
  {
    name: 'tredane_confirmacao_horario',
    language: 'pt_BR',
    status: 'approved',
    category: 'UTILITY',
    bodyPreview:
      'Olá, {{nome_contato}}! Seu horário na {{nome_clinica}} está confirmado. Serviço: {{servico}}. Quando: {{data_hora}}. Profissional: {{profissional}}.',
    paramKeys: ['nome_contato', 'nome_clinica', 'servico', 'data_hora', 'profissional'],
    pricingCategory: 'utility',
    pricingNote: 'Consultar tabela vigente Meta (categoria utility) — sem preço fixo no Tredane.',
  },
  {
    name: 'tredane_cobranca_sinal_pix',
    language: 'pt_BR',
    /** Aprovado só no catálogo sintético; produção exige GATE-10. */
    status: 'approved',
    category: 'UTILITY',
    bodyPreview:
      'Olá, {{nome_contato}}! Sinal de {{valor_sinal}} por Pix para {{servico}} em {{data_hora}} na {{nome_clinica}}. Prazo: {{prazo_pagamento}}. Pagamento: {{link_ou_codigo_pix}}.',
    paramKeys: [
      'nome_contato',
      'nome_clinica',
      'servico',
      'data_hora',
      'valor_sinal',
      'prazo_pagamento',
      'link_ou_codigo_pix',
    ],
    pricingCategory: 'utility',
    pricingNote: 'Consultar tabela vigente Meta (categoria utility) — sem preço fixo no Tredane.',
  },
]

type TplSql = {
  tenant_id: string
  name: string
  language: string
  status: string
  category: string
  body_preview: string
  param_keys_json: string
  pricing_category: string | null
  pricing_note: string
  synced_at: number
}

function mapRow(row: TplSql): WhatsappTemplateRow {
  let paramKeys: string[] = []
  try {
    const parsed = JSON.parse(row.param_keys_json) as unknown
    if (Array.isArray(parsed)) {
      paramKeys = parsed.filter((p): p is string => typeof p === 'string')
    }
  } catch {
    paramKeys = []
  }
  return {
    tenantId: row.tenant_id,
    name: row.name,
    language: row.language,
    status: row.status as WhatsappTemplateStatus,
    category: row.category,
    bodyPreview: row.body_preview,
    paramKeys,
    pricingCategory: row.pricing_category,
    pricingNote: row.pricing_note,
    syncedAt: row.synced_at,
  }
}

export function upsertWhatsappTemplates(
  db: ClinicDb,
  tenantId: string,
  templates: readonly Omit<WhatsappTemplateRow, 'tenantId' | 'syncedAt'>[],
  clock: Clock,
): WhatsappTemplateRow[] {
  assertClinicSchemaReady(db)
  const now = clock.nowMs()
  return db.transactionSync(() => {
    for (const t of templates) {
      db.run(
        `INSERT INTO whatsapp_templates (
          tenant_id, name, language, status, category, body_preview,
          param_keys_json, pricing_category, pricing_note, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id, name, language) DO UPDATE SET
          status = excluded.status,
          category = excluded.category,
          body_preview = excluded.body_preview,
          param_keys_json = excluded.param_keys_json,
          pricing_category = excluded.pricing_category,
          pricing_note = excluded.pricing_note,
          synced_at = excluded.synced_at`,
        tenantId,
        t.name,
        t.language,
        t.status,
        t.category,
        t.bodyPreview,
        JSON.stringify(t.paramKeys),
        t.pricingCategory,
        t.pricingNote,
        now,
      )
    }
    return listWhatsappTemplates(db, tenantId)
  })
}

export function seedSyntheticWhatsappTemplates(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
): WhatsappTemplateRow[] {
  return upsertWhatsappTemplates(db, tenantId, SYNTHETIC_WHATSAPP_TEMPLATES, clock)
}

export function listWhatsappTemplates(
  db: ClinicDb,
  tenantId: string,
  opts: { approvedOnly?: boolean } = {},
): WhatsappTemplateRow[] {
  assertClinicSchemaReady(db)
  const rows = db.all<TplSql>(
    opts.approvedOnly
      ? `SELECT * FROM whatsapp_templates
         WHERE tenant_id = ? AND status = 'approved'
         ORDER BY name ASC`
      : `SELECT * FROM whatsapp_templates
         WHERE tenant_id = ?
         ORDER BY name ASC`,
    tenantId,
  )
  return rows.map(mapRow)
}

export function getWhatsappTemplate(
  db: ClinicDb,
  tenantId: string,
  name: string,
  language: string,
): WhatsappTemplateRow | undefined {
  assertClinicSchemaReady(db)
  const row = db.get<TplSql>(
    `SELECT * FROM whatsapp_templates
     WHERE tenant_id = ? AND name = ? AND language = ?`,
    tenantId,
    name,
    language,
  )
  return row ? mapRow(row) : undefined
}

export function renderTemplateBody(
  preview: string,
  params: Record<string, string>,
): string {
  return preview.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const v = params[key]
    return v != null && v.trim() ? v.trim() : `{{${key}}}`
  })
}

export function validateTemplateSend(
  db: ClinicDb,
  tenantId: string,
  input: {
    name: string
    language: string
    params: Record<string, string>
  },
): { template: WhatsappTemplateRow; body: string } {
  const template = getWhatsappTemplate(db, tenantId, input.name, input.language)
  if (!template) {
    throw new ValidationError(
      'template_not_found',
      'Modelo WhatsApp não encontrado nesta clínica',
    )
  }
  if (template.status !== 'approved') {
    throw new ValidationError(
      'template_not_approved',
      `Modelo não aprovado (estado: ${template.status})`,
    )
  }
  for (const key of template.paramKeys) {
    const v = input.params[key]
    if (v == null || !String(v).trim()) {
      throw new ValidationError(
        'template_param_invalid',
        `Parâmetro obrigatório em falta: ${key}`,
        { param: key },
      )
    }
  }
  for (const key of Object.keys(input.params)) {
    if (!template.paramKeys.includes(key)) {
      throw new ValidationError(
        'template_param_invalid',
        `Parâmetro desconhecido: ${key}`,
        { param: key },
      )
    }
  }
  return {
    template,
    body: renderTemplateBody(template.bodyPreview, input.params),
  }
}
