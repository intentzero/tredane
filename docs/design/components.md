# Componentes recorrentes

Padrões que se repetem nos mocks. Implemente cada um **uma vez** como componente React e reutilize; as medidas vêm de [tokens.json](tokens.json) e **todos os estados** aparecem no [catálogo](catalog/index.html), que é a referência de aparência de cada componente. Onde houver dúvida, o mock indicado na coluna “Onde aparece”. Estado: **Proposto** ([DEC-041](../product/decisions.md)); a biblioteca-base está em [ADR-0013](../adr/0013-design-system-components.md).

| Componente | Onde aparece | Anatomia e regras |
| --- | --- | --- |
| **Cabeçalho de tela** | M-02 a M-04, M-11 a M-26 | Botão voltar 44×44 (`aria-label` “Voltar para …”), título 17px/600 e subtítulo 13px muted. Telas de formulário fecham com “Fechar sem agendar”/“Voltar sem …” quando há alteração a perder |
| **Cabeçalho de aba raiz** | M-01, M-05, M-06, M-13, M-15 | Título 22px/600, subtítulo com clínica e estado (“Ao vivo”), avatar do usuário 44px à direita só em Conversas |
| **Barra inferior** | M-01, M-05, M-06, M-13, M-15 | 3 itens (4 para o Responsável), ícone 24 + rótulo 12px, item atual `aria-current="page"` em primary.ink/600, badge numérico no item Conversas, `padding-bottom` 22 para a área segura |
| **Chip de filtro / aba por etapa** | M-01, M-05, M-06, M-13, M-17 | Linha rolável horizontal, 40px visual (`size.controlSm`), `aria-pressed` ou `role="tab"`/`aria-selected`; selecionado = fundo text.primary e texto branco. **Hit area ≥ 44px** |
| **Item de lista de conversa** | M-01 | Avatar 44 com iniciais, nome 16/600, hora 13 (primary.ink e 600 se não lida), prévia 16 (600 se não lida), selo de estado e responsável em 13. Alvo todo clicável |
| **Selo de estado** | M-01, M-18, M-20 | Pílula 13px/600 com fundo tint e texto ink; nunca só cor: sempre texto (“Nova”, “Em atendimento”, “Encerrada”, “Ativa”) |
| **Balão de mensagem** | M-02, M-07, M-11 | Recebida à esquerda (branco, borda), enviada à direita (primary.tint), largura máx. 82%, raio 16 com um canto de 4. Linha de estado de envio abaixo (ícone + texto, 6 estados da spec §6.1). Evento de sistema centralizado em cápsula neutra |
| **Estado de envio** | M-02, M-07 | Enviando (relógio), Enviada (1 visto), Entregue (2), Lida (2, primary.ink), **Não enviada** (alerta + **Tentar de novo**), **Verificando envio…** (interrogação, sem nova tentativa). Falha e incerto: balão com fundo e borda de danger/warning |
| **Bloco de IA** | M-02, M-03, M-07 | Borda **tracejada** 1,5px ai.border, fundo ai.tint, rótulo “Sugestão da IA — revise antes de enviar” ou “Resumo da IA”. Sem botão de enviar dentro do bloco. Indisponível: borda cinza tracejada e “Você pode responder normalmente” |
| **Compositor** | M-02, M-07, M-11 | Botão de IA 44 à esquerda, campo 44+ com raio 22, enviar 44 à direita. Acompanha o teclado virtual. Fora da janela de 24 h: campo `disabled` e botão **Escolher modelo** |
| **Faixa de aviso (banner)** | M-04, M-07, M-11, M-15, M-19, M-24 | Ícone + texto, `role="alert"` (erro) ou `role="status"` (informação). Variantes: danger, warning, primary. Em M-07 fica logo abaixo do cabeçalho |
| **Folha inferior (bottom sheet)** | M-05 | Fundo escurecido, alça, título, opções de 52–56px, **Cancelar**. `role="dialog"`, foco preso, Esc fecha. Usada para escolhas curtas |
| **Diálogo de confirmação** | M-26, M-08 | `role="alertdialog"`, ícone, título, consequências, campo de confirmação quando destrutivo, botão destrutivo desabilitado até confirmar, **Cancelar** |
| **Rodapé de ação** | M-03, M-04, M-12, M-16 a M-22, M-24 a M-25 | Barra fixa com `padding-bottom` 30 (área segura), botão primário 52px de largura total; secundário ao lado (Cancelar) ou abaixo (link) |
| **Campo de formulário** | M-04, M-09, M-12, M-16, M-21, M-22 | Rótulo 14px acima (sempre `<label>`), controle 48px, raio 10, borda input, texto 16px. Erro: borda danger + mensagem abaixo ligada por `aria-describedby` |
| **Lista de linhas com ação** | M-15, M-17, M-18, M-20 | Cartão branco com divisores; linha ≥ 64px com título 16/600, subtítulo 14 muted, estado à direita e seta. Linha toda clicável |
| **Seletor de horário** | M-04 | Faixa rolável de dias (60×64) e botões de horário de 52px com recurso à direita; selecionado = borda 2px primary e tint. Horário indisponível sai da lista |
| **Item de compromisso** | M-06, M-13 | Hora 14/600 + cartão com contato, serviço, recurso e estado. Bloqueio e fora do expediente em hachura com **rótulo de texto** |
| **Interruptor / caixa de seleção** | M-14, M-16, M-21, M-22 | `<input type="checkbox">` nativo de 22–28px, na linha inteira clicável (≥ 44px) |

## Estados dos componentes interativos

Valem para todos os componentes da tabela acima; o [catálogo](catalog/index.html) mostra cada um.

| Estado | Regra |
| --- | --- |
| Normal | Como nos mocks |
| Pressionado (`:active`) | Botão primário: fundo `primary.ink`. Botão secundário e chip: fundo `surface.sunken`. Linha de lista: fundo `surface.sunken`. Sem animação além de 100 ms |
| Foco (`:focus-visible`) | Anel de 2px em `primary.base`, deslocado 2px (`size.focusRingWidth`/`focusRingOffset`), nunca removido. Em campo de texto, a borda também passa a `primary.base` |
| Desabilitado | Botão: fundo `line.disabled` e texto `text.secondary`, cursor “not-allowed”. Campo: fundo `surface.sunken`. O motivo aparece em texto quando não for óbvio (por exemplo, “Marque a caixa para continuar”) |
| Carregando | Botão mantém largura e cor, troca o rótulo (“Confirmando…”), `aria-busy="true"` e não aceita novo toque |
| Erro (campo) | Borda de 2px em `danger.ink` e mensagem abaixo, com ícone, ligada por `aria-describedby`; `aria-invalid="true"` |
| Selecionado | Chip: fundo `text.primary` e texto branco. Opção de lista: borda de 2px em `primary.base` e fundo `primary.tint` |
| Hover | Não faz parte do desenho mobile; no desktop, usar o mesmo tratamento do estado pressionado com intensidade menor |

## Regras gerais de implementação

- **HTML semântico primeiro:** `<button>`, `<a href>`, `<label>` + `<input>`, listas reais. Nada de `div` com `onClick`.
- **Texto em português exatamente como nos mocks** quando o mock é a referência do texto (mensagens de erro, avisos, rótulos de estado); mudanças de copy passam por revisão do produto.
- **Cores, raios, fontes e espaços só por token**, nunca valores soltos no componente (`tools/check_mocks.py` faz essa verificação nos mocks).
- **Dados dos mocks são fictícios** (nomes, telefones, horários); não os copie para fixtures de teste sem marcar como sintéticos.
- **Tempo real:** nenhum componente de lista pode assumir que o evento chegou uma vez; deduplicar por ID e reconciliar com a API ao reconectar (REQ-041). Evento remoto não rouba foco nem rolagem (UX-07).
