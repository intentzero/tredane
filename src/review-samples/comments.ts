/**
 * Helpers DEC-167 — serialização / leitura da lista de comentários
 * nas amostras D1 (`client_comments` JSON + `client_comment` 1.º).
 */

export function serializeReviewSampleComments(
  comments: readonly string[] | null | undefined,
): string {
  if (!comments || comments.length === 0) return '[]'
  return JSON.stringify(
    comments
      .filter((c): c is string => typeof c === 'string')
      .map((c) => c.trim())
      .filter((c) => c.length > 0),
  )
}

export function parseReviewSampleComments(
  commentsJson: string | null | undefined,
  firstComment: string | null | undefined,
): string[] {
  if (typeof commentsJson === 'string' && commentsJson.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(commentsJson)
      if (Array.isArray(parsed)) {
        return parsed
          .filter((c): c is string => typeof c === 'string')
          .map((c) => c.trim())
          .filter((c) => c.length > 0)
      }
    } catch {
      /* fallback */
    }
  }
  if (typeof firstComment === 'string' && firstComment.trim() !== '') {
    return [firstComment.trim()]
  }
  return []
}

export function firstClientComment(
  comments: readonly string[] | null | undefined,
  legacy?: string | null,
): string | null {
  if (comments && comments.length > 0) {
    const first = comments[0]
    return typeof first === 'string' && first.trim() !== '' ? first.trim() : null
  }
  if (typeof legacy === 'string' && legacy.trim() !== '') return legacy.trim()
  return null
}
