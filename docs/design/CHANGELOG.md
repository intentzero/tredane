# Histórico do design

## 13/11/2026 — M-33 Recebimento: prazo em presets (**Confirmado**, DEC-179)

- `mobile/Recebimento.dc.html`: cartão **Prazo e política de cancelamento** com presets **15 min · 30 min · 1 h · 2 h · 6 h · 24 h · 48 h** (2 h selecionado no estado inicial) e **Outro…** (número + unidade min|h; mín. 15 min, máx. 48 h; valor conceptual em minutos, `deadlineSeconds` no servidor). Mantém textarea da política e **Salvar prazo e política**. Alinha a DEC-175 (faixa + dois cartões). Fecha o Em aberto «prazo do Pix em opções» (**Confirmado** Paulo 13/11/2026 — mock #731). Painel: `RecebimentoScreen` + `deadlinePresets`.

## 12/11/2026 — DEC-176: ficha do serviço e «O que a IA reconhece»

- `ServicesScreen` / `VariantCatalog`: modo e «Para quem» em segmentos (`vc-seg`), aviso de singular igual ao plural, opções agrupadas pelo nome (`variantGroups`), folha da opção com uma linha por público e **Aplicar**, «Alterações por salvar», «Como fica na agenda» com exemplo. `ServiceWords` em `/clinica/servicos/palavras`. Mocks M-79 `mobile/ServicoTopo`, M-80 `mobile/ServicoOpcoesAgrupadas`, M-81 `mobile/ServicoEditarOpcao` e M-82 `desktop/ServicosPalavras`.

## 12/11/2026 — DEC-171: revisão da Equipe

- `EquipeScreen`: confirmação ao cancelar convite; selo de responsável em `primary.tint`; uma coluna de 760 px no desktop; contagens nos títulos; ações do convite em texto (desktop) ou no ⋮ com folha (celular); bloco «O que cada papel pode fazer». Mocks M-77 `mobile/EquipeConviteAcoes` e M-78 `mobile/EquipeCancelarConvite`.

## 12/11/2026 — DEC-170: topo da Agenda compacto

- `PanelShell` ganha o espaço `panel-shell-slot` (`ShellSlot`); a Agenda põe ali setas, Hoje, data, Dia/Semana e Agendar. No celular, uma linha com a data curta (`formatShortDate`) e a faixa de dias com setas de semana. Mocks M-76 `mobile/AgendaTopoCompacto` e `desktop/AgendaBarraCabecalho`.

## 12/11/2026 — DEC-169: Assumir em linha no compositor

- `InboxThread` troca o cartão de handoff (~132 px no celular) por uma linha de 44 px dentro do dock do compositor; **Precisa de alguém** em bloco âmbar compacto; mock M-75 `mobile/AssumirLinha`.

## 12/11/2026 — Tokens 0.8.0: densidade de toque (Confirmado, DEC-168)

Pedido do responsável pelo produto (12/11/2026): os botões ficavam pequenos no celular. O desktop mantém a v0.4.0 (DEC-081); em `@media (pointer: coarse)` os tokens mudam:

| Token | Desktop | Toque |
| --- | --- | --- |
| size controlSm / Md / Lg | 28 / 32 / 36 | 36 / 44 / 48 |
| size controlDefault | 36 | 44 |
| size bottomNav | 48 | 56 |
| font.size button (novo) | 14 | 16 |

- `build_tokens.py` gera o bloco `@media (pointer: coarse)` a partir de `touch` em `tokens.json`.
- `panel.css`: botões usam `--font-size-button`; secundário e perigo ficam em `--size-control-md` no toque (44), o primário em `--size-control-lg` (48).
- Área de toque ≥ 44 px também em `.panel-btn-ghost`, `.panel-btn-compact` (agora com `min-width: 44px`), `.panel-move`, `.panel-sheet-option` e `.panel-clinic-switch`, que ficavam em 36 px.
- Mocks `.dc.html` e PNG ainda mostram os tamanhos do desktop.

## 12/11/2026 — Bolhas da conversa nas laterais (revê DEC-162 item 7)

- **Conversas desktop:** a timeline deixa a coluna centrada de 680 px e a margem de 7 %; padding lateral ~12 px e bolhas até 65 % alinhadas às laterais do pai (como WhatsApp Web). Dock/handoff fechado mantêm 680 px. Mock `desktop/ConversasUrgenciaFicha` alinhado.

## 12/11/2026 — DEC-162 a DEC-165 implementadas no painel

- **Conversas (DEC-162):** `InboxList` agrupa por urgência (`urgency.ts`), mostra a espera e esconde busca e filtros na caixa vazia (`InboxEmptyStart`); `ShellIdentity` reduz «Ao vivo» a ponto no celular; `InboxThread` ganha o cartão único da conversa nova com janela fechada e «Vista por»; Agendar abre em folha no celular (`MobileThread`); Contato em tela focada com atalhos e ações em linhas.
- **Clínica (DEC-163):** índice com valores atuais e faixa do passo em falta (`ClinicHub`); cabeçalho único nas telas internas (`ClinicSubHeader`); Serviços com preço à direita e busca; Horário sem horário próprio com «Usar esse horário»; Assistente com a decisão primeiro e a previsão no fim.
- **Tema escuro (DEC-164):** botões e preenchimentos em teal usam `primary.fill` / `primary.onFill`; contadores e grupo «Sem responsável» em `attention`.
- **Agenda e Clientes (DEC-165):** cartões de duas linhas com cor da profissional; compromisso reorganizado; grade do dia por profissional no desktop; Clientes com próximo horário ou última visita (API `nextVisit` / `lastVisit`).

## 11/11/2026 — DEC-164: tema escuro revisto · tokens v0.7.0

- Superfícies escuras em cinza-azulado com três degraus (`surface.raised` novo); texto principal #E4E7E6; botão primário em `primary.fill` #1F7A7C com texto branco; nova cor `attention` (laranja da marca) para gente à espera.
- Tokens novos também no claro: `surface.raised`, `primary.fill`, `primary.onFill`, `attention.base|onBase|ink`.
- Oito pares novos em `contrastPairs`; `check_contrast.py` passa (74 pares). `tokens.css`, catálogo e `src/client/ui/tokens.css` regenerados.

## 11/11/2026 — DEC-163: Clínica em uso (**Confirmado**, mocks M-71 a M-74)

- Revisão do staging na clínica demo; Paulo aprovou as cinco propostas («Aprovo todas»).
- Mocks novos: `mobile/ClinicaIndice` (M-71), `ServicosLista` (M-72), `HorarioSemHorarioProprio` (M-73), `AssistenteDecisoes` (M-74) e `desktop/ClinicaServicosTabela`. Só tokens existentes (`check_mocks.py` passa).
- **Pendente:** previews PNG não gerados; quatro pontos Em aberto na DEC-163; nada implementado no painel.

## 11/11/2026 — DEC-162: Conversas por urgência (**Confirmado**, mocks M-66 a M-70)

- Revisão do staging em 390 px e 1440 px; Paulo aprovou as seis propostas («propostas aprovadas»).
- Mocks novos: `mobile/ConversasListaUrgencia` (M-66), `ConversasListaVaziaPasso` (M-67), `ConversaNovaJanelaFechada` (M-68), `AgendarFolhaConversa` (M-69), `ContatoFocado` (M-70) e `desktop/ConversasUrgenciaFicha`. Só tokens existentes (`check_mocks.py` passa); sem token novo.
- **Pendente:** previews PNG não gerados (Playwright não está instalado neste checkout); nada implementado no painel.

## 11/11/2026 — DEC-161 implementada no painel

- `InboxThread.tsx`: cabeçalho com Agendar primário (ícone de 44 px no celular) e ⋮ agrupado (`ThreadAction.group`); botão Contato removido (a ficha abre pelo nome); linha de estado em texto; cartão `inbox-handoff` acima do compositor (substitui a faixa «Ninguém/X está atendendo» e o cartão «Comunicação pendente»; «Assumir conversa»); `[Botão] X` → evento `inbox-msg-event`; `Agendado: …` → cartão verde; 3+ linhas «Rótulo: valor» → grade `inbox-msg-fields`; prazo 24 h dentro da barra (`windowHintShort`), pílula só com < 1 h.
- `InboxList.tsx`: «Precisam de alguém» em segundo, em aviso quando > 0; contadores 0 escondidos. `NeedsPersonAlerts.tsx`: faixa global some se a única conversa à espera é a aberta.
- `panel.css`: fundo liso, rail escuro `--color-nav-*` (≥ 1280 px), ficha em coluna de 300 px ≥ 1440 px (sem Agendar aberto). `src/client/ui/tokens.css` sincronizado com v0.6.0.

## 11/11/2026 — DEC-161: cinco pontos da Conversa focada (**Confirmado**) · tokens v0.6.0

- Paulo respondeu às divergências uma a uma: fundo liso; ficha em coluna fixa ~300 px no desktop ≥ 1440 px; Agendar como ícone no cabeçalho do celular; prazo 24 h dentro da barra (pílula só < 1 h); rail escuro.
- **Tokens v0.6.0:** grupo `color.nav` (`base`, `logo`, `active`, `icon`, `iconActive`) em claro e escuro, com dois pares novos em `contrastPairs` (3:1, ícones); `check_contrast.py` passa (58 pares).
- **Ampliado (Paulo, «Sim, confirma tudo»):** toda a proposta fica Confirmada — cabeçalho com Agendar + ⋮ (Contato pelo nome), linha de estado, cartão único «Precisa de alguém» com Assumir, mensagens do sistema em cartões, toques como eventos, filtro «Precisam de alguém». Atalhos de teclado seguem Proposto.
- `desktop/ConversaFocada` e `ConversaCabecalhoAntesDepois` passam a usar só tokens (o ponto do símbolo usa o damasco da marca `#E8875A`); a lista de valores fora de tokens da entrada abaixo deixa de valer.

## 11/11/2026 — Conversa focada: Agendar + ⋮ e handoff junto ao campo (**Proposto**)

- Revisão do staging pedida por Paulo («reduzir carga cognitiva», «muitos botões no canto superior direito», Agendar continua prioritário). Novos mocks `desktop/ConversaFocada` (interativo: ⋮ e nome), `desktop/ConversaCabecalhoAntesDepois` e `mobile/ConversaFocada` (M-65). Canvas de trabalho privado: «Tredane — Conversas redesign».
- Proposta: cabeçalho com 2 controles (Agendar, ⋮), Contato pelo nome; 1 linha de estado; um único cartão «Precisa de alguém» com Assumir acima do compositor; mensagens do sistema como cartões; toques em botões como eventos; painel de contexto com próxima visita; fundo liso.
- O mock mobile usa só tokens (`check_mocks.py` passa). O desktop usa valores **fora** de `tokens.json`, a converter em tokens se a proposta for aceite: rail `#0A2E2F` / `#134446` / `#1B5A5B` / `#9FC3C1`, avatar quente `#F7E6D2` / `#7A4A12`, IA `#F2EEFC` / `#E4DCF7`, aviso `#FFF1DC` / `#D98A1F` / `#5B4520`, sucesso `#CDE7D8` / `#145A38` / `#24533C`, superfícies `#F7F6F2` / `#F2F1EC` / `#ECEBE5` / `#E8E7E1`; raios 10 e 14 px; fonte 12 e 15 px.
- ⋮ mantém **Bloquear contato** e **Excluir contato** (só owner) no fim, conforme TR-488 (correção pedida por Paulo no mesmo dia).
- Divergências com decisões Confirmadas registadas no README e em `ux-ui.md`; nada implementado.

## 09/11/2026 — Novo serviço: teclado não cobre Nome (**Confirmado**)

- Mock `mobile/ServicoTeclado` (M-64) e painel: **Confirmado (Paulo, 09/11/2026, Opção A)** — com teclado aberto, `.clinic-footer-sticky` some via `:root[data-keyboard='open']` (`useKeyboardViewport`); ao fechar, o rodapé volta. Sem token novo. Opção B descartada.

## 04/11/2026 — Faixa Horários livres sai da conversa (**Confirmado**)

- **Confirmado (Paulo, 04/11/2026, «Não quero isto»):** remove a faixa **Horários livres** e o ícone do compositor (carga cognitiva; redundante com **Agendar** no cabeçalho). Agendar / TEL-05 é o único caminho de marcação da atendente na thread. Mocks `ConversaCompositor` e `ConversaWhatsappWeb` sem o ícone; `FreeSlotsStrip.tsx` removido. Spec em `ux-ui.md`.

## 04/11/2026 — «Reservar bloco» sai do ⋮ da conversa (**Confirmado**)

- **Confirmado (Paulo, 04/11/2026, Opção A):** M-55 e `ConversasControlesMenu` sem «Reservar bloco»; agendamento a partir da conversa é só **Agendar** no cabeçalho. Modo Horário exato | Por período fora do chrome da conversa (Opção B adiada). M-39 permanece alcançável pelo Agendar da Agenda. Spec em `ux-ui.md`.

## 02/11/2026 — Horários livres bloqueia serviço com variantes (**Confirmado**; supersedido 04/11)

- **Confirmado (Paulo, 02/11/2026):** na faixa **Horários livres** do compositor, serviço com variantes (ex. Depilação) não mostra grade nem «Colocar no campo»; hint para usar **Agendar** no cabeçalho. **Supersedido em 04/11/2026:** a faixa foi removida por completo.

## 01/11/2026 — Conversa ao estilo WhatsApp Web e compositor em barra (**Confirmado**)

- Novos mocks `desktop/ConversaWhatsappWeb`, `ConversaCompositor` e `ConversaBolhas`, com previews PNG. Substituem o thread de `ConversasDesktopPropostaThread` como referência da conversa aberta; a lista não muda.
- **Confirmado e implementado (Paulo, 01/11/2026, «Sim, implementa»):** fundo com textura própria (claro e escuro), bolhas sem borda com sombra e cauda na primeira do grupo, hora em linha, remetente no início do grupo, chips centrais para data e eventos, margem de 7 % e bolhas até 65 % no desktop; compositor em barra flutuante com Sugerir resposta (e, até 04/11/2026, Horários livres) como ícones e avisos em pílulas. `InboxThread.tsx` e `panel.css`.
- Cores fora de `tokens.json`, locais à conversa em `panel.css` (`--chat-*`): fundo `#EFEAE2` / `#0B1413`, enviada `#D9F2EE` / `#163A38`, lida `#2A7FBF` / `#6CC4F0`. Fora: botão «+» do compositor.

## 31/10/2026 — Clínica: menos carga cognitiva (**Proposto**)

- Novos mocks `mobile/ClinicaPassoAgora` (M-60), `ClinicaPronta` (M-61), `ClinicaAssistente` (M-62) e `desktop/ClinicaVisaoGeral`. Não substituem M-15 até a confirmação; sem token novo.
- Proposta: um só próximo passo enquanto falta configurar; áreas agrupadas por pergunta quando pronta; «Conferir» vira alerta só com pendência; IA e limites saem do início para «Assistente e automações». Previews PNG ainda não gerados (falta Playwright neste ambiente).
- **Implementado a pedido de Paulo («implementa», 31/10/2026):** `ClinicHub` com próximo passo + «O caminho» (a configurar) e áreas por pergunta (pronta); nova rota `/clinica/assistente` com Local da previsão, Sugestões com IA e Limites das automações (só owner vê a entrada); alerta «N serviços não podem ser marcados» no lugar da linha «Conferir» no hub. Também: limites com «Personalizar os 9 limites» (números recolhidos por padrão) e hub pronto em duas colunas no desktop. Fora: opção «Neutro» de género (não está na DEC-089).


Registra mudanças nos tokens e nos mocks. Mais recente primeiro. IDs de telas não são renumerados.


## 31/10/2026 — Agenda: semana em cartões e Abrir conversa (**Proposto**)

- Propostas visuais (canvas externo «Agenda: segunda rodada de UI/UX», privado): Semana, Compromisso com cancelar e sinal, Dia sem horários, Semana desktop. Implementado só o que os dados permitem: semana no celular em cartões por dia e «Abrir conversa» no compromisso. Fora: barra de ocupação, horários livres sugeridos, cancelar com cartões de rádio.


## 31/10/2026 — Agenda: livres e ocupação do expediente (**Proposto**)

- Sem mock novo: segue o canvas privado «Agenda: segunda rodada de UI/UX» (Semana, Dia sem horários, Semana desktop). Texto em `ux-ui.md` (TEL-04).
- **Implementado:** `GET …/agenda` devolve `availability` (expediente, livres, bloqueios por profissional e dia); semana com «N livres» e barra de ocupação; dia com livres e «Agendar» que leva dia, hora e profissional ao Agendar; dia sem horários mostra os três primeiros livres. Sem token novo.

## 31/10/2026 — Tema claro/escuro/sistema (paleta **Confirmada**, DEC-098)

- `tokens.json` v0.5.0: novo grupo `colorDark` (mesmos papéis de `color`); `tokens.css` passa a emitir `:root[data-theme="dark"]` e `@media (prefers-color-scheme: dark)` com `:root:not([data-theme="light"])`. `check_contrast.py` valida os pares nos dois temas (54 verificações, todas dentro do mínimo).
- Mock M-56 `mobile/Aparencia.dc.html` (Sistema, Claro, Escuro; escolha só no aparelho). Preview PNG ainda não gerado.
- **Confirmado (Paulo, 31/10/2026, «Aprovar paleta» e «implementa»):** valores escuros, armazenamento no aparelho e Sistema como padrão.
- **Implementado:** `src/client/panel/theme.ts` (leitura, aplicação e escuta do sistema), script em `index.html` que aplica `data-theme` antes da primeira pintura, seção Aparência no `AccountMenu`, `tokens.css` sincronizado e cores fixas do `panel.css` trocadas por tokens. Fora do tema ainda: pessoas na agenda (paleta própria) e telas hospedadas do Clerk. Nada do painel implementado consome `colorDark` ainda.

## 31/10/2026 — Agenda: semana em cartões e Abrir conversa (**Proposto**)

- Propostas visuais (canvas externo «Agenda: segunda rodada de UI/UX», privado): Semana, Compromisso com cancelar e sinal, Dia sem horários, Semana desktop. Implementado só o que os dados permitem: semana no celular em cartões por dia e «Abrir conversa» no compromisso. Fora: barra de ocupação, horários livres sugeridos, cancelar com cartões de rádio.

## 31/10/2026 — Controlos da thread (Opção A **Confirmada**)

- **Confirmado (Paulo, 31/10/2026, Opção A):** Resumo da IA e Bloquear só no Contato; menu ⋮ / folha M-55 só conversa/pipeline; header Agendar · Contato · ⋮.
- Desktop: `ConversasControlesMenu.dc.html`, `ConversasControlesContato.dc.html` + previews.
- Mobile: M-55 `AcoesConversaProposta.dc.html` (M-40 histórico).
- Implementação: `InboxThread` / `InboxContact`; testes de menu e bloqueio no Contato.

## 31/10/2026 — M-54 Conversas lista mobile (**Confirmado**, Opção A)

- Mock `mobile/ConversasListaProposta.dc.html` + preview `M-54-ConversasListaProposta.png`: lista contínua full-bleed, busca sunken, densidade DEC-081, shell intacto.
- **Confirmado (Paulo, 31/10/2026, Opção A):** implementação em `panel.css` (`.inbox-root` / `.inbox-search-input` / `.inbox-list` / tipografia da linha). Sem mudança de filtros, jornada ou regras.

## 31/10/2026 — Conversas desktop densidade WA (**Confirmado**, Opção A)

- Mocks `desktop/ConversasDesktopProposta.dc.html` (empty) e `ConversasDesktopPropostaThread.dc.html` (thread): rail Tredane (DEC-068/070), lista ~400 px, empty simples, thread com bolhas/compositor; tokens DEC-041/050/073/081. Sem logo WhatsApp, verde Meta nem Meta AI.
- Previews: `desktop/previews/ConversasDesktopProposta.png`, `ConversasDesktopPropostaThread.png`.
- **Confirmado (Paulo, 31/10/2026, Opção A):** implementação no painel (`panel.css` / empty pane) — lista 400 px ≥1280, busca sunken, linhas densas, thread alinhada aos mocks.

## 31/10/2026 — Entrar / splash (Confirmado Paulo, «Faz»)

- **M-09 Entrar** e `desktop/Entrar.dc.html`: marca horizontal (DEC-070) + formulário + «Sem convite?» num bloco centrado; fundo `surface.app` com mancha `primary.tint`.
- **Implementação:** `.panel-auth` / `.panel-auth-stack` / `.panel-auth-atmosphere` em `panel.css`; `ClerkLogin` e `SyntheticLogin` usam o bloco centrado (fluxo Clerk inalterado).
- `tools/render_previews.py` resolve `../brand/` para `file://` absoluto nos HTML temporários.

## Tokens 0.4.0 — 30/10/2026 (Confirmado, DEC-081)

Pedido do responsável pelo produto (30/10/2026): alinhar a tipografia ao WhatsApp Web e deixar botões e campos menos altos. Valores **Confirmados** em 30/10/2026 (DEC-081).

| Token | Antes | Depois |
| --- | --- | --- |
| font.size caption / small / body / title / headline / display | 12 / 14 / 16 / 18 / 22 / 26 | 11 / 13 / 14 / 16 / 18 / 22 |
| font.lineHeight default / relaxed | 1,4 / 1,45 | 1,35 / 1,4 |
| radius sm / md / lg / xl | 8 / 12 / 16 / 20 | 6 / 8 / 12 / 16 |
| size controlSm / Md / Lg | 40 / 48 / 52 | 28 / 32 / 36 |
| size controlDefault (novo) | — | 36 (altura visual padrão; substitui `--size-touch` em `min-height` de controles com texto) |
| size avatarSm / avatarMd, rowMin, bottomNav | 40 / 44, 64, 52 | 32 / 40, 60, 48 |

`--size-touch` (44) fica para botões só de ícone. Pendências tratadas depois: área clicável de 44 px por pseudo-elemento nos controles que encolheram (campos de texto nativos ficam com 36 px, exceção **Confirmada** em `ux-ui.md`); campos em 16 px só em aparelho de toque; mocks e PNG regenerados. Confirmado pelo responsável (DEC-081).

## 29/10/2026 — Coluna de Conversas com 30% da janela

- Desktop: a lista deixa de ter 360 px fixos e passa a `30%` da janela, mín. 360 e máx. 520 px (medido no WhatsApp Web: 518 px a 1728 px). Mock `desktop/Main.dc.html` atualizado; preview `Main.png` regerado.

## 29/10/2026 — Redesenho do horário da clínica (#207, #224)

- **M-17 Horários** refeito: resumo, sete dias com editor único, folgas e fechamentos na mesma página, barra de salvar condicional. Novos: **M-49** (editar um dia), **M-50** (folga ou fechamento), **M-51** (quem fica fora). Desktop: `desktop/Horarios` na moldura #211 com painel #212 (**Proposto**, ainda não implementado).
- **Cores das pessoas** (azul `#2563A8`, laranja `#C2410C`, verde `#2F7D4F`, com fundo e texto próprios): exceção declarada em `tools/check_mocks.py`; não são tokens. 4.ª pessoa em diante: cinza (`text.muted`) com iniciais no ponto (**Confirmado**, 29/10/2026, #223).
- `tools/shot.mjs` passa a capturar o mobile em página inteira (mocks mais altos que 844 px).

## 29/10/2026 — Agendar em painel ao lado da conversa (DEC-074)

- **M-04 Agendar:** no desktop abre como painel de 420 px à direita da conversa (por cima, no lugar do contato). Conteúdo e estados do mock não mudam. Implementado em `ConversasThreeCol` e `AgendarScreen` (modo `embedded`). O canvas de design traz também «Preencher pela conversa» e a faixa «Agendado», ainda **Proposto** e fora do código.

## Tokens 0.3.1 — 29/10/2026 (Confirmado)

**Aprovado pelo responsável pelo produto em 29/10/2026** ([DEC-073](../product/decisions.md)): `font.family` passa de `Inter, system-ui, sans-serif` a `Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif`, a fonte do WhatsApp Web. Tamanhos, pesos, alturas de linha e cores não mudam. Painel e login Clerk carregam Roboto 400/500/600 por `@fontsource/roboto` 5.3.0 (licença em `docs/licenses/Roboto-OFL.txt`); `@fontsource/inter` saiu do painel. A landing page continua com Inter. Os mocks `.dc.html` antigos ainda pedem Inter e não foram reescritos.

## 27/10/2026 — Ajustes da revisão de UX do staging (#134–#139)

- **M-02 Conversa:** botão **Agendar** com texto no cabeçalho; menu ⋮ passa a dizer «reservar bloco, encerrar».
- **M-05 Pipeline (Acompanhamento):** cabeçalho «N nesta etapa · M em andamento»; «Sem compromisso» → «Sem horário marcado»; botão **Abrir conversa** em cada cartão. O botão **Mover** não muda.
- **M-39 Reservar bloco** (novo): chips de dia como no Agendar, resumo com «Alterar», «Outra» para duração, aviso à paciente opcional. Antes não havia mock próprio.
- Previews M-02, M-05 e M-39 renderizados.

## Tokens 0.3.0 — 27/10/2026 (Confirmado)

**Aprovado pelo responsável pelo produto em 27/10/2026** (DEC-050 e DEC-041): a cor de ação passa do azul à cor da marca (Petróleo) e os neutros ganham um leve matiz da Tinta. Estrutura, tipografia, formas, espaçamento e as cores semânticas (sucesso, aviso, perigo, IA) não mudam. Conversão aplicada aos mocks mobile e desktop, ao catálogo, ao painel, ao login Clerk e ao site:

| Token | 0.2.0 | 0.3.0 |
| --- | --- | --- |
| primary.base | `#2F5BD3` | `#0E5A5C` |
| primary.ink | `#1E43A8` | `#0A4547` |
| primary.tint | `#EEF2FC` | `#E7F1F1` |
| primary.border | `#B9CBF2` | `#B3D1D1` |
| surface.app | `#F6F6F4` | `#F5F4EF` |
| surface.sunken · line.divider | `#F0F0EE` | `#EEEDE7` |
| text.primary | `#1C1E21` | `#142625` |
| text.secondary | `#474C54` | `#424B4A` |
| text.muted | `#5B616B` | `#566160` |
| line.border | `#E2E3E5` | `#E1E3E0` |
| line.control | `#80868F` | `#7A8584` |
| line.disabled | `#CDD0D4` | `#CBD0CF` |

Contraste: os 27 pares de `contrastPairs` continuam acima do mínimo (`check_contrast.py`). Pendente: os PNG de `mobile/previews` e `desktop/previews` ainda mostram o azul e precisam de nova renderização (`render_previews.py`); `site/public/og-image.png` também.

## 24/10/2026 — Pipeline vira Acompanhamento (DEC-045)

- Rótulos visíveis “Pipeline” → “Acompanhamento” e “oportunidade” → “contato em andamento” nos mocks mobile e desktop; nomes de arquivo e IDs mantidos. Previews regenerados.
## Tokens 0.2.0 — 24/10/2026 (Confirmado)

**Aprovado pelo responsável pelo produto em 24/10/2026** (DEC-041): paleta, tipografia, formas e espaçamento, componentes e estados, ícones Lucide. Biblioteca-base **Confirmada** depois na mesma data (DEC-048): React Aria Components; Radix descartado ([ADR-0013](../adr/0013-design-system-components.md)).

Consolidação dos valores que os mocks 0.1 usavam de forma acidental em escalas pequenas, aplicada aos 26 mocks mobile por regras fixas e conferida por `tools/check_mocks.py`. Os 4 mocks desktop receberam só cores, raios e fontes (sem espaçamento nem alturas) e seguem como referência de layout.

| Dimensão | Antes | Depois | Regra de conversão |
| --- | --- | --- | --- |
| Cores | 35 | 25 | `#F3F3F1`, `#EBEBE8`, `#FAFAF9`, `#EFEFF0` → `#F0F0EE` (surface.sunken); `#E8EEFB`, `#F3F5FB` → `#EEF2FC` (primary.tint); `#8F5600` → `#6E4200` (warning.ink); `#8A1C12` → `#B42318` (danger.ink); `#E9C2BD` → `#CDD0D4` e `#5C130C` → `#474C54` (desabilitado neutro); `#D8CCF3` → `#6B3FD4` (ai.border) |
| Borda de controle | `#CDD0D4` (1,55:1, falhava 3:1) | `#80868F` (3,67:1) | Toda borda `solid`/`dashed` em `#CDD0D4` → `line.control` |
| Fonte | 13 tamanhos (11 a 28) | 6: 12, 14, 16, 18, 22, 26 | 11→12; 13→14; 15→16; 17 e 19→18; 20 e 24→22; 28→26 |
| Raios | 10 valores | 5: 8, 12, 16, 20, 999 | 9 e 10→8; 14→16; 18, 22 e 28→999. Exceções declaradas: 3px (alça da folha) e 4px (canto do balão) |
| Espaçamento | valores soltos (6, 10, 13, 14, 18…) | escala 4, 8, 12, 16, 20, 24, 32 | 6→8; 10→12; 14 e 18→16 em padding, margin e gap. O 13px usado ao lado de uma borda esquerda de 3px permanece |
| Altura de controle pequeno | 32 e 36px | 40px | `height: 32/36px` → 40px. Área clicável continua exigindo ≥ 44px |

Correções de layout feitas junto: faixas de horário de M-17 em 14px (não quebram), selo de papel de M-18 abaixo do e-mail (não sobrepõe), listas com `overflow: hidden` sem encolher em M-15, M-17, M-18 e M-20, rótulo de aba de M-20 (“Salas · 3”).

Novos nesta versão: `tokens.css` (gerado), `catalog/index.html` (catálogo com estados), `tools/check_contrast.py`, `tools/check_mocks.py`, `icons.md`.

## Tokens 0.1.0 — 24/10/2026

Extração inicial dos 26 mocks mobile, sem consolidação.
