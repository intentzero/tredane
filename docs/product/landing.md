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

- **Implementação responsiva para revisão em staging (04/11/2026):** a nova conversa aprovou o hero escuro e a jornada simplificada em desktop e celular. A página em `site/src/pages/index.astro` apresenta conversa → proposta → confirmação, três passos e três garantias de controle humano. Ela identifica a demonstração como ilustrativa. O e-mail comercial e o endereço do painel só aparecem quando configurados com valores que não sejam `.example`; enquanto isso, o bloco do piloto informa que o canal de contato será divulgado. Os mocks antigos em `docs/design/landing` continuam desatualizados; esta implementação ainda exige revisão visual no staging e não autoriza publicação em produção.

- **Direção «Luz»** (fundo quase branco, texto Tinta, Petróleo só na ação, Damasco em um único detalhe, cantos arredondados): escolhida entre três aberturas apresentadas em conversa com o responsável pelo produto ("Opção 1 · Luz", 04/11/2026). **Confirmado** como direção visual; o mock aprovado está no canvas de design e **ainda não** foi exportado para `docs/design/landing` (os `.dc.html` e previews de lá seguem na v7 e ficam **desatualizados** até essa exportação).
- **Fonte:** Geist (Google Fonts, licença SIL OFL) hospedada no próprio site, no lugar da Inter, só no site; o painel segue em Roboto (DEC-073). **Proposto**; conferir a licença antes de publicar.
- **Cores:** só a paleta da marca (DEC-050) e neutros próprios do site (`#FAFAF8`, `#E4E6E3`, `#5A6463`); Damasco nunca como texto sobre claro (contraste 2,31 : 1). **Proposto**; rodar a verificação de contraste antes de publicar.
- **Copy:** nova mensagem «A cliente marca pelo WhatsApp. A recepção respira.», seção de atendimento automático, seção «Para a recepção» (Assumir/Devolver, «Precisa de alguém», prefixo `[Nome]` da DEC-088) e perguntas frequentes revistas. **Proposto**.
- **Abertura escura (04/11/2026):** o responsável pelo produto achou a abertura «Luz» sem impacto e cortada no celular, e pediu a implementação («Implementa») da proposta do [canvas do hero](https://claude.ai/artifact/2UEbhagS5CAvf3eLzCRMCM) (privado). **Confirmado** só para o topo e a abertura: fundo Tinta `#101817` com brilhos de Petróleo e Damasco, título alinhado à esquerda com «A recepção respira.» em Damasco (Damasco sobre Tinta 6,9 : 1), um botão principal Damasco com texto Tinta, «Ver como funciona» como link, selo curto abaixo de 520px e cena ilustrativa (mensagem, proposta com Confirmar, «Na agenda · Marcado pela IA» e, no computador, «Precisa de alguém») no lugar do telefone, que ficava cortado. O resto da página continua «Luz». Neutros escuros novos, só do site: `#B7C1BF`, `#D5DCDB`, `#2A3534`. A copy não mudou. Medido em 04/11/2026: axe sem violações em 390px e 1440px e sem rolagem horizontal em 360px e 390px; o Lighthouse ainda está **Em aberto**.
- **Sem alteração:** o resto das decisões da DEC-044 (sem formulário, e-mail como contato, sem «em desenvolvimento», nota «Telas ilustrativas, com nomes e valores fictícios»).
- **Em aberto (bloqueia a publicação):** os mesmos itens da tabela final, mais a nova medição de LP-AC-06 (`og-image.png` regenerada em 23/11/2026).

## Revisão de comunicação (04/11/2026, segunda rodada)

Origem: review da landing pedido pelo responsável pelo produto ([canvas do review](https://claude.ai/artifact/UhYFee8eHZFztYAb2UAPGy), privado) e «Sim, implementa» em 04/11/2026. **Substitui** a jornada simplificada de três passos do PR #547 (mesmo dia), por escolha do responsável («Nossa + ideias do #547»), mantendo dela a regra de só mostrar endereços configurados. **Confirmado** como estrutura e copy do site; os itens abaixo marcados **Em aberto** continuam bloqueando a publicação.

- **Estrutura em 7 blocos** (eram 13): 1. Abertura; 2. «Uma conversa inteira» (história de uma cliente fictícia, Lívia, das 21:47 às 08:00) com «O que muda para a clínica»; 3. «Você continua no controle» (único lugar das garantias de atendimento); 4. «A equipe e a agenda» (caixa de conversas e agenda lado a lado, mais quatro fatos curtos); 5. Sinal por Pix; 6. Piloto; 7. Perguntas frequentes. Saíram «O que pesa hoje» (hipótese VAL-01 não validada), «Como funciona» (absorvido pela história) e a grade de rotina.
- **Motivo:** a garantia «só marca com o toque da cliente» aparecia cinco vezes e soava defensiva; a página falava com a recepção, mas quem decide o piloto é a dona; cada ilustração tinha outra cliente; todos os H2 tinham o mesmo peso.
- **Leitora:** a dona continua sendo a leitora principal; a recepção aparece como cenário.
- **CTA:** **«Conversar no WhatsApp»** (link `wa.me` do próprio Tredane, `PUBLIC_WHATSAPP_URL`) no topo, no piloto e nas perguntas; o e-mail passa a ser alternativa («Prefiro e-mail»). Continua **sem formulário** (DEC-044). **Substitui** o CTA «Quero participar do piloto» e o botão «Falar com o Tredane». A abertura usa «Quero minha agenda cheia» (mensagem de 05/11/2026). **Confirmado** (Paulo Santos, 19/11/2026): no celular o topo deixa de encurtar para só «WhatsApp»; o rótulo completo vale em qualquer largura (ver secção «CTA do header» abaixo).
- **Endereços só quando reais (do PR #547):** WhatsApp, e-mail e **Entrar** só aparecem quando a variável está configurada com valor sem `.example`. Sem WhatsApp, os botões viram «Conhecer o piloto» e levam ao bloco do piloto; sem WhatsApp nem e-mail, o piloto informa que o canal de contato será divulgado.
- **Títulos:** 56px só na abertura, na história e no piloto; os demais blocos usam um segundo nível (até 40px).
- **«Entrar»** (**Proposto**, 18/11/2026; revê a regra de sair do topo abaixo de 480px): botão de contorno verde com ícone de entrada (Lucide log-in), 44px de altura, ao lado do botão cheio «Quero participar», que continua o único preenchido. No celular fica no topo, e o botão principal encurta para «Participar»; abaixo de 340px perde o ícone. O rodapé mantém o link de texto. Mock: `docs/design/landing/Main.dc.html`; proposta em [canvas privado](https://claude.ai/artifact/1mwjGnPazS3AK9mUp3f1qu).
- **Confirmado (Paulo Santos, 19/11/2026, America/Sao_Paulo):** WhatsApp do Tredane `+55 61 99588 8039` (`PUBLIC_WHATSAPP_URL` / default `https://wa.me/5561995888039?text=…`); quem acompanha o piloto é **Paulo Santos**, com foto em `site/src/assets/paulo-santos-piloto.jpg`. A mensagem pronta do `wa.me` segue o padrão já documentado («Quero conhecer o piloto do Tredane») — **Proposto** o texto exacto da pré-mensagem.
- **Em aberto (bloqueia a publicação):** como a política de privacidade trata o contato por WhatsApp; confirmar com o backend que a marcação pelo botão Confirmar funciona fora do expediente, como a história mostra (21:47, clínica fechada; a DEC-110 cobre só a passagem para a equipe). Responsável: responsável pelo produto.
- **Mocks:** os `.dc.html` de `docs/design/landing` continuam na v7 e **desatualizados**; a referência visual desta rodada é o canvas do review e o próprio site.

## Telas do aplicativo na landing (04/11/2026)

Origem: pergunta do responsável pelo produto («podemos adicionar alguns screenshots do aplicativo em mobile?»), proposta no [canvas das capturas](https://claude.ai/artifact/RpZJmgb6QhNcHDFuBoDLWH) (privado) e «Sim, implementa». **Confirmado** como seção; as imagens atuais são **provisórias**.

- **Onde:** o bloco «A equipe e a agenda» passa a se chamar «Do lado da equipe» e troca as ilustrações em CSS (caixa de conversas e grade da agenda) por três telas do celular em moldura: Conversas (Júlia em «Precisa de alguém», Lívia agendada), a conversa da Lívia (pergunta das 21:47, resposta automática, proposta confirmada pela cliente, Assumir conversa) e a agenda de sexta (Lívia às 10:00 na Sala 1, intervalo, bloqueio do aparelho, horário livre). No computador ficam lado a lado; no celular, em faixa horizontal com rolagem por encaixe, sem JavaScript.
- **Imagens:** `site/src/assets/app/*.png` (560×1160), convertidas pelo Astro em WebP de cerca de 15 KB (1×) e 35 KB (2×), carregadas só ao aparecer na tela, com texto alternativo que descreve cada tela e a nota «Telas do aplicativo, com dados fictícios».
- **Provisório:** as três imagens são desenhos das telas do painel feitos para a landing (`site/capturas/*.html`, geradas por `site/capturas/gerar.sh`), não capturas do aplicativo. Os mocks de `docs/design/mobile` **não** servem: mostram o modelo antigo de sugestão da IA (anterior à DEC-104) e usam «Lívia» como nome de profissional.
- **Em aberto (bloqueia a publicação):** substituir pelas capturas do aplicativo real com um seed fictício próprio da landing (Clínica Aurora, Lívia Moraes, Júlia Santos, sexta 06/11), mantendo os nomes e o conteúdo descritos no texto alternativo; depois, apagar `site/capturas/`. Responsável: responsável pelo produto.

## Mensagem «parceira no crescimento» (05/11/2026)

Origem: três rodadas de `/design` com o responsável pelo produto em 05/11/2026 ([canvas da mensagem](https://claude.ai/artifact/ANpCh81EamAM4Y2hpCKe5d) e [canvas do título](https://claude.ai/artifact/SLUVokPv8rfTKLuapWHX7T), privados), com «Sim, aplica a A» e «Sim, implementa». **Confirmado** como mensagem, estrutura e copy do site; **substitui** a copy da «Revisão de comunicação» acima, mantendo dela a regra dos endereços reais, a abertura escura e a ausência de formulário.

- **Público:** clínicas de estética e depilação de pequeno e médio porte, com equipe; a leitora principal é a dona ou sócia-gestora. **Substitui** o tom de clínica de uma pessoa só («Você não precisa dar conta de tudo sozinha»), recusado pelo responsável.
- **Mensagem:** a clínica é a protagonista e cresce; o Tredane é a parceira que apoia, não «uma assistente a mais» e não «cresce junto». Emoção de crescimento e receita, não de cansaço: ficam fora «a qualquer hora», «madrugada», «sobrecarregada», «a recepção respira» e «substituir».
- **Título (no presente):** «Sua clínica cresce. E você tem uma parceira do lado.» Subtítulo: «O Tredane responde cada cliente no WhatsApp com o seu preço, mostra os horários livres e marca quando ela confirma. Você só vê a agenda enchendo.» Botão: «Quero minha agenda cheia».
- **Tom:** popular e emocional; frases curtas, palavras do balcão, imagem antes da explicação.
- **Estrutura:** 1. Abertura com as telas do aplicativo (três no computador, Conversas e Agenda no celular) no lugar da cena ilustrativa; 2. «Como o Tredane ajuda» (três cartões: cliente perguntou, cliente marcou; cresce sem virar bagunça; sua equipe cuidando de gente); 3. «Na prática» (a conversa da Lívia em quatro passos numerados, sem horário noturno); 4. Sinal por Pix («Marcou, pagou o sinal, garantiu.»); 5. «Pode confiar» (três garantias: fala o que você ensinou; quem escolhe o horário é a cliente; na hora certa, chama a equipe; transparência sobre IA e pausa ficam no texto de abertura do bloco); 6. «Feito para equipe» (quatro fatos, sem as telas, que subiram para a abertura); 7. Piloto («Sua clínica merece crescer. Vamos começar?»); 8. Perguntas, abrindo com «Isso me ajuda a faturar mais?» e «Funciona com várias profissionais e salas?».
- **Limites:** «cresce» é desejo, não garantia; nenhum número de faturamento até medir no piloto. A IA só marca com o toque da cliente em Confirmar (DEC-061).
- **Proposto:** a reação das donas a este tom; validar com clínicas do piloto.
- **Em aberto (bloqueia a publicação):** capturas do aplicativo real (`og-image.png` regenerada em 23/11/2026); faixa de porte («pequeno e médio») — os tetos de profissionais/logins dos planos Confirmados em 19/11/2026 (Estúdio 1 / Clínica até 4 / Casa até 10) fecham a referência comercial, mas a definição de porte do piloto em copy continua a validar. Responsável: responsável pelo produto.
- **Medido em 05/11/2026:** `astro check` sem erros; sem rolagem horizontal em 360px; revisão visual em 1440px e 360px. axe e Lighthouse **não** foram rodados nesta rodada.

## Logo maior e fundos com ritmo (05/11/2026)

Origem: pedido do responsável pelo produto («podemos aumentar o logo?», «o background do hero está muito escuro») e duas rodadas de `/design` ([canvas do hero](https://claude.ai/artifact/7EsuiPZFNkY2dJLovsS3nz) e [canvas dos fundos](https://claude.ai/artifact/T6iFVqimrVDiaKBUyUMct8), privados), com a escolha da opção A e «Sim, implementa». **Confirmado** como visual do site; **substitui** a abertura Tinta de 04/11/2026, mantendo a mensagem e a estrutura da seção anterior.

- **Logo:** 36 px de altura no computador e 30 px no celular (era 26 px); topo de 92 px (72 px no celular).
- **Abertura «Aurora Petróleo»:** degradê de Petróleo (`#0E5A5C` → `#0A3A3C`) no topo e na abertura, com três manchas de luz (verde-azulado e Damasco) que se movem devagar (18 a 26 s); os celulares flutuam de leve. Destaque do título em Damasco claro `#F2B596` e texto secundário `#D5E6E4`, para manter o contraste sobre o Petróleo.
- **Ritmo das seções:** Como ajuda em creme `#FBF1E9` com brilho Damasco no canto; Na prática em menta `#EAF3F2` com trama de pontos; Sinal Pix em branco com halo Damasco que «respira»; Pode confiar em painel Petróleo com eco da aurora; Feito para equipe em creme, com os fatos em cartões; Piloto em painel Damasco com texto Tinta e botão escuro; Perguntas em fundo neutro.
- **Limite do movimento:** só na abertura, no Pix, em Pode confiar e no piloto; ciclos de 8 s ou mais, nunca atrás do texto; tudo para com `prefers-reduced-motion`. Só CSS, sem JavaScript nem vídeo.
- **Medido em 05/11/2026:** `astro check` sem erros; sem rolagem horizontal em 360px; revisão visual em 1440px e 360px. axe e Lighthouse **não** foram rodados; o contraste dos textos novos foi escolhido para passar 4,5 : 1, mas não foi medido com ferramenta.

## Header fixo e animações (05/11/2026)

Origem: perguntas do responsável pelo produto («header sticky?», «podemos adicionar animações?») e duas rodadas de `/design` ([canvas do header](https://claude.ai/artifact/3SSipXrjat9s5opGx2mvNS) e [canvas das animações](https://claude.ai/artifact/JxopLe1MdZ637ieyhi8XTj), privados), com a escolha da opção A e «Sim, implementa tudo». **Confirmado** como comportamento do site; **substitui** o logo de 36 px da seção anterior por 32 px (28 px no celular), tamanho único para o topo e a barra fixa.

- **Header fixo «Petróleo translúcido»:** fica no topo ao rolar; Petróleo sólido sobre a abertura e translúcido, com desfoque e sombra, depois dela. O botão do topo passa a Damasco. O item do menu da seção em que a pessoa está ganha um sublinhado Damasco claro. Sem encolher nem esconder ao rolar.
- **Abertura:** título, texto, botão e celulares deslizam 18 px na carga, em sequência. Sem opacidade, para que o título nunca fique invisível.
- **Entrada ao rolar:** títulos e cartões sobem 16 px e aparecem uma vez, ao entrar na tela, com 80 ms entre cartões.
- **Cenas:** Na prática mostra a conversa em sequência (pergunta, resposta, toque em Confirmar, horário na agenda), com o cartão ativo contornado; Sinal Pix passa de «Aguardando sinal» a «Sinal pago · quinta 14:00 garantida». Cada cena roda uma vez.
- **Ao toque:** botões sobem 2 px; cartões ganham sombra; o «+» das perguntas gira.
- **Limites:** CSS mais um script de poucas linhas (`IntersectionObserver`), sem biblioteca. O CSS só esconde conteúdo depois que o script marca a página; sem script, ou com `prefers-reduced-motion`, tudo aparece pronto e parado.
- **Medido em 05/11/2026:** `astro check` sem erros; sem rolagem horizontal em 360px; header, destaque do menu e as duas cenas conferidos em 1440px. axe e Lighthouse **não** foram rodados.

## Composição nova e fundos com padrão (13/11/2026)

Origem: pedido do responsável pelo produto («dá um upgrade na landing page», «o background está meio monótono e sem vida») e duas rodadas de `/design` ([canvas do upgrade](https://claude.ai/artifact/5iAMLUphLUFMVy2ppwpWJc), privado), com «Sim, implementa». **Confirmado** como visual do site. A mensagem, a copy e a ordem dos oito blocos de 05/11/2026 **não mudaram**; o header fixo, a entrada ao rolar e as duas cenas continuam como estavam.

- **Abertura:** a conversa da Lívia fica à frente e a agenda atrás, nos dois tamanhos de tela, com um aviso «Lívia confirmou · sexta · 10:00 · Sala 1» (decorativo, repete o que as telas mostram) e anéis atrás dos celulares. **Substitui** as três telas lado a lado; a tela Conversas desce para «Feito para equipe».
- **Como ajuda:** o primeiro cartão fica maior, em Petróleo, com uma mini conversa (pergunta, preço e três horários). Os outros dois ganham um detalhe cada: «Profissional, Sala, Intervalo» e «Júlia Santos · Precisa de alguém».
- **Na prática:** número em círculo com trilho; o passo do Confirmar tem contorno Petróleo; a fala da cliente fica à esquerda e a resposta à direita, como na tela do aplicativo.
- **Sinal Pix:** sequência ligada sobre creme, do pedido ao «Sinal pago» em verde (`success.ink` `#1F7A4D`, texto branco).
- **Pode confiar:** as três garantias em cartões com ícone.
- **Feito para equipe:** os quatro fatos em grade de duas colunas, com ícone, ao lado da tela Conversas.
- **Piloto:** texto alinhado à esquerda, com a pessoa que acompanha ao lado do título.
- **Motivos de fundo:** linhas de seda (abertura, em movimento; Pode confiar, paradas), anéis (abertura, Pix, Feito para equipe) e uma flor de oito pétalas em traço fino (Como ajuda e piloto). **Proposto** como parte da marca: só existem no site.
- **Movimento:** dentro do limite de 05/11/2026 (abertura, Pix, Pode confiar e piloto; ciclos de 8 s ou mais; tudo para com `prefers-reduced-motion`). Novo: as linhas de seda da abertura (24 s) e uma segunda luz no piloto (24 s).
- **Proposto:** os horários «sex 11:00» e «sáb 09:30» da mini conversa são ilustrativos e não vêm da história da Lívia; validar com o responsável ou trocar por horários da agenda de sexta.
- **Mocks:** os `.dc.html` e previews de `docs/design/landing` continuam na v7 e **desatualizados**; a referência desta rodada é o canvas do upgrade e o próprio site.
- **Em aberto (bloqueia a publicação):** os mesmos itens das seções anteriores; nenhum foi fechado nesta rodada.
- **Medido em 13/11/2026:** `astro check` sem erros e `astro build` concluído; sem rolagem horizontal em 360px, 390px e 1440px; revisão visual em 1440px e 390px. axe e Lighthouse **não** foram rodados; o contraste dos textos novos foi escolhido para passar 4,5 : 1, mas não foi medido com ferramenta.

## Exploração de paleta «Coral & Menta» — 16/11/2026

**Confirmado:** Paulo pediu uma alternativa mais vibrante e alegre, adequada ao contexto de saúde e beleza, com mock antes da implementação. **Confirmado (Paulo, 16/11/2026, «gosto, implementa»):** [mock navegável](../design/landing/paleta-viva/PaletaViva.dc.html), com alternador Atual/Proposta; [preview desktop](../design/landing/paleta-viva/previews/desktop.png) e [celular](../design/landing/paleta-viva/previews/celular.png). A referência desta comparação é o código local de `site/` em `6b65453f`, não uma auditoria do site publicado.

A paleta aprovada usa coral `#FF745F` nas ações, turquesa `#007F78` nos destaques e no painel de confiança, menta `#E4F8EF`, pêssego `#FFF2E9` e branco quente `#FFFDF9` nas superfícies. Texto principal `#203632`, secundário `#52645F` e turquesa escuro `#00665F` nos rótulos pequenos. A intenção é transmitir acolhimento e energia; a adequação percebida pelo público continua **Proposta**, sem pesquisa de validação.

**Confirmado (Paulo, 18/11/2026):** o botão coral da landing deixa o texto escuro. `#203632` sobre `#FF745F` mede 4,84:1 e foi lido como fraco; branco sobre esse mesmo coral cai para 2,65:1. O botão (repouso e hover) passa a usar o par já medido no painel: fundo `#C34334`, texto branco (5,03:1) e hover `#C84738` (4,76:1). O restante da paleta da landing não muda.

O mock conserva estrutura, copy, fonte Geist, símbolo da marca e imagens ilustrativas da implementação local. Usa a versão existente da marca para fundo claro; os telefones recebem moldura branca. A barra de comparação não faz parte da landing. O snapshot é autocontido, tem `noindex`, suspende animações para comparar as cores e impede a abertura de canais comerciais. Os marcadores comerciais já existentes permanecem visíveis; não representam condições definidas.

**Confirmado:** implementar esta paleta em `site/`, substituindo a abertura Aurora Petróleo e os fundos de 05/11/2026. Esta revisão da DEC-044 permite cores próprias da landing; os tokens do painel, o escopo do MVP e os gates comerciais/de publicação permanecem os mesmos. As animações e interações existentes continuam no site; a barra Atual/Proposta fica somente no mock. **Confirmado (Paulo, 16/11/2026, «publica»):** publicar esta revisão em produção após os checks. Publicação ainda pendente de execução. Critérios desta revisão: comparar as duas paletas, manter o conteúdo, verificar contraste de texto e ausência de rolagem horizontal em 360, 390 e 1440 px. Ver instruções e evidência em [README do mock](../design/landing/paleta-viva/README.md).

**Integração com main (16/11/2026):** a publicação preserva a composição de 13/11/2026 (conversa e agenda na abertura, cartão de ajuda ampliado e Conversas na seção da equipe), aplicando nela as cores aprovadas. O mock comparativo permanece como registro da base anterior; os previews `implementado-*` mostram a integração atual.

**Implementado localmente em 16/11/2026:** paleta em `site/src/styles/coral-menta.css`, marca para fundo claro e cor do navegador atualizadas. `astro check` e `build:staging` passaram. Sem overflow ou violações axe em 360/390/1440 px, incluindo verificação das cenas animadas em desktop. [Previews e evidência](../design/landing/paleta-viva/README.md#implementação-aprovada). Publicação, Lighthouse e validação manual completa com leitor de tela continuam **Em aberto**.

## Seções e regras de conteúdo (v7, aprovada em 24/10/2026)

1. **Topo:** marca provisória, atalhos (Como funciona, IA, Agenda, Sinal; escondidos abaixo de 720px), **Entrar** e **Quero participar**.
2. **Abertura:** “Menos peso na recepção. Do primeiro ‘oi’ ao horário marcado.”, selo do hero sem «Em piloto» — **Confirmado** (Paulo Santos, 19/11/2026): `chip-long` «clínicas de estética e depilação» e `chip-short` «estética e depilação» (substitui «Em piloto · …» / o selo v7 «Para clínicas de estética e depilação · Piloto aberto»), três garantias, nota “Telas ilustrativas, com nomes e valores fictícios” e composição do produto (`role="img"`, sem controles reais).
3. **O que pesa hoje:** “Atender no WhatsApp cansa. Não precisa ser assim.” Quatro pares “O que fica na sua cabeça × O que o Tredane carrega”. A coluna da esquerda é **hipótese** (VAL-01), a validar antes de publicar; a da direita usa só decisões confirmadas.
4. **Como funciona:** quatro passos, do WhatsApp ao horário confirmado.
5. **Atendimento automático (painel escuro):** garantias alinhadas às decisões de atendimento (DEC-061, DEC-083, DEC-104, DEC-107 a DEC-115; **DEC-202**): preço só do cadastro; o chat informa e encaminha; marcar, remarcar e cancelar são só na página web da cliente (não «vão para a equipe» pelo chat); saúde e pedido de uma pessoa vão para a equipe; honesta sobre ser assistente e para quando a cliente pede; a responsável pausa as marcações. **Substitui** a versão v7 («só sugere e nunca envia») e a frase antiga «saúde, remarcação e cancelamento vão para a equipe». Estado: **Proposto** a restante redação desta secção até revisão do texto pelo responsável; o ponto DEC-202 do proof/FAQ está **Confirmado** abaixo.
6. **Agenda:** salas, intervalo, bloqueio e próximo horário possível (DEC-008).
7. **Sinal por Pix:** direto na conta da clínica, valor por serviço, confirma ao pagar, política clara (DEC-047).
8. **Rotina da recepção**, **piloto** (“Sua equipe merece terminar o dia mais leve.”), **perguntas frequentes** e **rodapé**.

**Confirmado (24/10/2026):** a página **não** diz que o produto está em desenvolvimento; o público inclui clínicas de depilação; as ilustrações levam a nota “Telas ilustrativas, com nomes e valores fictícios”; mensagens ofensivas aparecem só como uma garantia da IA, sem seção própria.

Toda afirmação da página precisa corresponder a uma decisão confirmada: atendimento automático com frases determinísticas do backend e marcação só pelo toque da cliente em Confirmar (DEC-061, DEC-083, DEC-104, DEC-107 a DEC-115; a regra antiga «IA só sugere e uma pessoa envia» foi substituída por essas decisões); WhatsApp oficial com Embedded Signup (DEC-009); agenda com profissional, sala e intervalo (DEC-008); nome “Acompanhamento” (DEC-045); preço, explicação de procedimentos, assunto clínico e mensagem ofensiva (DEC-046); sinal por Pix na conta da clínica, confirmação ao pagar e prazo de 2 h (DEC-047); PWA (DEC-039, DEC-040); papéis (DEC-020, DEC-042); dados separados por clínica (DEC-038) e suporte por 30 minutos com aprovação (DEC-029, DEC-032). **Não** prometer conformidade com a LGPD, números de clientes, resultados ou funcionalidades fora do MVP (lembretes; agendamento sem o toque da cliente em Confirmar; respostas livres do modelo fora do que a DEC-104 permite).

## CTA do header: rótulo completo no celular (19/11/2026)

**Confirmado** (Paulo Santos, 19/11/2026, America/Sao_Paulo, screenshot): o botão do header no celular dizia só «WhatsApp» — rótulo vago, sem verbo de acção. Texto final em todo o canal WhatsApp da landing (header, bloco do piloto): **«Conversar no WhatsApp»**. Motivo: a leitora precisa saber que o botão abre uma conversa com o Tredane, não só o nome do app. O hero mantém «Quero minha agenda cheia»; o FAQ mantém «Pergunte no WhatsApp» (link de texto, não botão). Remove a variante curta `cta-short` / `cta-long` em `site/src/styles/global.css`. Número e `wa.me` seguem Confirmados (+55 61 99588 8039).

## Revisão dos CTAs (23/11/2026)

**Confirmado** (Paulo Santos, 23/11/2026, «Yes, implement A–F», sobre a revisão no [canvas privado](https://claude.ai/artifact/DAETgby9hbRzw86nyvrdD1)). Os rótulos confirmados em 19/11 não mudam. Implementado em `site/src/pages/index.astro` e `site/src/styles/coral-menta.css`:

- **A. Um botão principal por vez:** enquanto a abertura está na tela, o botão do topo fica em contorno coral (`#C34334` sobre `#FFFDF9`, 4,95:1). Depois de rolar, volta a ser cheio. O script põe `is-over-hero` no topo; sem script, o botão fica cheio.
- **B. Para onde o botão leva:** logo abaixo de «Quero minha agenda cheia» aparece «Abre uma conversa no WhatsApp com o Paulo. Sem formulário.» (`#52645F`, 4,95:1 ou mais sobre o fundo da abertura). No celular, a linha fica entre o botão e «Ver na prática».
- **C. Hover e pressionado:** coral `#C34334` → hover `#A93A2D` (6,31:1) → pressionado `#8F3125` (7,97:1). O escuro fica na mesma família: `#203632` → hover `#2E4B46` (9,5:1) → pressionado `#152622` (15,8:1). Ao pressionar, o botão não se move. O hover para petróleo deixa de valer.
- **D. Botão no fim do bloco de planos:** «Algum plano cabe na sua clínica?» / «Fala direto com quem constrói o produto.» + «Conversar no WhatsApp».
- **E. Uma mensagem pronta por posição** (só muda o `?text=` do `wa.me`; sem cookie nem rastreamento): topo «Quero conhecer o piloto do Tredane»; abertura «Quero minha agenda cheia. Como funciona o piloto do Tredane?»; piloto (os dois botões) «Vi os planos do Tredane e quero entrar no piloto»; perguntas «Tenho uma dúvida sobre o Tredane». O texto exato continua **Proposto**, como a mensagem-base.
- **F. O mesmo ícone de mensagem** em todo botão de WhatsApp, inclusive no topo. No topo, o ícone some abaixo de 400px; abaixo de 420px o rótulo passa a 14px; e abaixo de 375px o logo passa a 24px, para «Conversar no WhatsApp» caber numa linha até 360px. A revisão apontou um hover que se movia com movimento reduzido, mas isso estava errado: `global.css` já anula `transform` nesse caso.

Verificado em 23/11/2026: `astro build` e `astro check` sem erros, e o preview local em 1280px, 375px e 360px sem rolagem horizontal. **Em aberto:** rodar axe e Lighthouse antes de publicar e atualizar o mock em `docs/design/landing`.

## Direção violeta e lima (23/11/2026)

**Confirmado** (Paulo Santos, 23/11/2026, «implementa», depois da [avaliação em canvas privado](https://claude.ai/artifact/1L3UWK8Ux8aXHYJ4rhZAAh) da versão ajustada). **Revê** só a paleta «Coral & Menta» da landing (16/11/2026, DEC-044); o texto e a estrutura não mudam. Painel, ícone do app, favicon, imagem de partilha e logo oficial seguem em Petróleo/Damasco: mudar a identidade é uma decisão à parte (DEC-050). Implementado em `site/src/styles/violeta-lima.css` (carregada depois de `coral-menta.css`).

| Papel | Cor |
| --- | --- |
| Abertura e piloto | violeta profundo `#211339`; título branco; «do oi ao horário marcado» em lavanda `#DCCBFF` |
| Botão do WhatsApp sobre fundo escuro | lima `#D5FF55`, texto `#211339` (15,0:1); hover `#E4FF96`, pressionado `#C2EB3C` |
| Botão do cabeçalho claro | violeta profundo `#211339`, texto branco (17,3:1; 16,5:1 contra o fundo); hover `#3A2560`, pressionado `#150C26` |
| Seções claras | alternam `#FBF9FF` e `#F0E9FF`; linhas `#DFD5EF`; texto `#211339` e `#544364` |
| «Pode confiar» | bloco `#5C32C9`, sobretítulo e texto brancos (7,6:1); cartões `#4C259E` |
| Eyebrow, link e foco no claro | `#4C259E` (8,6:1 ou mais); foco branco sobre fundo escuro |

- **Regras:** o lima só aparece sobre fundo escuro (sobre `#FBF9FF` mede 1,10:1). O texto sobre lima é sempre `#211339`, nunca branco (1,15:1).
- **Logo:** o cabeçalho e o rodapé usam o **mono-preto oficial** (`site/public/tredane-horizontal-mono-preto.svg`, cópia de `docs/design/brand/svg`), sem recolorir nem redesenhar o símbolo. Não existe variante violeta.
- **Revê a revisão dos CTAs de 23/11 (acima):** o botão do topo deixa de ficar em contorno sobre a abertura e fica sempre violeta profundo (A); os valores de hover e pressionado do coral (C) deixam de valer, e os do botão escuro mudam para a família violeta. B, D, E e F continuam.
- **Meta tag** `theme-color`: `#FBF9FF`.

Verificado em 23/11/2026: `astro build` e `astro check` sem erros; axe (contraste) sem violações e sem rolagem horizontal em 360, 390 e 1440 px; contrastes calculados nos pontos críticos entre 7,3:1 e 17,3:1. Na revisão visual apareceram os rótulos da tabela de planos no celular (`td::before`), que o axe não mede; ficaram `#DCCBFF` (10,2:1). **Em aberto:** percorrer a página com Tab, ver o lima em celular de verdade e sob sol, Lighthouse, e decidir se o violeta chega à marca, ao app e à imagem de partilha. Mock em `docs/design/landing` e previews seguem na paleta antiga.


**Capturas do app na landing (23/11/2026, Confirmado, Paulo: «atualiza os screenshots do app com os novos tokens»):** as três telas (`site/src/assets/app/conversas.png`, `conversa.png`, `agenda.png`) foram geradas de novo com `site/capturas/gerar.sh`. O `capturas.css` deixou de ter cores fixas da marca antiga (petróleo `#0E5A5C`, damasco) e passa a importar `docs/design/tokens.css` (v0.12.0), então as telas acompanham o painel: **Agendar** em lima com contorno (no horário livre da agenda), primário violeta, «Marcado pela IA» em petróleo, «Precisa de alguém» em âmbar, «Agendado» na cor da etapa, avatar da atendente em areia. O conteúdo das telas não mudou. Continuam **provisórias**: desenho em HTML com dados fictícios, não captura do aplicativo real.


**Imagem de partilha (23/11/2026, Confirmado, Paulo: «Sim, faz»):** `site/public/og-image.png` (1200 × 630, a que aparece ao colar o link no WhatsApp, LinkedIn ou Slack) vinha do primeiro commit do site, com um «T» azul genérico, fundo cinza e o texto «Piloto aberto». Foi refeita com a linguagem do hero: fundo violeta profundo `#211339`, logo horizontal da versão escura, o título da página com «do «oi» ao horário marcado» em lavanda `#DCCBFF`, as telas da conversa e da agenda, e a frase «Para clínicas de estética e depilação. Em piloto.». A fonte é `site/capturas/og-image.html`, gerada pelo mesmo `gerar.sh` das capturas. O `og:image` ganhou `?v=20261123` (as redes guardam a imagem por URL; trocar o valor quando o arquivo mudar) e o texto alternativo acompanha o novo cartão.

## Badge do hero sem «Em piloto» (19/11/2026)

**Confirmado** (Paulo Santos, 19/11/2026, America/Sao_Paulo, screenshot): o pill do hero deixa de dizer «Em piloto · …». Texto final em `site/src/pages/index.astro`: desktop/largo «clínicas de estética e depilação»; abaixo de 520px «estética e depilação».

## Proof do hero: remarcação e cancelamento (19/11/2026)

**Confirmado** (Paulo Santos, 19/11/2026, America/Sao_Paulo, screenshot; alinhado à **DEC-202**): a frase «Remarcação e cancelamento vão para a equipe» sai do proof sob a abertura. Texto final do terceiro item: «Marca, remarca e cancela na página da cliente». FAQ «O que a IA responde sozinha?» e o bloco «Pode confiar» deixam de dizer que remarcação/cancelamento vão para a equipe pelo chat; saúde e pedido de uma pessoa continuam a ir.

## Contacto do piloto e preços de referência (19/11/2026)

**Confirmado** (Paulo Santos, 19/11/2026, America/Sao_Paulo):

| Item | Valor |
| --- | --- |
| Quem acompanha o piloto | Paulo Santos (foto em `site/src/assets/paulo-santos-piloto.jpg`) |
| Frase no cartão (ao lado da foto) | **Confirmado** (Paulo Santos, 19/11/2026): «Dúvidas no começo? Fala comigo no WhatsApp.» Substitui «Acompanha o piloto…» / «Fica com a sua clínica…» (jargão e vago para o público da clínica). |
| WhatsApp Tredane | `+55 61 99588 8039` → `wa.me/5561995888039` |
| Estúdio | mensal R$ 149 · no anual R$ 124 · 1 profissional, 1 login |
| Clínica | mensal R$ 247 · no anual R$ 206 · até 4 profissionais, 3 logins |
| Casa | mensal R$ 397 · no anual R$ 331 · até 10 profissionais |

Na página (`site/src/pages/index.astro`): o bloco do piloto mostra a foto, o nome e a frase do cartão acima; os CTAs de WhatsApp usam o número; a tabela de planos e a FAQ «Quanto custa?» usam estes valores. Os mocks em `docs/design/landing` podem ficar atrás; a fonte activa é `site/` e este documento. E-mail comercial continua **Em aberto** (só aparece se `PUBLIC_CONTACT_EMAIL` for real).

## Critérios de aceite

- **LP-AC-01:** em 360px e 390px de largura não há rolagem horizontal; no computador, o conteúdo fica limitado a 1120px.
- **LP-AC-02:** todos os links e botões têm área de toque de pelo menos 44px e foco visível; a página navega inteira pelo teclado, com link “Ir para o conteúdo”.
- **LP-AC-03:** painel mantém [tokens.json](../design/tokens.json); a landing usa a paleta Coral & Menta aprovada em 16/11/2026 (revisão DEC-044), em `site/src/styles/coral-menta.css`, com contraste de texto ≥ 4,5:1. Validar também foco, hover e header fixo após rolar.
- **LP-AC-04:** a página não carrega recursos de terceiros (fontes, scripts, rastreadores).
- **LP-AC-05:** nenhum texto `[A DEFINIR]`, `[A PUBLICAR]` ou endereço `.example` existe na versão publicada.
- **LP-AC-06:** verificador automático de acessibilidade (axe, regras WCAG 2.0 a 2.2 AA e boas práticas) sem violações em 390px e 1440px, e Lighthouse com 100 em acessibilidade, SEO e boas práticas e pelo menos 95 em desempenho (**Confirmado**, 24/10/2026; exigir 100 foi descartado). Medido em 24/10/2026 na v7 com marcadores: axe 0 violações; Lighthouse 100 em acessibilidade, SEO e boas práticas e 99 em desempenho; repetir antes de publicar, e fazer teste manual com leitor de tela (**Em aberto**).
- **LP-AC-07 (SEO):** cada página tem título único, descrição, `lang`, URL canônica, Open Graph com imagem de 1200×630, ícone, `robots.txt`, mapa do site e dados estruturados `Organization` sem informações inventadas.

## Em aberto (bloqueia a publicação, não o desenvolvimento)

| Pergunta | Quem decide |
| --- | --- |
| Domínio de **staging** da landing: `https://staging.tredane.com` (Worker `tredane-site-staging`, `site/wrangler.jsonc` env `staging`) | **Confirmado** (pedido do responsável, 24/10/2026); DNS/custom domain ainda dependem do deploy na conta Cloudflare da zona `tredane.com` |
| Domínio de **produção** do site | Responsável pelo produto |
| Endereço do painel para **Entrar** (`PUBLIC_APP_URL`): produção `https://app.tredane.com`, staging `https://staging.app.tredane.com` | **Confirmado** (Paulo Santos, 18/11/2026) |
| E-mail de contato (hoje `contato@tredane.example`) | Responsável pelo produto |
| WhatsApp do Tredane para o CTA (`PUBLIC_WHATSAPP_URL`) e nome/foto de quem acompanha o piloto | **Confirmado** (Paulo Santos, 19/11/2026): `+55 61 99588 8039`; piloto acompanhado por Paulo Santos com foto em `site/src/assets/paulo-santos-piloto.jpg`. Mensagem pronta do `wa.me` **Proposta** («Quero conhecer o piloto do Tredane») |
| Política de privacidade publicada em `/privacidade`; depende do parecer jurídico ([dossiê](legal-review-brief.md)) e do CNPJ (VAL-13); rastreio GATE-03 em [pilot-gates.md](pilot-gates.md) | Responsável pelo produto + advogado |
| Preços de referência da assinatura na landing (Estúdio / Clínica / Casa) | **Confirmado** (Paulo Santos, 19/11/2026): Estúdio R$ 149 mensal · R$ 124 no anual (1 profissional, 1 login); Clínica R$ 247 · R$ 206 (até 4 profissionais, 3 logins); Casa R$ 397 · R$ 331 (até 10 profissionais). Alinhado a [unit-economics-assinatura.md](unit-economics-assinatura.md). Condições comerciais do piloto com cada clínica (desconto, adesão, quem paga a Meta) continuam **Em aberto** |
| Logo e marca definitivos (hoje provisórios) | Responsável pelo produto |
| `SITE_URL` de **produção** (canônica, Open Graph e mapa do site; staging usa `https://staging.tredane.com` via `npm run build:staging`) e o e-mail em `PUBLIC_CONTACT_EMAIL` | Responsável pelo produto |
| Medição de visitas: só com ferramenta sem cookies e após a política de privacidade | Responsável pelo produto |
