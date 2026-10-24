# Design do painel — mocks e guia de implementação

**Estado:** mocks **Proposto**, 24 de outubro de 2026. Esta pasta registra, dentro do repositório, os mocks de UI/UX do painel para que qualquer agente ou pessoa implemente as telas sem depender de links externos. Os mocks ilustram a [especificação de UI/UX](../product/ux-ui.md); não a substituem.

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
| [screens.md](screens.md) | Índice das 26 telas: ID (M-01 a M-26), arquivo, tela da spec, jornadas, requisitos, cenários de aceite, o que cada mock mostra e para onde navega; estados que faltam em cada tela |
| [components.md](components.md) | Componentes recorrentes (cabeçalho, barra inferior, chips, balão, estado de envio, bloco de IA, folha inferior, formulário etc.) e regras gerais de implementação |
| [tokens.json](tokens.json) | Cores, tipografia, raios, espaçamentos e tamanhos extraídos dos mocks |
| `mobile/*.dc.html` | **Fonte dos mocks mobile** (base do produto, DEC-017). Um arquivo por tela |
| `mobile/previews/M-xx-*.png` | Imagem de cada mock, 390×844, para ver sem rodar nada |
| `mobile/canvas.json` | Posição e título de cada tela no canvas do editor de design |
| `desktop/` | Quatro telas de uma exploração anterior para tela larga (Conversas, Pipeline, Agenda, Estados). Ver [aviso](#desktop) |
| `tools/` | Scripts para regenerar os previews |

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

`desktop/` guarda quatro telas anteriores às decisões DEC-017 (mobile first) e DEC-018 e **não** cobrem login, seletor de clínica, janela de 24 h, semana, área Clínica nem WhatsApp. Use-as apenas como referência de como as telas de atendimento se ampliam em largura (três colunas em Conversas, quadro completo no Pipeline, grade com painel lateral na Agenda). Onde divergirem de `mobile/`, vale o mobile. As versões desktop das telas novas ainda estão **Em aberto**.

## Divergências conhecidas entre mocks e especificação

Registradas para que ninguém as copie como se fossem intencionais. Corrija na implementação conforme a coluna da direita.

| Onde | Divergência | Implementar assim |
| --- | --- | --- |
| Bordas de campos, botões secundários, chips e caixas de seleção (quase todas as telas) | Usam `#CDD0D4`, que dá 1,55:1 sobre branco e viola o 3:1 exigido para bordas de controles (WCAG 1.4.11; [ux-ui.md](../product/ux-ui.md) §7) | Usar `line.controlStrong` (`#80868F`, 3,67:1) de [tokens.json](tokens.json). Os mocks ainda não foram atualizados |
| Chips e botões pequenos (M-01, M-05, M-06, M-13, M-17, M-18) | Altura visual de 36–40px, abaixo de 44px | Mesma aparência, mas área clicável ≥ 44px (UX-08, [tokens](tokens.json) `size.note`) |
| M-06 Agenda do dia | Não mostra o alternador **Dia / Semana** | Incluir como em M-13 (DEC-018) |
| M-15 Clínica | O item “WhatsApp” abre M-19 (não conectado) | Abrir M-19, M-23 ou M-24 conforme o estado real da conexão |
| M-09 Entrar | É um mock do comportamento | A tela real é o componente do Clerk com a identidade do Tredane |
| M-01 a M-14 | Mostram a barra de 3 abas (visão do Atendente) | O Responsável vê 4 abas, com **Clínica** (M-15) |
| M-20 | Aba “Salas · 3” abrevia “Salas e equipamentos” | Manter o título completo no cabeçalho e na descrição da aba; o rótulo curto cabe em 360px |
| Fonte | Os previews usam a fonte do sistema porque Inter não carrega offline | Usar Inter (400/500/600) como nos tokens; medir quebras de linha com ela |
| Hora e data | Fixas (sexta, 30 de outubro) | Sempre no fuso da clínica (DEC-008), nunca em UTC |

## Manutenção

- **Alterou um mock?** Atualize juntos: o `.dc.html`, o PNG (rode `python3 docs/design/tools/render_previews.py`; requer Node, `npm i -D playwright` e Chromium), a linha em [screens.md](screens.md) e a seção da spec. Não commite PNG que só mudou por serrilhado de fonte; regenere apenas se o desenho mudou.
- **Criou uma tela?** Dê a próxima ID (M-27…), acrescente em `mobile/canvas.json`, em [screens.md](screens.md) e na rastreabilidade de [ux-ui.md](../product/ux-ui.md) §9. Não renumere IDs existentes.
- **Mudou uma decisão ou requisito?** Atualize primeiro o documento de produto, depois o mock afetado; nunca deixe mock e spec com versões concorrentes.
- **Aprovação:** enquanto o responsável pelo produto não revisar, todos os mocks permanecem **Proposto**. Ao aprovar, registre a data e o marco em [decisions.md](../product/decisions.md).
