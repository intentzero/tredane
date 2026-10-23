# Decisões e questões de produto

**Estado:** registro para a definição do MVP. **Data de referência:** 23 de outubro de 2026. Este arquivo distingue escolhas feitas pelo responsável pelo produto de recomendações e perguntas ainda abertas. Atualize o estado e a origem quando houver nova decisão; não apague o motivo nem a alternativa descartada.

| ID | Estado | Tema | Decisão, proposta ou pergunta | Origem e impacto |
| --- | --- | --- | --- | --- |
| DEC-001 | Confirmado | Público e objetivo | SaaS multi-tenant de atendimento para clínicas de estética, com WhatsApp, pipeline, agenda e IA. | Conversa de definição do Tredane; orienta o recorte do [MVP](../MVP.md). |
| DEC-002 | Confirmado | Agenda | Agenda própria no primeiro MVP. | Escolha expressa pelo responsável pelo produto; integrações com agendas externas ficam posteriores. |
| DEC-003 | Confirmado | WhatsApp | Usar a API oficial do WhatsApp Business. | Escolha expressa pelo responsável pelo produto; a forma de vincular a conta de cada clínica segue em aberto. |
| DEC-004 | Confirmado | Interface reativa | Atualizações em tempo real via WebSockets com hibernação em Durable Objects. | Pedido expresso pelo responsável pelo produto; exige isolamento de eventos, reconexão e revogação. |
| DEC-013 | Confirmado | Perfis do painel | Apenas atendente e responsável pela clínica acessam o painel no primeiro MVP. Profissional é recurso de agenda, sem login; não há painel de operador da plataforma neste recorte. | Escolha expressa pelo responsável pelo produto em 23 de outubro de 2026; reduz o escopo de identidade e telas. |
| DEC-014 | Confirmado | Recursos da agenda | Um horário deve considerar profissional e sala/equipamento necessários ao serviço. | Escolha expressa pelo responsável pelo produto em 23 de outubro de 2026; conflitos devem verificar todos os recursos exigidos. |
| DEC-005 | Proposto | Coordenação por tenant | Um Durable Object por clínica coordena conexões e eventos da clínica. | Proposta no [MVP](../MVP.md); avaliar carga, fronteira de dados e necessidade de subdivisão antes de fixar arquitetura. Não isola o D1/R2 automaticamente. |
| DEC-006 | Proposto | IA no primeiro recorte | Sugestões de resposta e resumo revisados por pessoa; envio autônomo posterior. | Recorte registrado no [MVP](../MVP.md) e no [épico #1](https://github.com/intentzero/tredane/issues/1). Validar utilidade, dados permitidos e provedor antes de usar dados reais. |
| DEC-007 | Em aberto | Identidade e permissões | Qual provedor de identidade? Atendente vê toda a caixa de entrada ou apenas conversas atribuídas? Um usuário pode integrar várias clínicas? O responsável também responde? | Responsável pelo produto + clínica piloto; bloqueia matriz final de permissões e autenticação real. Ver [atores](actors-permissions.md). |
| DEC-008 | Em aberto | Regras restantes da agenda | Com profissional e sala/equipamento definidos como recursos, quais serviços, durações, buffers, bloqueios e política de cancelamento? | Responsável pelo produto + clínica piloto; bloqueia disponibilidade e aceite final da agenda. |
| DEC-009 | Em aberto | Ativação do WhatsApp | Quem cria, conecta e administra a conta/número oficial de cada clínica? Onboarding assistido ou autosserviço? | Responsável pelo produto; bloqueia conexão de números reais. |
| DEC-010 | Em aberto | Topologia dos dados | D1 compartilhado com escopo por tenant ou banco por clínica para alguma categoria? Como isolar arquivos R2? | Decisão de arquitetura orientada por requisitos do piloto; bloqueia persistência final com dados reais. |
| DEC-011 | Em aberto | Dados pessoais e IA | Campos mínimos, retenção, acesso/exclusão, anexos, provedor de IA e contexto permitido. | Responsável pelo produto, com revisão apropriada; bloqueia uso de dados reais e IA conectada a conversas reais. |
| DEC-012 | Em aberto | Operação da plataforma | Operador do Tredane precisa de painel? Há acesso excepcional a conteúdo de clínica para suporte e sob quais controles? | Responsável pelo produto; bloqueia permissões de suporte, não a jornada básica em ambiente de teste. |

## Como decidir sem perder o histórico

Para uma questão aberta, registre: opções consideradas, escolha, motivo, responsável, data, efeitos nas jornadas/requisitos e link para a evidência da decisão. Se a escolha mudar, crie uma nota de substituição e atualize `docs/MVP.md`, [atores](actors-permissions.md), [jornadas](journeys.md) e [requisitos](requirements.md) afetados.

## Decisões que destravam a primeira fatia

1. **Papéis e escopo de acesso** (DEC-007): necessários para autenticação e caixa de entrada.
2. **Duração e disponibilidade dos recursos da agenda** (DEC-008): necessárias para confirmar horários sem conflito.
3. **Associação do WhatsApp por clínica** (DEC-009): necessária para mensagens reais.
4. **Dados e topologia de tenant** (DEC-010/011): necessários antes de usar dados reais.

Enquanto essas decisões não estiverem fechadas, é possível demonstrar a jornada com duas clínicas e dados fictícios, marcando hipóteses no produto e nos testes.
