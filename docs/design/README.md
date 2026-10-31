# Design do painel — mocks e guia de implementação

**Estado:** design system v0.3.1 Confirmado, substituído em tamanhos pela v0.4.0 compacta (tipografia do WhatsApp Web, controles 28–36px) **Confirmada** ([DEC-081](../product/decisions.md)), ver [CHANGELOG.md](CHANGELOG.md); aprovado pelo responsável pelo produto ([DEC-041](../product/decisions.md), cor de marca em [DEC-050](../product/decisions.md), fonte Roboto em [DEC-073](../product/decisions.md)); biblioteca-base **Confirmada** — React Aria Components ([DEC-048](../product/decisions.md), [ADR-0013](../adr/0013-design-system-components.md)); mocks das telas **Proposto**. 24 de outubro de 2026. Esta pasta registra, dentro do repositório, os mocks de UI/UX do painel para que qualquer agente ou pessoa implemente as telas sem depender de links externos. Os mocks ilustram a [especificação de UI/UX](../product/ux-ui.md); não a substituem.

## Ordem de autoridade

Quando duas fontes divergirem, vale a mais alta desta lista, e a divergência deve ser registrada (seção [Divergências conhecidas](#divergências-conhecidas-entre-mocks-e-especificação)):

1. [Decisões](../product/decisions.md) e [requisitos](../product/requirements.md) (comportamento, permissões, dados).
2. [Especificação de UI/UX](../product/ux-ui.md) (telas, estados, textos, acessibilidade).
3. [tokens.json](tokens.json) e [components.md](components.md) (aparência).
4. Os mocks em `mobile/` (referência visual de uma tela, em um estado).

Os mocks mostram **um** estado por tela e dados fictícios. Estados de carregamento, vazio, erro e permissão estão descritos em [screens.md](screens.md#estados-que-a-ui-real-precisa-ter-e-os-mocks-mostram-em-uma-tela-só) e na spec; um mock sem esses estados não significa que eles não existam.

## O que há aqui

| Caminho | Conteúdo |
| --- | --- |
| [screens.md](screens.md) | Índice das telas: ID (M-01 a M-39), arquivo, tela da spec, jornadas, requisitos, cenários de aceite, o que cada mock mostra e para onde navega; estados que faltam em cada tela |
| [components.md](components.md) | Componentes recorrentes (cabeçalho, barra inferior, chips, balão, estado de envio, bloco de IA, folha inferior, formulário etc.) e regras gerais de implementação |
| [tokens.json](tokens.json) · `tokens.css` | Tokens v0.3.0 (fonte única, em JSON) e variáveis CSS geradas a partir dele |
| [catalog/index.html](catalog/index.html) | Catálogo: tokens e componentes com todos os estados (abra no navegador) |
| [icons.md](icons.md) | Inventário de ícones e proposta de biblioteca |
| [CHANGELOG.md](CHANGELOG.md) | Histórico de tokens e mocks, com a regra de conversão da consolidação 0.1 → 0.2 |
| `mobile/*.dc.html` | **Fonte dos mocks mobile** (base do produto, DEC-039). Um arquivo por tela |
| `mobile/previews/M-xx-*.png` | Imagem de cada mock, 390×844, para ver sem rodar nada |
| `mobile/canvas.json` | Posição e título de cada tela no canvas do editor de design |
| `desktop/` | Telas largas: exploração antiga (Conversas/`Main`, Pipeline, Agenda, Estados) e propostas recentes (`Entrar`, `ConversasDesktopProposta` · empty/thread). Ver [aviso](#desktop) |
| [brand/](brand/README.md) | Identidade visual (DEC-050): símbolo, nome, versões, ícone do app, favicon e paleta da marca |
| `landing/` | Mock aprovado da landing page do piloto (`Main.dc.html`, `Celular.dc.html`) e previews do site implementado; spec em [landing.md](../product/landing.md) |
| `tools/` | `build_tokens.py` (gera `tokens.css`), `check_contrast.py` (valida contraste), `check_mocks.py` (valida que os mocks só usam tokens), `build_catalog.py` (gera o catálogo), `render_previews.py` (gera os PNG; `expand_dc.mjs` expande os `<sc-for>`/`<sc-if>` dos mocks interativos), `build_brand.py` (gera os ficheiros da marca) |

## Como ver os mocks

- **Mais rápido:** abra os PNG em `mobile/previews/`. O nome indica a tela (`M-02-Conversa.png`).
- **Código de cada tela:** os `.dc.html` são HTML com CSS inline e quatro marcas do editor de design: `<x-dc>` envolvendo a tela, `<helmet>` com estilos da página, `{{ campo }}` e `<sc-if>` nas poucas telas interativas (M-09 e M-20). Leia o HTML e o CSS como especificação visual; **não copie as marcas do editor** para o produto. O arquivo não roda sozinho no navegador (falta o runtime do editor).
- **Canvas navegável (privado):** [mobile first](https://claude.ai/artifact/D3NALDhxo5n1jZj2fqpdka) e [desktop](https://claude.ai/artifact/6kzR7zL5q9hs2AcvTyYDNf). Só abre para quem o dono compartilhar; não dependa deles. Se o canvas e os arquivos desta pasta divergirem, **vale a pasta**.

## Como implementar uma tela (roteiro para agentes)

1. Leia a linha da tela em [screens.md](screens.md), depois a seção correspondente em [ux-ui.md](../product/ux-ui.md), os requisitos e os cenários de aceite citados.
2. Abra o PNG e o `.dc.html` da tela. Identifique os componentes de [components.md](components.md) e reutilize os que já existirem no código; crie os que faltarem **uma vez**.
3. Use apenas os valores de [tokens.json](tokens.json). Se um valor do mock não estiver lá, não invente: registre a divergência.
4. Implemente todos os estados da tabela de [screens.md](screens.md) e da spec: carregando, vazio, erro, sem permissão, desconectado, reconectando.
5. Aplique as regras que os mocks não mostram: autorização no servidor por clínica, eventos em tempo real que atualizam a tela, conciliação após reconexão e revogação de acesso ([ux-ui.md](../product/ux-ui.md) §6 e [tenant-boundaries.md](../product/tenant-boundaries.md)).
6. Verifique acessibilidade e comportamento: [critérios UX-01 a UX-08](../product/ux-ui.md#10-critérios-de-aceite-de-ux), `<button>`/`<a>`/`<label>` reais, contraste, alvos de toque ≥ 44px, foco visível, navegação por teclado.
7. Cite no PR a ID da tela (M-xx), os requisitos e os cenários cobertos, e liste qualquer divergência do mock.

## Textos e dados

- Os textos dos mocks são o ponto de partida do copy em português. Mensagens de erro, avisos e rótulos de estado já foram escritos de acordo com a spec; ajustes de texto passam pela revisão de produto.
- Nomes, telefones, e-mails, horários e valores são **fictícios**. Não os use em produção nem em dados de teste sem marcar como sintéticos. Nada aqui contém dados reais de pessoas ou clínicas.
- Os modelos de mensagem do WhatsApp (M-12, M-23) são exemplos; os reais dependem do cadastro e aprovação na Meta.

## Desktop

`desktop/` guarda telas anteriores às decisões DEC-039 (mobile first) e DEC-040 (`Main`, Pipeline, Agenda, Estados) e referências recentes (`Entrar` Confirmado; `ConversasDesktopProposta` / `ConversasDesktopPropostaThread` **Confirmado** Paulo 31/10/2026 Opção A — densidade estilo WhatsApp Web com tokens Tredane, implementada no painel). Onde `Main` (exploração antiga de três colunas) divergir dos mocks WA ou de `mobile/`, valem os mocks WA e o mobile.

## Divergências conhecidas entre mocks e especificação

Registradas para que ninguém as copie como se fossem intencionais. Corrija na implementação conforme a coluna da direita.

| Onde | Divergência | Implementar assim |
| --- | --- | --- |
| Chips e botões pequenos (altura visual de 28 a 36px, v0.4.0) | Abaixo dos 44px de área clicável (UX-08) | Mesma aparência, com área clicável ≥ 44px (padding ou pseudo-elemento, como no [catálogo](catalog/index.html)) |
| M-06 Agenda do dia | Não mostra o alternador **Dia / Semana** | Incluir como em M-13 (DEC-040) |
| M-15 Clínica | O item “WhatsApp” abre M-19 (não conectado) | Abrir M-19, M-23 ou M-24 conforme o estado real da conexão |
| M-09 Entrar | É um mock do comportamento; composição do bloco centrado **Confirmada** (Paulo 31/10/2026) | A tela real é o Clerk com a identidade do Tredane; layout alinhado ao mock em `.panel-auth` |
| M-01 a M-14 | Mostram a barra de 3 abas (visão do Atendente) | O Responsável vê 4 abas, com **Clínica** (M-15) |
| M-20 | Aba “Salas · 3” abrevia “Salas e equipamentos” | Manter o título completo no cabeçalho e na descrição da aba; o rótulo curto cabe em 360px |
| Fonte | Os mocks pedem Inter e os previews usam a fonte do sistema | Usar **Roboto** (400/500/600), hospedada pelo Tredane ([DEC-073](../product/decisions.md), [ADR-0013](../adr/0013-design-system-components.md)); conferir as quebras de linha com ela, porque a largura do texto muda com a fonte e linhas que cabem nos previews podem quebrar |
| M-01 / M-02 (PR-7) | Lista contínua no lugar de cartões; Assumir em faixa, Agendar em ícone e Encerrar no menu ⋮ com confirmação; um só cabeçalho na conversa | **Proposto**; vale até o responsável do produto revisar. Registrado em [components.md](components.md) |
| M-01 vs M-54 / painel | M-01 ainda mostra lista antiga no canvas | **Confirmado (M-54, Paulo 31/10/2026):** painel usa lista full-bleed + busca sunken; M-01 pode ser regenerado depois |
| M-40 vs M-55 / painel | M-40 ainda mostra Resumo/Bloquear no ⋮ | **Confirmado (M-55, Paulo 31/10/2026, Opção A):** painel e M-55 = ⋮ só pipeline; Resumo e Bloquear só no Contato |
| Hora e data | Fixas (sexta, 30 de outubro) | Sempre no fuso da clínica (DEC-008), nunca em UTC |

## Manutenção

- **Alterou um mock?** Atualize juntos: o `.dc.html`, o PNG (`python3 docs/design/tools/render_previews.py`; requer Node, `npm i -D playwright` e Chromium), a linha em [screens.md](screens.md) e a seção da spec. Antes de commitar rode `check_mocks.py` (só valores de token) e, se mexeu em cor, `check_contrast.py`.
- **Alterou um token?** Edite só `tokens.json`; rode `build_tokens.py`, `check_contrast.py` e `build_catalog.py`; registre em [CHANGELOG.md](CHANGELOG.md). Mudança de valor de token aprovado exige decisão registrada (DEC-041). Não commite PNG que só mudou por serrilhado de fonte; regenere apenas se o desenho mudou.
- **Criou uma tela?** Dê a próxima ID (M-27…), acrescente em `mobile/canvas.json`, em [screens.md](screens.md) e na rastreabilidade de [ux-ui.md](../product/ux-ui.md) §9. Não renumere IDs existentes.
- **Mudou uma decisão ou requisito?** Atualize primeiro o documento de produto, depois o mock afetado; nunca deixe mock e spec com versões concorrentes.
- **Aprovação:** o design system v0.2 foi aprovado (DEC-041) e a v0.3 trocou a cor de ação pela da marca (DEC-050). Os **mocks das telas** continuam **Proposto** até o responsável pelo produto revisá-los. Mudar um token já aprovado exige nova decisão registrada em [decisions.md](../product/decisions.md).

## Marca

**Confirmado (24/10/2026):** no piloto a marca é provisória: azul `primary.base` atual e ícone simples de PWA. Logo e identidade definitivos ficam **Em aberto** e entram trocando valores em `tokens.json`, sem mudar a especificação funcional.
