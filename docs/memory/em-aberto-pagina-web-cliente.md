# Em aberto — página web da cliente

**Estado:** **Em aberto** (vários responsáveis).

**Fonte canónica:** [ADR-0018 §8](../adr/0018-pagina-web-cliente.md). Este ficheiro é um índice para a memória do projeto; alterações de conteúdo devem manter-se consistentes com a ADR e o [runbook](../implementation/runbooks/pagina-web-cliente.md).

## Paulo (produto)

1. Validade do **crédito do sinal** — bloqueia DEC-198(c) e cancelamento automático com sinal pago.
2. Valores **60 min** (token) e **30 min** (sessão) — DEC-199, hoje **Propostos**.
3. **Valor padrão** do horizonte máximo e ecrã de configuração da owner — DEC-201.
4. **Revisão dos textos** das mensagens no chat e recibos (**Propostos**, DEC-104).
5. Aceitar ou não **remarcar** marcação com sinal pago sem aplicar janela de crédito (cancelar com sinal hoje pede à equipe).
6. Domínio e nome público da página.

## Engenharia

1. **Expurgo** por tenant e por contacto no D1 central (DEC-099, REQ-071); mesma lacuna no Flow.
2. Copy para **erro de rede** e **clínica suspensa** (hoje «link já usado»).
3. Pré-escolher **«Para quem é?»** a partir da conversa (DEC-142).
4. Suprimir no canal web a frase do chat «Horário já não está livre…».
5. **TMPL-05** — envio do link fora das 24 h.

## Externos

1. **GATE-04** — parecer LGPD (bloqueia dados reais e produção).
2. **TMPL-05** — aprovação Meta do template com botão URL.
3. **Revisão de segurança curta** antes de produção.

## Ligações

- [MEMORY.md](MEMORY.md) · [DEC-196 a DEC-201](../product/decisions.md)