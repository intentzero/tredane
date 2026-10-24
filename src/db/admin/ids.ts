/** IDs sintéticos estáveis o bastante para D1 local (não são UUIDv7 canónicos). */
export function newId(prefix: string): string {
  const rand = crypto.getRandomValues(new Uint8Array(12))
  let hex = ''
  for (const b of rand) hex += b.toString(16).padStart(2, '0')
  return `${prefix}_${hex}`
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}
