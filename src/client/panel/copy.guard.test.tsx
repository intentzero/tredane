import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Textos da tela: português do Brasil e sem jargão interno.
 * Comentários de código ficam de fora; só o que pode chegar à tela é verificado.
 */
const ROOT = join(__dirname)
// Telas de desenvolvimento (login sintético) não são vistas pelas clínicas.
const IGNORED = ['auth/SyntheticLogin.tsx']

const BANNED: Array<[RegExp, string]> = [
  [/\bDEC-\d+/, 'código de decisão (DEC-…)'],
  [/\bGATE-\d+/, 'código de gate (GATE-…)'],
  [/\bM-\d{2}\b/, 'ID de mock (M-…)'],
  [/Embedded Signup/, '«Embedded Signup»'],
  [/Tech Provider/, '«Tech Provider»'],
  [/\bfixtures\b/i, '«fixtures»'],
  [/\bWABA\b/, '«WABA»'],
  [/\bbackend\b/i, '«backend»'],
  [/A (carregar|abrir|preparar|sincronizar|identificar)\b/, 'português de Portugal («A carregar…»)'],
  [/\bcontactos?\b/i, '«contacto» (use «contato»)'],
  [/\bec[rr]ã/i, '«ecrã» (use «tela»)'],
  [/\b[Aa]ctiv[oa]s?\b/, '«activo» (use «ativo»)'],
  [/\butilizador/i, '«utilizador» (use «usuário»)'],
  [/\bestorno\b/i, '«estorno» (use «devolução»)'],
]

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return walk(full)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : []
  })
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

describe('textos da interface', () => {
  const files = walk(ROOT).filter((f) => !IGNORED.some((i) => f.endsWith(i)))

  it('encontra os arquivos do painel', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  for (const [re, label] of BANNED) {
    it(`não usa ${label}`, () => {
      const hits = files.flatMap((f) =>
        stripComments(readFileSync(f, 'utf8'))
          .split('\n')
          .filter((line) => re.test(line))
          .map((line) => `${f.slice(ROOT.length + 1)}: ${line.trim()}`),
      )
      expect(hits).toEqual([])
    })
  }
})
