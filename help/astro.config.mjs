import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import starlightLinksValidator from 'starlight-links-validator'

// Central de ajuda pública (docs/product/ajuda.md). Site estático, sem Worker nem dados.
// SITE_URL vem do ambiente de publicação; o padrão é um domínio de exemplo e não deve ser publicado.
const noindex = process.env.PUBLIC_NOINDEX === '1'

export default defineConfig({
  site: process.env.SITE_URL ?? 'https://ajuda.tredane.example',
  integrations: [
    starlight({
      title: 'Ajuda Tredane',
      description: 'Passo a passo, perguntas frequentes e soluções para usar o Tredane na clínica.',
      defaultLocale: 'root',
      locales: { root: { label: 'Português', lang: 'pt-BR' } },
      logo: {
        light: './src/assets/logo-claro.svg',
        dark: './src/assets/logo-escuro.svg',
        alt: 'Tredane',
      },
      favicon: '/favicon.svg',
      head: [
        { tag: 'link', attrs: { rel: 'icon', href: '/favicon.ico', sizes: '32x32' } },
        ...(noindex ? [{ tag: 'meta', attrs: { name: 'robots', content: 'noindex, nofollow' } }] : []),
      ],
      customCss: ['@fontsource/roboto/400.css', '@fontsource/roboto/500.css', '@fontsource/roboto/700.css', './src/styles/tema.css'],
      components: {
        PageTitle: './src/components/PageTitle.astro',
      },
      lastUpdated: false,
      pagination: true,
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      sidebar: [
        { label: 'Primeiros passos', items: [{ autogenerate: { directory: 'comecar' } }] },
        { label: 'Atender conversas', items: [{ autogenerate: { directory: 'conversas' } }] },
      ],
      plugins: [starlightLinksValidator({ errorOnLocalLinks: false })],
    }),
  ],
})
