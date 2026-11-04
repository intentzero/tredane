# Landing page do piloto

**Estado:** desenho **Confirmado** pelo responsável pelo produto em 24/10/2026 ([DEC-044](decisions.md)); implementação **Proposta** em `site/`; **não publicar** antes de fechar os itens em aberto abaixo. A landing page é um item novo, fora do fluxo piloto do [MVP](../MVP.md): não muda o recorte do painel.

## Objetivo e público

Atrair clínicas de estética para o piloto. Leitora principal: dona ou responsável pela recepção da clínica, lendo no celular. Ação esperada: abrir uma conversa com o Tredane pelo botão **Conversar no WhatsApp** (revisão de 04/11/2026; antes, **Falar com o Tredane** por e-mail).

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
| Sem JavaScript no navegador, sem fontes ou scripts de terceiros; Geist hospedada no próprio site (`@fontsource/geist`, licença SIL OFL, a conferir antes de publicar, [ADR-0013](../adr/0013-design-system-components.md)) | **Proposto** |

## Revisão visual e de copy (04/11/2026)

- **Direção «Luz»** (fundo quase branco, texto Tinta, Petróleo só na ação, Damasco em um único detalhe, cantos arredondados): escolhida entre três aberturas apresentadas em conversa com o responsável pelo produto ("Opção 1 · Luz", 04/11/2026). **Confirmado** como direção visual; o mock aprovado está no canvas de design e **ainda não** foi exportado para `docs/design/landing` (os `.dc.html` e previews de lá seguem na v7 e ficam **desatualizados** até essa exportação).
- **Fonte:** Geist (Google Fonts, licença SIL OFL) hospedada no próprio site, no lugar da Inter, só no site; o painel segue em Roboto (DEC-073). **Proposto**; conferir a licença antes de publicar.
- **Cores:** só a paleta da marca (DEC-050) e neutros próprios do site (`#FAFAF8`, `#E4E6E3`, `#5A6463`); Damasco nunca como texto sobre claro (contraste 2,31 : 1). **Proposto**; rodar a verificação de contraste antes de publicar.
- **Copy:** nova mensagem «A cliente marca pelo WhatsApp. A recepção respira.», seção de atendimento automático, seção «Para a recepção» (Assumir/Devolver, «Precisa de alguém», prefixo `[Nome]` da DEC-088) e perguntas frequentes revistas. **Proposto**.
- **Abertura escura (04/11/2026):** o responsável pelo produto achou a abertura «Luz» sem impacto e cortada no celular, e pediu a implementação («Implementa») da proposta do [canvas do hero](https://claude.ai/artifact/2UEbhagS5CAvf3eLzCRMCM) (privado). **Confirmado** só para o topo e a abertura: fundo Tinta `#101817` com brilhos de Petróleo e Damasco, título alinhado à esquerda com «A recepção respira.» em Damasco (Damasco sobre Tinta 6,9 : 1), um botão principal Damasco com texto Tinta, «Ver como funciona» como link, selo curto abaixo de 520px e cena ilustrativa (mensagem, proposta com Confirmar, «Na agenda · Marcado pela IA» e, no computador, «Precisa de alguém») no lugar do telefone, que ficava cortado. O resto da página continua «Luz». Neutros escuros novos, só do site: `#B7C1BF`, `#D5DCDB`, `#2A3534`. A copy não mudou. Medido em 04/11/2026: axe sem violações em 390px e 1440px e sem rolagem horizontal em 360px e 390px; o Lighthouse ainda está **Em aberto**.
- **Sem alteração:** o resto das decisões da DEC-044 (sem formulário, e-mail como contato, sem «em desenvolvimento», nota «Telas ilustrativas, com nomes e valores fictícios»).
- **Em aberto (bloqueia a publicação):** os mesmos itens da tabela final, mais a regeneração de `og-image.png` (ainda mostra a identidade antiga) e a nova medição de LP-AC-06.

## Revisão de comunicação (04/11/2026, segunda rodada)

Origem: review da landing pedido pelo responsável pelo produto ([canvas do review](https://claude.ai/artifact/UhYFee8eHZFztYAb2UAPGy), privado) e «Sim, implementa» em 04/11/2026. **Confirmado** como estrutura e copy do site; os itens abaixo marcados **Em aberto** continuam bloqueando a publicação.

- **Estrutura em 7 blocos** (eram 13): 1. Abertura; 2. «Uma conversa inteira» (história de uma cliente fictícia, Lívia, das 21:47 às 08:00) com «O que muda para a clínica»; 3. «Você continua no controle» (único lugar das garantias de atendimento); 4. «A equipe e a agenda» (caixa de conversas e agenda lado a lado, mais quatro fatos curtos); 5. Sinal por Pix; 6. Piloto; 7. Perguntas frequentes. Saíram «O que pesa hoje» (hipótese VAL-01 não validada), «Como funciona» (absorvido pela história) e a grade de rotina.
- **Motivo:** a garantia «só marca com o toque da cliente» aparecia cinco vezes e soava defensiva; a página falava com a recepção, mas quem decide o piloto é a dona; cada ilustração tinha outra cliente; todos os H2 tinham o mesmo peso.
- **Leitora:** a dona continua sendo a leitora principal; a recepção aparece como cenário.
- **CTA:** **«Conversar no WhatsApp»** (link `wa.me` do próprio Tredane, `PUBLIC_WHATSAPP_URL`) no topo, na abertura, no piloto e nas perguntas; o e-mail passa a ser alternativa («Prefiro e-mail»). Continua **sem formulário** (DEC-044). **Substitui** o CTA «Quero participar do piloto» e o botão «Falar com o Tredane».
- **Títulos:** 56px só na abertura, na história e no piloto; os demais blocos usam um segundo nível (até 40px).
- **«Entrar»** sai do topo abaixo de 480px e fica também no rodapé.
- **Em aberto (bloqueia a publicação):** número de WhatsApp do Tredane e mensagem pronta do `wa.me` (o valor padrão `.example` cai em LP-AC-05); como a política de privacidade trata o contato por WhatsApp; nome e foto de quem acompanha o piloto (hoje `[A DEFINIR]`); confirmar com o backend que a marcação pelo botão Confirmar funciona fora do expediente, como a história mostra (21:47, clínica fechada; a DEC-110 cobre só a passagem para a equipe). Responsável: responsável pelo produto.
- **Mocks:** os `.dc.html` de `docs/design/landing` continuam na v7 e **desatualizados**; a referência visual desta rodada é o canvas do review e o próprio site.

## Seções e regras de conteúdo (v7, aprovada em 24/10/2026)

1. **Topo:** marca provisória, atalhos (Como funciona, IA, Agenda, Sinal; escondidos abaixo de 720px), **Entrar** e **Quero participar**.
2. **Abertura:** “Menos peso na recepção. Do primeiro ‘oi’ ao horário marcado.”, selo “Para clínicas de estética e depilação · Piloto aberto”, três garantias, nota “Telas ilustrativas, com nomes e valores fictícios” e composição do produto (`role="img"`, sem controles reais).
3. **O que pesa hoje:** “Atender no WhatsApp cansa. Não precisa ser assim.” Quatro pares “O que fica na sua cabeça × O que o Tredane carrega”. A coluna da esquerda é **hipótese** (VAL-01), a validar antes de publicar; a da direita usa só decisões confirmadas.
4. **Como funciona:** quatro passos, do WhatsApp ao horário confirmado.
5. **Atendimento automático (painel escuro):** garantias alinhadas às decisões de atendimento (DEC-061, DEC-083, DEC-104, DEC-107 a DEC-115): só marca quando a cliente toca em Confirmar; preço só do cadastro; «Falar com a equipe» em toda resposta; saúde, remarcação e cancelamento vão para a equipe; honesta sobre ser assistente e para quando a cliente pede; a responsável pausa as marcações. **Substitui** a versão v7 («só sugere e nunca envia»), que já não descreve o produto confirmado. Estado: **Proposto** até revisão do texto pelo responsável.
6. **Agenda:** salas, intervalo, bloqueio e próximo horário possível (DEC-008).
7. **Sinal por Pix:** direto na conta da clínica, valor por serviço, confirma ao pagar, política clara (DEC-047).
8. **Rotina da recepção**, **piloto** (“Sua equipe merece terminar o dia mais leve.”), **perguntas frequentes** e **rodapé**.

**Confirmado (24/10/2026):** a página **não** diz que o produto está em desenvolvimento; o público inclui clínicas de depilação; as ilustrações levam a nota “Telas ilustrativas, com nomes e valores fictícios”; mensagens ofensivas aparecem só como uma garantia da IA, sem seção própria.

Toda afirmação da página precisa corresponder a uma decisão confirmada: atendimento automático com frases determinísticas do backend e marcação só pelo toque da cliente em Confirmar (DEC-061, DEC-083, DEC-104, DEC-107 a DEC-115; a regra antiga «IA só sugere e uma pessoa envia» foi substituída por essas decisões); WhatsApp oficial com Embedded Signup (DEC-009); agenda com profissional, sala e intervalo (DEC-008); nome “Acompanhamento” (DEC-045); preço, explicação de procedimentos, assunto clínico e mensagem ofensiva (DEC-046); sinal por Pix na conta da clínica, confirmação ao pagar e prazo de 2 h (DEC-047); PWA (DEC-039, DEC-040); papéis (DEC-020, DEC-042); dados separados por clínica (DEC-038) e suporte por 30 minutos com aprovação (DEC-029, DEC-032). **Não** prometer conformidade com a LGPD, números de clientes, resultados ou funcionalidades fora do MVP (lembretes; agendamento sem o toque da cliente em Confirmar; respostas livres do modelo fora do que a DEC-104 permite).

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
| Domínio de **staging** da landing: `https://staging.tredane.com` (Worker `tredane-site-staging`, `site/wrangler.jsonc` env `staging`) | **Confirmado** (pedido do responsável, 24/10/2026); DNS/custom domain ainda dependem do deploy na conta Cloudflare da zona `tredane.com` |
| Domínio de **produção** do site e endereço do painel para **Entrar** (hoje `app.tredane.example`) | Responsável pelo produto |
| E-mail de contato (hoje `contato@tredane.example`) | Responsável pelo produto |
| WhatsApp do Tredane para o CTA (`PUBLIC_WHATSAPP_URL`, hoje `wa.tredane.example`) e nome/foto de quem acompanha o piloto | Responsável pelo produto |
| Política de privacidade publicada em `/privacidade`; depende do parecer jurídico ([dossiê](legal-review-brief.md)) e do CNPJ (VAL-13); rastreio GATE-03 em [pilot-gates.md](pilot-gates.md) | Responsável pelo produto + advogado |
| Condições e preço do piloto (não inventar valores neste repositório) | Responsável pelo produto |
| Logo e marca definitivos (hoje provisórios) | Responsável pelo produto |
| `SITE_URL` de **produção** (canônica, Open Graph e mapa do site; staging usa `https://staging.tredane.com` via `npm run build:staging`) e endereço do painel em `PUBLIC_APP_URL`, e-mail em `PUBLIC_CONTACT_EMAIL` | Responsável pelo produto |
| Medição de visitas: só com ferramenta sem cookies e após a política de privacidade | Responsável pelo produto |
