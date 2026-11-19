# Central de ajuda (`help/`)

**Estado:** desenho **Proposto** (DEC-207, 19/11/2026, escolhas de Paulo nesta conversa de planeamento); implementação inicial **Proposta** em `help/`; **não publicar em produção** antes de Paulo rever o conteúdo e confirmar a DEC-207.

## Objetivo e público

Um manual estático, pesquisável e público, com passo a passo das jornadas principais, perguntas frequentes e soluções, para ajudar o onboarding e a operação. Públicos da primeira versão (**Proposto**): **responsável** pela clínica, **equipe** (atendente) e **cliente** da clínica (página web da cliente, quando estiver em produção).

## Decisões propostas (DEC-207)

| Item | Estado |
| --- | --- |
| Domínio próprio `ajuda.tredane.com` (staging: `staging.ajuda.tredane.com`), projeto `help/` separado da landing (`site/`) e do painel | **Proposto** |
| Astro + Starlight (sidebar, busca Pagefind sem serviço externo, navegação móvel), em pt-BR | **Proposto** |
| Visual do painel: tokens de `docs/design/tokens.json` (via `src/client/ui/tokens.css`), Roboto (DEC-073), logotipo de `docs/design/brand/` | **Proposto** |
| Imagens: capturas reais do tenant demo em 390×844, geradas por script e refeitas quando a tela muda | **Proposto**; ainda por implementar |
| Ligação do painel ao manual («Ajuda» no menu da conta e links «?» por tela) | **Proposto**, fase posterior; URLs dos artigos ficam estáveis desde já |

## Regra de publicação

Só o que está **Confirmado** e já em produção vai para `ajuda.tredane.com`. Artigo de funcionalidade **Proposta** ou só em staging (por exemplo a página web da cliente, ADR-0018) leva `estado: proposto` e `draft: true`: só entra no build de staging (`HELP_DRAFTS=1`). `help/scripts/check-estado.mjs` falha o build se faltar `draft: true` nesse caso ou se faltar `description`. O validador de links falha o build de produção se uma página publicada apontar para um rascunho.

## Modelo de artigo

Frontmatter: `title`, `description`, `papel` (`responsavel` | `equipe` | `cliente`), `telas` (TEL-xx, M-xx), `jornadas` (JRN-xx), `estado`, `revisado`. Corpo: «Quando usar», passos numerados, «O que pode dar errado», relacionados. Cada texto vem de `docs/product/ux-ui.md` e das DEC citadas, e os rótulos de botões vêm do painel (`src/client/panel`).

## Estrutura do índice

Página inicial com busca grande, cartões «Eu sou…» e lista «Como faço para…». Seções: Primeiros passos · Atender conversas · Acompanhar oportunidades · Agenda · Clientes · Configurar a clínica · Para a cliente · Resolver problemas · Perguntas frequentes · Glossário. **Publicado até agora:** Primeiros passos e Atender conversas (parcial). O restante é **Em aberto** (fases 2 e 3 do plano).

## Manutenção

Quem altera uma tela do painel atualiza os artigos cujo `telas:` a inclui (`grep -r "TEL-01" help/src/content/docs`).

## Critérios de aceite

| ID | Critério |
| --- | --- |
| AJ-AC-01 | `npm run check` e `npm run build:production` em `help/` passam, sem links quebrados e sem rascunhos em produção. |
| AJ-AC-02 | A busca encontra cada tarefa do índice por um nome comum («remarcar», «WhatsApp», «convidar»). |
| AJ-AC-03 | axe com 0 violações e Lighthouse acessibilidade e SEO ≥ 95 na página inicial e em um artigo, em 390 e 1440 px. **Medido em 19/11/2026:** axe com 0 violações em 4 páginas, a 390 e 1440 px, sem rolagem horizontal; tema escuro e Lighthouse **Em aberto**. |
| AJ-AC-04 | Nenhum dado real de clínica ou cliente em texto ou imagem. |
| AJ-AC-05 | Staging com `noindex`. |

## Em aberto

- Revisão do conteúdo por Paulo e confirmação da DEC-207.
- Pipeline de capturas (Playwright contra o tenant demo) e artigos de Agenda, Acompanhar, Clientes, Configurar a clínica, Resolver problemas, FAQ e Glossário.
- Provisionar o DNS `ajuda.tredane.com` e os environments do GitHub antes do primeiro deploy.
- Link no rodapé da landing e entrada «Ajuda» no painel.
