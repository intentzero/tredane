import { defineCollection } from 'astro:content'
import { z } from 'astro/zod'
import { docsLoader } from '@astrojs/starlight/loaders'
import { docsSchema } from '@astrojs/starlight/schema'

// Metadados de cada artigo (docs/product/ajuda.md, «Modelo de artigo»).
// - papel: quem usa o passo a passo; vira etiqueta no topo.
// - telas / jornadas: ligam o artigo à spec (TEL-xx, M-xx, JRN-xx) para manutenção.
// - estado: só «confirmado» é publicado em produção; «proposto» exige draft: true (scripts/check-estado.mjs).
// HELP_DRAFTS=1 (build de staging) publica também os rascunhos.
const showDrafts = process.env.HELP_DRAFTS === '1'

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: (ctx) =>
      docsSchema({
        extend: z.object({
          papel: z.array(z.enum(['responsavel', 'equipe', 'cliente'])).default([]),
          telas: z.array(z.string()).default([]),
          jornadas: z.array(z.string()).default([]),
          estado: z.enum(['confirmado', 'proposto']).default('confirmado'),
          revisado: z.coerce.date().optional(),
        }),
      })(ctx).transform((data) => (showDrafts ? { ...data, draft: false } : data)),
  }),
}
