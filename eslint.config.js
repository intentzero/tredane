import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['node_modules/**', 'site/node_modules/**', 'site/dist/**', 'site/.astro/**', 'dist/**', '.wrangler/**', 'coverage/**', '.prova-bundle/**', 'scripts/prova-entries/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['public/sw.js'],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
      },
    },
  },
  {
    files: ['src/**/*.{ts,tsx}', '*.ts', '*.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
      },
    },
  },
  {
    files: ['docs/design/tools/*.mjs', 'site/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // expand_dc.mjs roda DOM (DOMParser/document) via jsdom ou navegador.
    files: ['docs/design/tools/expand_dc.mjs'],
    languageOptions: { globals: { ...globals.browser } },
  },
)
