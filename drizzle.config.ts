import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './db/migrations',
  // Geração futura exige primeiro estabelecer o baseline Drizzle;
  // o SQL versionado em db/migrations é atualmente a fonte das migrações.
})
