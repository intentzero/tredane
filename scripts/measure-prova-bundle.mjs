#!/usr/bin/env node
/**
 * Mede o tamanho gzip aproximado das dependências de cada candidata
 * (entrada mínima que importa as telas M-04/M-05). Resultado em stdout e
 * docs/adr/prova-bundle-latest.json.
 */
import { build } from 'vite'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, '.prova-bundle')
const require = createRequire(import.meta.url)

async function measure(name, entryRelative) {
  const entry = join(root, entryRelative)
  await build({
    root,
    logLevel: 'error',
    build: {
      outDir: join(outDir, name),
      emptyOutDir: true,
      cssCodeSplit: false,
      rollupOptions: {
        input: entry,
        output: {
          entryFileNames: 'entry.js',
          chunkFileNames: 'chunks/[name].js',
          assetFileNames: 'assets/[name][extname]',
          format: 'es',
        },
      },
      minify: true,
      write: true,
    },
    // Sem Cloudflare plugin — só JS das candidatas
    plugins: [require('@vitejs/plugin-react')()],
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  })

  const dir = join(outDir, name)
  const { readdirSync, statSync } = await import('node:fs')
  function walk(d) {
    const files = []
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      if (statSync(p).isDirectory()) files.push(...walk(p))
      else if (p.endsWith('.js') || p.endsWith('.css')) files.push(p)
    }
    return files
  }
  let raw = 0
  let gzip = 0
  for (const file of walk(dir)) {
    const buf = readFileSync(file)
    raw += buf.length
    gzip += gzipSync(buf).length
  }
  return { name, rawBytes: raw, gzipBytes: gzip }
}

mkdirSync(join(root, 'scripts'), { recursive: true })

// entradas temporárias
mkdirSync(join(root, 'scripts/prova-entries'), { recursive: true })
writeFileSync(
  join(root, 'scripts/prova-entries/radix.tsx'),
  `import { createRoot } from 'react-dom/client'
import { RadixAgendar } from '../../src/client/prova/radix/Agendar'
import { RadixAcompanhamento } from '../../src/client/prova/radix/Acompanhamento'
import '../../src/client/ui/panel.css'
createRoot(document.getElementById('root')!).render(<><RadixAgendar /><RadixAcompanhamento /></>)
`,
)
writeFileSync(
  join(root, 'scripts/prova-entries/react-aria.tsx'),
  `import { createRoot } from 'react-dom/client'
import { ReactAriaAgendar } from '../../src/client/prova/react-aria/Agendar'
import { ReactAriaAcompanhamento } from '../../src/client/prova/react-aria/Acompanhamento'
import '../../src/client/ui/panel.css'
createRoot(document.getElementById('root')!).render(<><ReactAriaAgendar /><ReactAriaAcompanhamento /></>)
`,
)

const radix = await measure('radix', 'scripts/prova-entries/radix.tsx')
const reactAria = await measure('react-aria', 'scripts/prova-entries/react-aria.tsx')

const report = {
  measuredAt: new Date().toISOString(),
  method: 'vite production build of M-04+M-05 per candidate; sum of .js/.css gzip',
  candidates: { radix, reactAria },
  deltaGzipBytes: reactAria.gzipBytes - radix.gzipBytes,
}

writeFileSync(join(root, 'docs/adr/prova-bundle-latest.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
