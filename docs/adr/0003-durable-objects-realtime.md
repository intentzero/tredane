# ADR-0003 — WebSockets hibernáveis e coordenação de eventos

- **Estado:** Aceito o uso de WebSockets hibernáveis em Durable Objects e **aceito** um Durable Object por clínica (DEC-005, 23/10/2026).
- **Origem:** [DEC-004 e DEC-005](../product/decisions.md), 23/10/2026.

## Problema

Inbox, Pipeline e Agenda devem atualizar entre sessões sem recarregar a página. É obrigatório não distribuir eventos de uma clínica para outra e recuperar o estado após quedas ou hibernação.

## Decisão e hipótese

**Confirmado:** usar Durable Objects com WebSocket Hibernation API para manter conexões com custo controlado, com uma instância por clínica. **Proposto:** o Worker autoriza a conexão (sessão + associação vigente à clínica ativa, no D1 central) e a encaminha ao objeto nomeado pelo ID da clínica. O objeto distribui eventos mínimos recebidos após a persistência no D1 da clínica. Ao trocar de clínica no seletor, o cliente fecha a conexão e abre outra no objeto da nova clínica.

O D1 da clínica é a fonte de verdade ([ADR-0002](0002-d1-topology.md)); Durable Objects não armazenam histórico autoritativo de conversas ou agendamentos. A interface refaz leituras ao conectar e reconectar; eventos repetidos não podem duplicar registros.

## Fronteira de segurança

Validar associação e sessão antes do upgrade, vincular a conexão ao tenant e verificar a validade de acesso nas entregas/revogações. Conexão antiga que perde permissão deve deixar de receber dados. Metadados mínimos da sessão podem ser anexados ao WebSocket para sobreviver à hibernação; nunca guardar tokens brutos ou conversas completas nos anexos.

**A validar:** se uma clínica com muitas conexões precisará de subdivisão do objeto no futuro; formato de evento, versão/ordenação; mecanismo efetivo de invalidar conexões ao revogar membro; custo e carga em teste.

## Alternativas rejeitadas para a primeira fatia

Polling como fonte principal de tempo real e event bus em memória de Worker. Polling pode existir como fallback/reconciliação, não substitui o requisito confirmado.

**Referência:** https://developers.cloudflare.com/durable-objects/best-practices/websockets/
