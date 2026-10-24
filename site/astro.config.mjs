import { defineConfig } from 'astro/config'
import sitemap from '@astrojs/sitemap'

// SITE_URL vem do ambiente de publicação. O valor padrão é um domínio de exemplo e
// não deve ser publicado (LP-AC-05 em docs/product/landing.md).
export default defineConfig({
  site: process.env.SITE_URL ?? 'https://tredane.example',
  integrations: [sitemap()],
  build: { inlineStylesheets: 'auto' },
})
