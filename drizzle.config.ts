import { defineConfig } from 'drizzle-kit'

/**
 * Baseline Drizzle em `db/migrations/meta/` cobre 0001+0002 sem regenerar esse SQL.
 * Novas alterações: atualizar `src/db/schema.ts` e `npm run db:generate`, depois
 * rever o SQL (CHECKs/ordem) antes de commit. Wrangler aplica os `.sql` versionados.
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './db/migrations',
})
