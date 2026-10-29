/**
 * Link do Google Business da clínica (contexto da IA). Partilhado entre o
 * backend (validação autoritativa) e o painel (validação imediata). Sem imports
 * para poder ser usado no cliente.
 */
export const GOOGLE_BUSINESS_URL_MAX_LENGTH = 500

export type GoogleBusinessUrlCheck = { ok: true; value: string } | { ok: false; message: string }

/** Vazio = sem link. Senão: URL https absoluta, sem credenciais nem espaços, até 500 caracteres. */
export function checkGoogleBusinessUrl(raw: string): GoogleBusinessUrlCheck {
  const value = raw.trim()
  if (value === '') return { ok: true, value: '' }
  if (value.length > GOOGLE_BUSINESS_URL_MAX_LENGTH) {
    return {
      ok: false,
      message: `O link do Google Business pode ter no máximo ${GOOGLE_BUSINESS_URL_MAX_LENGTH} caracteres.`,
    }
  }
  const invalid = {
    ok: false as const,
    message: 'Informe um link válido começando com https:// (ex.: https://maps.app.goo.gl/…).',
  }
  if (/\s/.test(value) || !/^https:\/\//i.test(value)) return invalid
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return invalid
  }
  if (url.protocol !== 'https:' || !url.hostname.includes('.') || url.username || url.password) {
    return invalid
  }
  return { ok: true, value }
}
