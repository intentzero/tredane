#!/usr/bin/env node
/** Copia docs/design/tokens.css → src/client/ui/tokens.css após build_tokens.py. */
import { copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const from = join(root, 'docs/design/tokens.css')
const to = join(root, 'src/client/ui/tokens.css')
copyFileSync(from, to)
console.log('Synced tokens.css → src/client/ui/tokens.css')
