export function formatPhone(display: string | null | undefined): string {
  if (!display) return '—'
  return display
}

export function formatWhen(ms: number | null | undefined): string {
  if (ms == null) return '—'
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'America/Sao_Paulo',
    }).format(new Date(ms))
  } catch {
    return new Date(ms).toISOString()
  }
}

export function historyLabel(action: string): string {
  switch (action) {
    case 'connected':
    case 'connected_replace':
    case 'reconnected_new_number':
      return 'Conectado'
    case 'reconnected':
      return 'Reconectado'
    case 'disconnected':
      return 'Desconectado'
    case 'interrupted':
      return 'Conexão interrompida'
    case 'replaced_released':
    case 'released_for_reconnect':
      return 'Número anterior liberado'
    case 'connect_rejected_phone_in_use':
      return 'Este número já está conectado a outra clínica'
    default:
      return action
  }
}
