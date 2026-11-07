#!/usr/bin/env node
/**
 * Monta o comentário do scorecard L1 para um PR (metodologia de avaliação §7, DEC-146).
 * Só informa: não decide o merge. Lê `.eval/l1-latest.json` e `.eval/l1-comparison.json`
 * (gravados por `npm run eval:scorecard`) e a lista de ficheiros alterados no PR.
 *
 *   node scripts/scorecard-comment.mjs <ficheiros-alterados.txt> [saida.md]
 *
 * Sem dependências além do Node. Não chama a rede.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

export const MARKER = '<!-- scorecard-l1 -->'

const MONITORED = [/^src\/clinic\/ai\//, /^src\/whatsapp\/flow\//, /^src\/clinic\/proposals\//]
const EVALS = /^src\/clinic\/ai\/evals\//
const TEST = /\.test\.tsx?$/

const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)} %`)
const num = (v) => (v == null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(3))

const VERDICT = {
  bloqueia: ['⛔', 'Bloqueia (invariante violada ou caso a falhar)'],
  regressao: ['⚠️', 'Regressão informativa (DEC-139: justificar ou corrigir no PR)'],
  melhoria: ['✅', 'Melhoria'],
  igual: ['＝', 'Sem mudança'],
}

/** Ficheiros de comportamento alterados (não testes, não harness) e se há caso L1 novo. */
export function coverageNote(changed) {
  const behaviour = changed.filter(
    (f) => MONITORED.some((re) => re.test(f)) && !EVALS.test(f) && !TEST.test(f),
  )
  const touchedEvals = changed.some((f) => EVALS.test(f))
  return { behaviour, touchedEvals }
}

export function buildComment({ latest, comparison, changed, runFailed }) {
  const out = [MARKER, '### Scorecard L1', '']
  const k = latest?.kpis
  if (!k) {
    out.push(
      '⚠️ O scorecard não produziu resultado (o L1 não chegou ao fim). Ver o registo do job.',
      '',
      '_Informativo: este comentário não bloqueia o merge._',
    )
    return out.join('\n')
  }

  const verdict = comparison?.verdict ?? (runFailed ? 'bloqueia' : 'igual')
  const [icon, label] = VERDICT[verdict] ?? ['', verdict]
  out.push(`**${icon} ${label}**`, '')
  if (comparison) {
    const sha = String(comparison.baselineCommit ?? '').replace('+dirty', '').slice(0, 7)
    out.push(
      comparison.baselineSource === 'base'
        ? `_Comparado com uma corrida da branch base${sha ? ` (\`${sha}\`)` : ''}: só aparece o que este PR muda._`
        : `_Comparado com a linha de base gravada${sha ? ` (\`${sha}\`)` : ''}: pode estar atrás da \`main\` e mostrar mudanças de outros PRs._`,
      '',
    )
  }
  out.push(
    `Casos: **${k.casesPassed}/${k.casesExecuted}** passam · ${k.casesKnownFailure} falha(s) conhecida(s) · ` +
      `${k.casesPending} pendente(s) · ${k.casesCovered} coberto(s) fora · invariantes violadas: **${k.invViolations}**`,
    '',
    '| KPI | Valor |',
    '| --- | --- |',
    `| Sucesso (EF-01) | ${pct(k.successRate)} |`,
    `| Turnos excedentes p50 / p90 | ${num(k.excessTurnsP50)} / ${num(k.excessTurnsP90)} |`,
    `| Mensagens com mais de uma pergunta | ${pct(k.multiQuestionPct)} |`,
    `| Mensagens concisas | ${pct(k.concisePct)} |`,
    `| Proposta = pedido | ${pct(k.bookingMatchRate)} |`,
    '',
  )

  if (comparison) {
    const rows = (list) =>
      list.map((c) => `- ${c.gate ? '⛔ ' : ''}\`${c.key}\`: ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`)
    if (comparison.regressions.length) {
      out.push(`**Regressões (${comparison.regressions.length})**`, ...rows(comparison.regressions), '')
    }
    if (comparison.progressions.length) {
      const shown = comparison.progressions.slice(0, 8)
      out.push(
        `<details><summary>Progressões (${comparison.progressions.length})</summary>`,
        '',
        ...rows(shown),
        ...(comparison.progressions.length > shown.length ? [`- … e mais ${comparison.progressions.length - shown.length}`] : []),
        '',
        '</details>',
        '',
      )
    }
    if (comparison.fingerprintChanges?.length) {
      out.push(`**Versão alterada** (atribuir mudanças a): ${comparison.fingerprintChanges.map((f) => `\`${f}\``).join(', ')}`, '')
    }
  } else {
    out.push('_Sem linha de base para comparar._', '')
  }

  const { behaviour, touchedEvals } = coverageNote(changed)
  if (behaviour.length > 0 && !touchedEvals) {
    out.push(
      '**⚠️ Sem caso L1 novo.** Este PR altera comportamento conversacional ' +
        `(${behaviour.slice(0, 3).map((f) => `\`${f}\``).join(', ')}${behaviour.length > 3 ? ` e mais ${behaviour.length - 3}` : ''}) ` +
        'e não toca em `src/clinic/ai/evals/`. A metodologia pede um caso L1 por comportamento novo ou corrigido ' +
        `([metodologia](https://github.com/${process.env.GITHUB_REPOSITORY ?? 'intentzero/tredane'}/blob/main/docs/implementation/metodologia-avaliacao-conversacional.md)). ` +
        'Se não se aplica, diga porquê no PR.',
      '',
    )
  }

  out.push(
    '_Informativo (DEC-146): este comentário não bloqueia o merge. As invariantes continuam a bloquear pelo `npm test` (DEC-108)._',
  )
  return out.join('\n')
}

function readJson(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [changedFile, outFile = 'scorecard-comment.md'] = process.argv.slice(2)
  const changed = changedFile && existsSync(changedFile)
    ? readFileSync(changedFile, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
    : []
  const body = buildComment({
    latest: readJson('.eval/l1-latest.json'),
    comparison: readJson('.eval/l1-comparison.json'),
    changed,
    runFailed: process.env.SCORECARD_RUN_FAILED === '1',
  })
  writeFileSync(outFile, `${body}\n`)
  console.log(`Comentário gravado em ${outFile} (${body.length} caracteres)`)
}
