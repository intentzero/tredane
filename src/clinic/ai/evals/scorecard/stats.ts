/**
 * Estatística mínima para KPIs de avaliação (metodologia §5).
 *
 * - pass^k (τ-bench, Yao et al., ICLR 2025): probabilidade de as k repetições
 *   do mesmo caso passarem TODAS. Mede consistência, não sorte.
 * - Intervalo de Wilson: IC de uma proporção com amostras pequenas
 *   (o CLT subestima a incerteza abaixo de algumas centenas de casos).
 * - Correção de Rogan-Gladen: taxa verdadeira a partir da taxa do juiz LLM,
 *   dada a sensibilidade/especificidade medidas contra rótulos humanos.
 */

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  let r = 1
  for (let i = 1; i <= k; i += 1) r = (r * (n - k + i)) / i
  return r
}

/** Estimador não enviesado de pass^k para um caso: C(c,k)/C(n,k). */
export function passHatKCase(n: number, c: number, k: number): number | null {
  if (k < 1 || n < k) return null
  return choose(c, k) / choose(n, k)
}

/** Média de pass^k entre casos; ignora casos com menos de k repetições. */
export function passHatK(cases: Array<{ n: number; c: number }>, k: number): number | null {
  const vals = cases.map((x) => passHatKCase(x.n, x.c, k)).filter((v): v is number => v != null)
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

/** IC de Wilson a 95 % (z = 1,96) para `successes` em `total`. */
export function wilson(successes: number, total: number, z = 1.96): { low: number; high: number } | null {
  if (total === 0) return null
  const p = successes / total
  const z2 = z * z
  const den = 1 + z2 / total
  const centre = (p + z2 / (2 * total)) / den
  const half = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / den
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) }
}

/**
 * Rogan-Gladen: θ = (p_obs + TNR − 1) / (TPR + TNR − 1), limitado a [0,1].
 * Só é válido com TPR + TNR > 1; caso contrário devolve null (juiz inútil).
 */
export function correctJudgeRate(observed: number, tpr: number, tnr: number): number | null {
  const j = tpr + tnr - 1
  if (j <= 0) return null
  return Math.min(1, Math.max(0, (observed + tnr - 1) / j))
}
