import { PanelApiError } from '../api'

/**
 * Tradução de erros da API para frases que a recepcionista entende.
 * A tela nunca mostra `err.message`: o código original fica só em
 * «Detalhes para o suporte» (`errorDetail`).
 */

const GENERIC = 'Não deu para concluir agora. Tente de novo.'
const NETWORK = 'Sem conexão com a internet. Verifique o Wi-Fi ou os dados móveis e tente de novo.'
const CHECK_DATA = 'Confira os dados e tente de novo.'
const OUR_SIDE = 'Algo deu errado do nosso lado. Tente de novo em instantes.'
const SUPPORT_WHATSAPP =
  'A conexão com o WhatsApp ainda não está configurada. Fale com o suporte do Tredane.'
const CONFLICT = 'Outra pessoa acabou de mudar isso. Atualize a tela e tente de novo.'

const BY_CODE: Record<string, string> = {
  // sessão e acesso
  unauthenticated: 'Sua sessão terminou. Entre de novo para continuar.',
  session_expired: 'Sua sessão terminou. Entre de novo para continuar.',
  tenant_access_denied: 'Você não tem mais acesso a esta clínica. Fale com o responsável.',
  permission_denied: 'Só o responsável pela clínica pode fazer isso.',
  forbidden: 'Só o responsável pela clínica pode fazer isso.',
  forged_role_rejected: 'Só o responsável pela clínica pode fazer isso.',
  clinical_access_denied: 'Você não tem acesso a esta informação.',
  tenant_not_active: 'Esta clínica está pausada no Tredane. Fale com o suporte.',
  network: NETWORK,
  unknown: GENERIC,

  // dados
  invalid_body: CHECK_DATA,
  invalid_json: CHECK_DATA,
  validation_error: CHECK_DATA,
  not_found: 'Não encontramos isso. Pode ter sido removido.',
  conflict: CONFLICT,
  invalid_state: 'Isso não pode ser feito agora. Atualize a tela e tente de novo.',
  zone_name_taken: 'Já existe uma variante com o mesmo nome, gênero, duração e preço.',

  // agenda e sinal
  slot_occupied: 'Esse horário acabou de ser ocupado. Escolha outro.',
  appointment_conflict: 'Esse horário acabou de ser ocupado. Escolha outro.',
  room_at_capacity: 'Esse horário nesta sala já está cheio.',
  professional_other_room: 'A profissional já está noutra sala nesse horário.',
  room_sex_mismatch: 'Nesse horário a sala está só para um dos públicos.',
  invalid_room_requirement: 'Escolha uma ou mais salas, ou Sem espaço definido.',
  room_requirement_mismatch: 'Essa sala não serve para este serviço.',
  room_required: 'Este serviço não tem sala ativa para marcar.',
  payment_after_expiry: 'O Pix chegou depois do prazo do sinal.',

  // WhatsApp
  meta_live_missing_credentials: SUPPORT_WHATSAPP,
  webhook_unconfigured: SUPPORT_WHATSAPP,
  not_available_in_live: SUPPORT_WHATSAPP,
  credential_missing: SUPPORT_WHATSAPP,
  no_active_binding: 'Não há WhatsApp conectado nesta clínica.',
  phone_in_use: 'Este número já está conectado a outra clínica no Tredane.',
  connect_rejected_phone_in_use: 'Este número já está conectado a outra clínica no Tredane.',
  tenant_already_connected: 'Esta clínica já tem um número de WhatsApp conectado.',
  account_without_phone:
    'Essa conta do Facebook não tem número de WhatsApp. Escolha ou crie um número e tente de novo.',
  code_invalid: 'A autorização do Facebook expirou. Tente conectar de novo.',
  unknown_or_released_phone: 'Esse número não está mais conectado a esta clínica.',

  // Equipe / convites
  email_required: 'Informe o e-mail da pessoa.',
  invitation_already_pending: 'Já existe um convite pendente para este e-mail.',
  invitation_not_found: 'Não encontramos este convite. Pode ter sido cancelado.',
  invitation_not_pending: 'Este convite já não está pendente.',
  invitation_expired: 'Este convite expirou. Peça um novo ao responsável da clínica.',
  invitation_token_invalid:
    'Este convite não é mais válido. Pode ter sido cancelado, usado ou substituído por um reenvio.',
  invitation_email_mismatch:
    'Este convite é para outro e-mail. Entre com o e-mail que recebeu o convite.',
  invitation_email_unverified:
    'Confirme o e-mail da sua conta antes de aceitar o convite.',
  invitation_email_missing: 'Sua conta não tem e-mail. Use a conta do convite.',
  invitation_accept_conflict: 'Outra pessoa acabou de usar este convite. Atualize e tente de novo.',
  token_required: 'Abra o convite pelo link do e-mail.',
  invitation_resend_cooldown: 'Aguarde alguns minutos antes de reenviar.',
  invitation_resend_quota: 'Limite de 5 reenvios em 24 horas atingido. Tente amanhã.',
  invitation_cancel_conflict: 'Outra pessoa acabou de mudar este convite. Atualize a tela.',
  cannot_revoke_owner:
    'Não foi possível remover este responsável. Confira se não é o único da clínica.',
  cannot_revoke_self: 'Você não pode remover o próprio acesso.',
  last_owner_protected:
    'A clínica precisa de pelo menos um responsável. Indique outra pessoa antes de remover ou despromover.',
  not_an_attendant: 'Só atendentes podem ser promovidos a responsável.',
  not_an_owner: 'Só responsáveis podem ser despromovidos a atendente.',
  owner_promote_conflict: 'Outra pessoa acabou de mudar este membro. Atualize a tela.',
  owner_demote_conflict: 'Outra pessoa acabou de mudar este membro. Atualize a tela.',
  invalid_invitation_role: 'Escolha Atendente ou Responsável para o convite.',
  membership_not_found: 'Essa pessoa já não faz parte desta clínica.',
  membership_revoke_conflict: 'Outra pessoa acabou de mudar este membro. Atualize a tela.',
  membership_role_conflict:
    'Essa pessoa já tem outro papel nesta clínica. Use promover ou despromover na lista.',
}

function byStatus(status: number): string | null {
  if (status === 401) return BY_CODE.unauthenticated!
  if (status === 403) return BY_CODE.permission_denied!
  if (status === 404) return BY_CODE.not_found!
  if (status === 409) return CONFLICT
  if (status === 400 || status === 422) return CHECK_DATA
  if (status === 429) return 'Muitas tentativas seguidas. Espere um instante e tente de novo.'
  if (status >= 500) return OUR_SIDE
  return null
}

/** Mensagens já escritas em frase (têm espaço) passam; códigos viram texto. */
function isSentence(text: string): boolean {
  return /\s/.test(text) && !/^[a-z0-9_]+$/.test(text)
}

export function friendlyError(err: unknown, fallback: string = GENERIC): string {
  if (err instanceof PanelApiError) {
    // fetch() sem rede vira PanelApiError(0, 'network', «Failed to fetch»): a mensagem tem espaço e
    // passaria como frase, então a falta de rede é tratada antes.
    if (err.status === 0 && err.code === 'network') return NETWORK
    if (isSentence(err.message)) return err.message
    const byCode = BY_CODE[err.message] ?? (err.code === 'unknown' ? undefined : BY_CODE[err.code])
    return byCode ?? byStatus(err.status) ?? fallback
  }
  // fetch() sem rede lança TypeError («Failed to fetch», «Load failed»).
  if (err instanceof TypeError) return NETWORK
  return fallback
}

/** Código técnico da API (sem status). Para ramificar UI — nunca mostrar cru. */
export function errorCode(err: unknown): string {
  if (err instanceof PanelApiError) {
    return /^[a-z0-9_]+$/.test(err.message) ? err.message : err.code
  }
  return 'unknown'
}

/** Código técnico para «Detalhes para o suporte». Nunca vai no texto principal. */
export function errorDetail(err: unknown): string | null {
  if (err instanceof PanelApiError) {
    const code = errorCode(err)
    return err.status > 0 ? `${code} · HTTP ${err.status}` : code
  }
  if (err instanceof Error && err.message) return err.message
  return null
}

/**
 * Código técnico vindo de dados (ex.: motivo da interrupção do WhatsApp) →
 * texto de recepcionista. Texto livre sem código reconhecido é devolvido
 * apenas se já for uma frase.
 */
export function friendlyReason(reason: string | null | undefined): string | null {
  if (!reason) return null
  if (BY_CODE[reason]) return BY_CODE[reason]
  const status = reason.match(/^meta_http_(\d{3})/)
  if (status) return 'A Meta recusou o envio. Fale com o suporte do Tredane se isso se repetir.'
  if (/^[a-z0-9_]+$/.test(reason)) return null
  return reason
}
