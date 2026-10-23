# Decisões e questões de produto

**Estado:** registro para a definição do MVP. **Data de referência:** 23 de outubro de 2026. Este arquivo distingue escolhas feitas pelo responsável pelo produto de recomendações e perguntas ainda abertas. Atualize o estado e a origem quando houver nova decisão; não apague o motivo nem a alternativa descartada.

| ID | Estado | Tema | Decisão, proposta ou pergunta | Origem e impacto |
| --- | --- | --- | --- | --- |
| DEC-001 | Confirmado | Público e objetivo | SaaS multi-tenant de atendimento para clínicas de estética, com WhatsApp, pipeline, agenda e IA. | Conversa de definição do Tredane; orienta o recorte do [MVP](../MVP.md). |
| DEC-002 | Confirmado | Agenda | Agenda própria no primeiro MVP. | Escolha expressa pelo responsável pelo produto; integrações com agendas externas ficam posteriores. |
| DEC-003 | Confirmado | WhatsApp | Usar a API oficial do WhatsApp Business. | Escolha expressa pelo responsável pelo produto; a forma de vincular a conta de cada clínica segue em aberto. |
| DEC-004 | Confirmado | Interface reativa | Atualizações em tempo real via WebSockets com hibernação em Durable Objects. | Pedido expresso pelo responsável pelo produto; exige isolamento de eventos, reconexão e revogação. |
| DEC-013 | Confirmado | Perfis do painel | No painel operacional da clínica, apenas atendente e responsável têm login; profissional é recurso sem login. A exclusão original de painel de operador foi **substituída em 23/10/2026 por DEC-018**: existe Platform Admin separada, restrita a superadmins. Isso não concede acesso direto ao conteúdo clínico. | Escolha expressa pelo responsável pelo produto em 23 de outubro de 2026; reduz o escopo de identidade e telas. |
| DEC-014 | Confirmado | Recursos da agenda | Um horário deve considerar profissional e sala/equipamento necessários ao serviço. | Escolha expressa pelo responsável pelo produto em 23 de outubro de 2026; conflitos devem verificar todos os recursos exigidos. |
| DEC-015 | Confirmado | Visibilidade do atendente | Atendente vê todas as conversas da própria clínica, inclusive as atribuídas a outros membros. | Escolha expressa pelo responsável pelo produto em 23 de outubro de 2026; autorização continua restrita ao tenant. |
| DEC-016 | Confirmado | Ações do responsável | Responsável pode fazer tudo que o atendente faz, inclusive responder no WhatsApp e operar agendamentos. | Escolha expressa pelo responsável pelo produto em 23 de outubro de 2026; ações administrativas adicionais seguem em avaliação. |
| DEC-017 | Confirmado | Clerk sem Organizations | Identidade/sessão no Clerk, sem Organizations; tenants e memberships N:N com role por tenant no D1. | Responsável pelo produto em 23/10/2026; [ADR-0006](../adr/0006-clerk-platform-admin.md). |
| DEC-018 | Confirmado | Superadmin e app interna | A flag de privilégio global chama-se **`privateMetadata.superadmin`**, deve ser booleano `true`, lida no backend. Platform Admin cria/edita/suspende/inicia exclusão de tenants. | Responsável pelo produto em 23/10/2026; [ADR-0006](../adr/0006-clerk-platform-admin.md). |
| DEC-019 | Confirmado | Impersonação própria do Tredane | Superadmin poderá atuar no contexto de usuário membro para manutenção via sessão de suporte própria no D1, sem Clerk impersonation/actor tokens; role do alvo, escopo único, duração curta e auditoria dupla. Protocolo de handoff, MFA, política de dados e capacidades de escrita ainda a detalhar. | Responsável pelo produto em 23/10/2026; [ADR-0007](../adr/0007-support-impersonation.md). |
| DEC-005 | Proposto | Coordenação por tenant | Um Durable Object por clínica coordena conexões e eventos da clínica. | Proposta no [MVP](../MVP.md); avaliar carga, fronteira de dados e necessidade de subdivisão antes de fixar arquitetura. Não isola o D1/R2 automaticamente. |
| DEC-006 | Proposto | IA no primeiro recorte | Sugestões de resposta e resumo revisados por pessoa; envio autônomo posterior. | Recorte registrado no [MVP](../MVP.md) e no [épico #1](https://github.com/intentzero/tredane/issues/1). Validar utilidade, dados permitidos e provedor antes de usar dados reais. |
| DEC-007 | Confirmado em parte | Identidade e memberships | Clerk sem Organizations; flag privada `superadmin` booleana; um usuário pode pertencer a vários tenants via memberships no D1. Convites, revogação de sessões, MFA e configuração de papéis administrativos ainda em aberto. | Decisão do responsável em 23/10/2026; [ADR-0006](../adr/0006-clerk-platform-admin.md). |
| DEC-008 | Em aberto | Regras restantes da agenda | Com profissional e sala/equipamento definidos como recursos, quais serviços, durações, buffers, bloqueios e política de cancelamento? | Responsável pelo produto + clínica piloto; bloqueia disponibilidade e aceite final da agenda. |
| DEC-009 | Em aberto | Ativação do WhatsApp | Quem cria, conecta e administra a conta/número oficial de cada clínica? Onboarding assistido ou autosserviço? | Responsável pelo produto; bloqueia conexão de números reais. |
| DEC-010 | Em aberto | Topologia dos dados | D1 compartilhado com escopo por tenant ou banco por clínica para alguma categoria? Como isolar arquivos R2? | Decisão de arquitetura orientada por requisitos do piloto; bloqueia persistência final com dados reais. |
| DEC-011 | Em aberto | Dados pessoais e IA | Campos mínimos, retenção, acesso/exclusão, anexos, provedor de IA e contexto permitido. | Responsável pelo produto, com revisão apropriada; bloqueia uso de dados reais e IA conectada a conversas reais. |
| DEC-012 | Confirmado em parte | Operação da plataforma | Platform Admin App para criar, editar, suspender e solicitar eliminação de tenants. Acesso de suporte por sessão própria do Tredane com impersonação auditável; protocolo seguro, política de dados, aprovação e acesso sensível ainda em aberto. | Decisão do responsável em 23/10/2026; [ADR-0006](../adr/0006-clerk-platform-admin.md) e [ADR-0007](../adr/0007-support-impersonation.md). |

## Como decidir sem perder o histórico

Para uma questão aberta, registre: opções consideradas, escolha, motivo, responsável, data, efeitos nas jornadas/requisitos e link para a evidência da decisão. Se a escolha mudar, crie uma nota de substituição e atualize `docs/MVP.md`, [atores](actors-permissions.md), [jornadas](journeys.md) e [requisitos](requirements.md) afetados.

## Decisões que destravam a primeira fatia

1. **Clerk confirmado**, mas implementar convites/memberships, MFA/step-up, revogação e proteção da Platform Admin (DEC-007/017/018). A impersonação (DEC-019) tem **solução própria do Tredane confirmada**; restam protocolo seguro, controles de MFA, política de suporte e testes.
2. **Duração e disponibilidade dos recursos da agenda** (DEC-008): necessárias para confirmar horários sem conflito.
3. **Associação do WhatsApp por clínica** (DEC-009): necessária para mensagens reais.
4. **Dados e topologia de tenant** (DEC-010/011): necessários antes de usar dados reais.

Enquanto essas decisões não estiverem fechadas, é possível demonstrar a jornada com duas clínicas e dados fictícios, marcando hipóteses no produto e nos testes.
