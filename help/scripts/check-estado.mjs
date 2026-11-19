// Regra de publicação da central de ajuda (docs/product/ajuda.md):
// só o que está Confirmado e em produção vai para ajuda.tredane.com.
// Falha se um artigo com `estado: proposto` não tiver `draft: true`,
// ou se faltar `description` (usada pela busca e pelos cartões).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = fileURLToPath(new URL('../src/content/docs/', import.meta.url))

function arquivos(dir) {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) return arquivos(caminho)
    return /\.mdx?$/.test(nome) ? [caminho] : []
  })
}

function frontmatter(texto) {
  const m = texto.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return null
  const campos = {}
  for (const linha of m[1].split(/\r?\n/)) {
    const kv = linha.match(/^([A-Za-z_]+):\s*(.*)$/)
    if (kv) campos[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, '')
  }
  return campos
}

const erros = []
for (const arquivo of arquivos(raiz)) {
  const nome = relative(raiz, arquivo)
  const fm = frontmatter(readFileSync(arquivo, 'utf8'))
  if (!fm) {
    erros.push(`${nome}: sem frontmatter`)
    continue
  }
  if (!fm.description) erros.push(`${nome}: falta description`)
  if (fm.estado === 'proposto' && fm.draft !== 'true') {
    erros.push(`${nome}: estado proposto precisa de draft: true (não pode ir para produção)`)
  }
}

if (erros.length) {
  console.error('check-estado: artigos fora da regra de publicação\n- ' + erros.join('\n- '))
  process.exit(1)
}
console.log(`check-estado: ${arquivos(raiz).length} artigos OK`)
