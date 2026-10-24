# Ícones

**Estado:** Lucide **Confirmado** como biblioteca de ícones (DEC-041, 24/10/2026); os nomes da tabela ainda precisam ser conferidos na instalação. Os mocks desenham 26 SVGs soltos, copiados em cada arquivo, que são aproximações de um estilo de traço (24×24, traço de 2px, pontas e junções arredondadas, sem preenchimento). Para implementar, use **uma biblioteca de ícones** em vez de copiar os SVGs dos mocks.

## Proposta

**Lucide** (pacote `lucide-react`), por ser de traço no mesmo estilo dos mocks, ter licença permissiva (ISC) e cobrir todo o inventário abaixo. Os nomes da coluna “Lucide” foram escritos de memória e **precisam ser conferidos na instalação**; se algum não existir, escolha o equivalente mais próximo e atualize esta tabela. A aparência final pode diferir levemente dos mocks, o que é esperado.

## Regras

- Tamanho 24 na barra inferior, 20 em botões e campos, 16 a 18 inline com texto. Traço 2.
- Ícone **decorativo** leva `aria-hidden="true"`. Ícone **sozinho** em botão leva `aria-label` no botão (“Voltar para Conversas”, “Fechar sem agendar”).
- Ícone nunca é o único sinal de estado: acompanha texto (ver [components.md](components.md)).
- Cor herdada do texto (`currentColor`); use apenas tokens de cor.

## Inventário (o que os mocks usam)

| Uso | Onde | Lucide (a confirmar) |
| --- | --- | --- |
| Voltar | 19 telas | `chevron-left` |
| Avançar / abrir linha | M-15, M-17, M-18, M-20, M-23 | `chevron-right` |
| Aba Conversas | Barra inferior | `message-circle` |
| Aba Pipeline | Barra inferior | `kanban` |
| Aba Agenda; compromisso; agendar | Barra inferior, M-03, M-04 | `calendar` |
| Aba Clínica | Barra inferior | `sliders-horizontal` |
| Buscar | M-01 | `search` |
| IA (sugerir, rótulo do bloco) | M-02, M-03, M-11 | `sparkles` |
| Enviar | M-02, M-07 | `send-horizontal` (os mocks desenham uma seta) |
| Fechar / descartar | M-02, M-04 | `x` |
| Gerar outra / atualizar / reconectando | M-02, M-07, Estados | `rotate-cw`, `refresh-cw` |
| Mais ações | M-02, M-18 | `ellipsis-vertical` |
| Pronto / enviada / confirmado | M-15, M-07 | `check` |
| Entregue / lida | M-02, M-07 | `check-check` |
| Enviando / janela de 24 h | M-07, M-11 | `clock` |
| Alerta, falha, conflito | M-01, M-04, M-07, M-24 | `triangle-alert` |
| Aviso de pendência | M-15, M-19, M-25 | `circle-alert` |
| Verificando envio (incerto) | M-07 | `circle-help` |
| Informação / sucesso em faixa | Catálogo | `info`, `circle-check` |
| Acesso encerrado | M-08 | `lock` |
| Adicionar | M-20 | `plus` |
| Remover bloqueio | M-17 | `trash-2` |
| Editar | M-17 | `pencil` |
| Compartilhar (instalar no iPhone) | M-14 | `share` |
| Modelo de mensagem | M-11 | `file-text` |
| Sem conexão em tempo real | Estados | `wifi-off` |

## Pendências

- Confirmar nomes e disponibilidade ao instalar a biblioteca; revisar a licença no momento da adoção.
- Decidir se o PWA terá ícones próprios do app (tela inicial, notificação): **Em aberto**, depende da identidade visual do Tredane.
