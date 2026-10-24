# ADR-0003 — WebSockets hibernáveis e coordenação de eventos

- **Estado:** Aceito o uso de WebSockets hibernáveis em Durable Objects; **confirmado por DEC-038** um Durable Object por clínica com SQLite nativo operacional; ver [ADR-0012](0012-clinic-durable-object-sqlite.md).
- **Origem:** [DEC-004 e DEC-005](../product/decisions.md), 23/10/2026.

## Problema

Inbox, Pipeline e Agenda devem atualizar entre sessões sem recarregar a página. É obrigatório não distribuir eventos de uma clínica para outra e recuperar o estado após quedas ou hibernação.

## Decisão e hipótese

**Confirmado:** usar Durable Objects com WebSocket Hibernation API para manter conexões com custo controlado. **Confirmado em DEC-038:** o Worker autoriza a conexão e a encaminha ao DO da clínica. O objeto coordena operações e distribui eventos mínimos após persistência no seu SQLite; notificações administrativas originadas no D1 exigem entrega idempotente e autorização vigente.

O SQLite persistente do DO é a fonte de verdade operacional, incluindo conversas e agendamentos; o D1 central é a fonte administrativa/memberships/suporte. A memória do DO não é fonte de verdade. A interface refaz leituras ao conectar e reconectar; eventos repetidos não podem duplicar registros.

## Fronteira de segurança

Validar associação e sessão antes do upgrade, vincular a conexão ao tenant e verificar a validade de acesso nas entregas/revogações. Conexão antiga que perde permissão deve deixar de receber dados. Metadados mínimos da sessão podem ser anexados ao WebSocket para sobreviver à hibernação; nunca guardar tokens brutos ou conversas completas nos anexos.

**A validar:** capacidade de um objeto por clínica e eventual particionamento futuro; formato de evento, versão/ordenação; mecanismo efetivo de invalidar conexões ao revogar membro; custo e carga em teste.

## Alternativas rejeitadas para a primeira fatia

Polling como fonte principal de tempo real e event bus em memória de Worker. Polling pode existir como fallback/reconciliação, não substitui o requisito confirmado.

**Referência:** https://developers.cloudflare.com/durable-objects/best-practices/websockets/
