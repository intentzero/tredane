# Landing page do piloto

**Estado:** desenho **Confirmado** pelo responsável pelo produto em 24/10/2026 ([DEC-044](decisions.md)); implementação **Proposta** em `site/`; **não publicar** antes de fechar os itens em aberto abaixo. A landing page é um item novo, fora do fluxo piloto do [MVP](../MVP.md): não muda o recorte do painel.

## Objetivo e público

Atrair clínicas de estética para o piloto. Leitora principal: dona ou responsável pela recepção da clínica, lendo no celular. Ação esperada: entrar em contato com o Tredane pelo botão **Falar com o Tredane**.

## Decisões (DEC-044, 24/10/2026)

| Item | Estado |
| --- | --- |
| Objetivo: atrair clínicas para o piloto, com contato por e-mail e **sem formulário** (não coleta dados pessoais antes da política de privacidade) | **Confirmado** |
| Visual do design system do painel ([tokens.json](../design/tokens.json)); a tela escura da F0 em `src/client` não é referência | **Confirmado** |
| Site separado do painel | **Confirmado** |
| Desenho aprovado: [mock](../design/landing/Main.dc.html) e previews em [design/landing/previews](../design/landing/previews/) | **Confirmado** |
| Títulos acima da escala de tokens (até 60px no topo e 36px nas seções) só no site | **Confirmado** com o desenho |
| Tecnologia: **Astro**, gerando HTML estático (24/10/2026, escolha do responsável), em `site/`, com pacote próprio e independente do painel; servido por Cloudflare Workers com arquivos estáticos (`site/wrangler.jsonc`, pasta `dist`) | **Confirmado** |
| Sem JavaScript no navegador, sem fontes ou scripts de terceiros; Inter hospedada no próprio site (`@fontsource/inter`, licença SIL OFL, a conferir antes de publicar, [ADR-0013](../adr/0013-design-system-components.md)) | **Proposto** |

## Seções e regras de conteúdo

1. **Topo:** marca provisória, **Entrar** (vai para o painel) e **Quero participar** (rola até o piloto).
2. **Abertura:** título, texto curto e ilustração do painel com sugestão da IA e horário agendado. A ilustração é uma imagem descrita (`role="img"`), sem controles reais.
3. **Como funciona:** quatro passos, do WhatsApp ao horário confirmado.
4. **Feito para a rotina da recepção:** tempo real, uso no navegador do celular, papéis e dados separados por clínica.
5. **Participe do piloto:** o que a clínica recebe e o que pedimos.
6. **Perguntas frequentes** (`<details>` nativo) e **rodapé**.

Toda afirmação da página precisa corresponder a uma decisão confirmada: IA só sugere e uma pessoa envia ([MVP](../MVP.md), DEC-011, ADR-0004); WhatsApp oficial com Embedded Signup (DEC-009); agenda com profissional, sala e intervalo (DEC-008); PWA (DEC-039, DEC-040); papéis (DEC-020, DEC-042); dados separados por clínica (DEC-038) e suporte por 30 minutos com aprovação (DEC-029, DEC-032). **Não** prometer conformidade com a LGPD, números de clientes, resultados ou funcionalidades fora do MVP (respostas ou agendamentos automáticos, lembretes).

## Critérios de aceite

- **LP-AC-01:** em 360px e 390px de largura não há rolagem horizontal; no computador, o conteúdo fica limitado a 1120px.
- **LP-AC-02:** todos os links e botões têm área de toque de pelo menos 44px e foco visível; a página navega inteira pelo teclado, com link “Ir para o conteúdo”.
- **LP-AC-03:** cores só do [tokens.json](../design/tokens.json), com os pares de contraste já verificados.
- **LP-AC-04:** a página não carrega recursos de terceiros (fontes, scripts, rastreadores).
- **LP-AC-05:** nenhum texto `[A DEFINIR]`, `[A PUBLICAR]` ou endereço `.example` existe na versão publicada.
- **LP-AC-06:** verificador automático de acessibilidade (axe, regras WCAG 2.0 a 2.2 AA e boas práticas) sem violações em 390px e 1440px, e Lighthouse com 100 em acessibilidade, SEO, boas práticas e desempenho. Medido em 24/10/2026 sobre a versão com marcadores; repetir antes de publicar, e fazer teste manual com leitor de tela (**Em aberto**).
- **LP-AC-07 (SEO):** cada página tem título único, descrição, `lang`, URL canônica, Open Graph com imagem de 1200×630, ícone, `robots.txt`, mapa do site e dados estruturados `Organization` sem informações inventadas.

## Em aberto (bloqueia a publicação, não o desenvolvimento)

| Pergunta | Quem decide |
| --- | --- |
| Domínio do site e endereço do painel para **Entrar** (hoje `app.tredane.example`) | Responsável pelo produto |
| E-mail de contato (hoje `contato@tredane.example`) | Responsável pelo produto |
| Política de privacidade publicada em `/privacidade`; depende do parecer jurídico ([dossiê](legal-review-brief.md)) e do CNPJ (VAL-13) | Responsável pelo produto + advogado |
| Condições e preço do piloto | Responsável pelo produto |
| Logo e marca definitivos (hoje provisórios) | Responsável pelo produto |
| Domínio real em `SITE_URL` (canônica, Open Graph e mapa do site usam o padrão `tredane.example` até lá) e endereço do painel em `PUBLIC_APP_URL`, e-mail em `PUBLIC_CONTACT_EMAIL` | Responsável pelo produto |
| Medição de visitas: só com ferramenta sem cookies e após a política de privacidade | Responsável pelo produto |
