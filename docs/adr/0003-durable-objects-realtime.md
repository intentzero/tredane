# ADR-0003 — WebSockets hibernáveis e coordenação de eventos

- **Estado:** Aceito o uso de WebSockets hibernáveis em Durable Objects; **proposto** um Durable Object por clínica.
- **Origem:** [DEC-004 e DEC-005](../product/decisions.md), 23/10/2026.

## Problema

Inbox, Pipeline e Agenda devem atualizar entre sessões sem recarregar a página. É obrigatório não distribuir eventos de uma clínica para outra e recuperar o estado após quedas ou hibernação.

## Decisão e hipótese

**Confirmado:** usar Durable Objects com WebSocket Hibernation API para manter conexões com custo controlado. **Proposto:** o Worker autoriza uma conexão e a encaminha a um objeto derivado da identidade da clínica. O objeto distribui eventos mínimos recebidos após a persistência no D1.

O D1 é a fonte de verdade; Durable Objects não armazenam histórico autoritativo de conversas ou agendamentos. A interface refaz leituras ao conectar e reconectar; eventos repetidos não podem duplicar registros.

## Fronteira de segurança

Validar associação e sessão antes do upgrade, vincular a conexão ao tenant e verificar a validade de acesso nas entregas/revogações. Conexão antiga que perde permissão deve deixar de receber dados. Metadados mínimos da sessão podem ser anexados ao WebSocket para sobreviver à hibernação; nunca guardar tokens brutos ou conversas completas nos anexos.

**A validar:** um objeto por clínica vs particionamento quando houver mais conexões/tráfego; formato de evento, versão/ordenação; mecanismo efetivo de invalidar conexões ao revogar membro; custo e carga em teste.

## Alternativas rejeitadas para a primeira fatia

Polling como fonte principal de tempo real e event bus em memória de Worker. Polling pode existir como fallback/reconciliação, não substitui o requisito confirmado.

**Referência:** https://developers.cloudflare.com/durable-objects/best-practices/websockets/
