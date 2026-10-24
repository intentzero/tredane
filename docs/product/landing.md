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
| Títulos acima da escala de tokens (até 68px no topo e 64px nas seções) só no site | **Confirmado** com o desenho |
| **Versões v3 a v7 (24/10/2026):** o mock em `design/landing` é a v7 do canvas; o site acrescenta os conceitos de DEC-045 e DEC-046 e, onde divergirem, vale o site e seus previews. Mensagem orientada a valor (“Cada mensagem no WhatsApp vira um horário na agenda”), seção “Por que o Tredane” (Hoje × Com o Tredane), faixa escura da IA, seção da agenda, sem a palavra “pipeline” (DEC-045) e com as respostas da IA de DEC-046 | **Confirmado** (pedido do responsável) |
| Extensões visuais só do site: sombras, fundo de pontos, faixa escura com `text.primary` de fundo e `line.disabled` como texto secundário | **Confirmado** (24/10/2026) |
| Tecnologia: **Astro**, gerando HTML estático (24/10/2026, escolha do responsável), em `site/`, com pacote próprio e independente do painel; servido por Cloudflare Workers com arquivos estáticos (`site/wrangler.jsonc`, pasta `dist`) | **Confirmado** |
| Sem JavaScript no navegador, sem fontes ou scripts de terceiros; Inter hospedada no próprio site (`@fontsource/inter`, licença SIL OFL, a conferir antes de publicar, [ADR-0013](../adr/0013-design-system-components.md)) | **Proposto** |

## Seções e regras de conteúdo (v7, aprovada em 24/10/2026)

1. **Topo:** marca provisória, atalhos (Como funciona, IA, Agenda, Sinal; escondidos abaixo de 720px), **Entrar** e **Quero participar**.
2. **Abertura:** “Menos peso na recepção. Do primeiro ‘oi’ ao horário marcado.”, selo “Para clínicas de estética e depilação · Piloto aberto”, três garantias, nota “Telas ilustrativas, com nomes e valores fictícios” e composição do produto (`role="img"`, sem controles reais).
3. **O que pesa hoje:** “Atender no WhatsApp cansa. Não precisa ser assim.” Quatro pares “O que fica na sua cabeça × O que o Tredane carrega”. A coluna da esquerda é **hipótese** (VAL-01), a validar antes de publicar; a da direita usa só decisões confirmadas.
4. **Como funciona:** quatro passos, do WhatsApp ao horário confirmado.
5. **IA (faixa escura):** garantias: só sugere e nunca envia; preço só do cadastro; explica com o texto da clínica; saúde vai para a profissional; o mínimo de dados; “Firme e gentil quando preciso” (DEC-046). Mensagens ofensivas têm **só esta menção leve**, por decisão do responsável.
6. **Agenda:** salas, intervalo, bloqueio e próximo horário possível (DEC-008).
7. **Sinal por Pix:** direto na conta da clínica, valor por serviço, confirma ao pagar, política clara (DEC-047).
8. **Rotina da recepção**, **piloto** (“Sua equipe merece terminar o dia mais leve.”), **perguntas frequentes** e **rodapé**.

**Confirmado (24/10/2026):** a página **não** diz que o produto está em desenvolvimento; o público inclui clínicas de depilação; as ilustrações levam a nota “Telas ilustrativas, com nomes e valores fictícios”; mensagens ofensivas aparecem só como uma garantia da IA, sem seção própria.

Toda afirmação da página precisa corresponder a uma decisão confirmada: IA só sugere e uma pessoa envia ([MVP](../MVP.md), DEC-011, ADR-0004); WhatsApp oficial com Embedded Signup (DEC-009); agenda com profissional, sala e intervalo (DEC-008); nome “Acompanhamento” (DEC-045); preço, explicação de procedimentos, assunto clínico e mensagem ofensiva (DEC-046); sinal por Pix na conta da clínica, confirmação ao pagar e prazo de 2 h (DEC-047); PWA (DEC-039, DEC-040); papéis (DEC-020, DEC-042); dados separados por clínica (DEC-038) e suporte por 30 minutos com aprovação (DEC-029, DEC-032). **Não** prometer conformidade com a LGPD, números de clientes, resultados ou funcionalidades fora do MVP (respostas ou agendamentos automáticos, lembretes).

## Critérios de aceite

- **LP-AC-01:** em 360px e 390px de largura não há rolagem horizontal; no computador, o conteúdo fica limitado a 1120px.
- **LP-AC-02:** todos os links e botões têm área de toque de pelo menos 44px e foco visível; a página navega inteira pelo teclado, com link “Ir para o conteúdo”.
- **LP-AC-03:** cores só do [tokens.json](../design/tokens.json), com os pares de contraste já verificados.
- **LP-AC-04:** a página não carrega recursos de terceiros (fontes, scripts, rastreadores).
- **LP-AC-05:** nenhum texto `[A DEFINIR]`, `[A PUBLICAR]` ou endereço `.example` existe na versão publicada.
- **LP-AC-06:** verificador automático de acessibilidade (axe, regras WCAG 2.0 a 2.2 AA e boas práticas) sem violações em 390px e 1440px, e Lighthouse com 100 em acessibilidade, SEO e boas práticas e pelo menos 95 em desempenho (**Confirmado**, 24/10/2026; exigir 100 foi descartado). Medido em 24/10/2026 na v7 com marcadores: axe 0 violações; Lighthouse 100 em acessibilidade, SEO e boas práticas e 99 em desempenho; repetir antes de publicar, e fazer teste manual com leitor de tela (**Em aberto**).
- **LP-AC-07 (SEO):** cada página tem título único, descrição, `lang`, URL canônica, Open Graph com imagem de 1200×630, ícone, `robots.txt`, mapa do site e dados estruturados `Organization` sem informações inventadas.

## Em aberto (bloqueia a publicação, não o desenvolvimento)

| Pergunta | Quem decide |
| --- | --- |
| Domínio do site e endereço do painel para **Entrar** (hoje `app.tredane.example`) | Responsável pelo produto |
| E-mail de contato (hoje `contato@tredane.example`) | Responsável pelo produto |
| Política de privacidade publicada em `/privacidade`; depende do parecer jurídico ([dossiê](legal-review-brief.md)) e do CNPJ (VAL-13); rastreio GATE-03 em [pilot-gates.md](pilot-gates.md) | Responsável pelo produto + advogado |
| Condições e preço do piloto (não inventar valores neste repositório) | Responsável pelo produto |
| Logo e marca definitivos (hoje provisórios) | Responsável pelo produto |
| Domínio real em `SITE_URL` (canônica, Open Graph e mapa do site usam o padrão `tredane.example` até lá) e endereço do painel em `PUBLIC_APP_URL`, e-mail em `PUBLIC_CONTACT_EMAIL` | Responsável pelo produto |
| Medição de visitas: só com ferramenta sem cookies e após a política de privacidade | Responsável pelo produto |
