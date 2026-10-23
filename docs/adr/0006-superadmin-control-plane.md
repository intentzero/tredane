# ADR-0006 — App de superadmin e plano de controle

- **Estado:** **Aceito** a existência de um app separado para superadmins no MVP ([DEC-012](../product/decisions.md), 23/10/2026). **Proposto** o desenho abaixo. **Em aberto** o acesso a conteúdo de clínica e a autenticação reforçada.
- **Altera:** [DEC-013](../product/decisions.md), que excluía qualquer painel de operador da plataforma do primeiro recorte.

## Problema

Com um D1 por clínica ([ADR-0002](0002-d1-topology.md)) e ativação do WhatsApp assistida ([DEC-009](../product/decisions.md)), a equipe do Tredane precisa criar clínicas, provisionar bancos, convidar responsáveis, acompanhar a ativação e diagnosticar falhas, sem misturar essas funções com o painel da clínica.

## Decisão e proposta

**Confirmado:** app separado do painel das clínicas, usado apenas por superadmins (ACT-05).

**Proposto:**
- Mesma base técnica (React + Worker/Hono), servido em domínio ou rota própria, com autorização de papel de plataforma no D1 central; um superadmin não ganha associação a clínicas por ser superadmin.
- Funções do MVP: criar clínica; provisionar e migrar o D1 da clínica; convidar e reenviar convite ao responsável; ver estado da ativação do WhatsApp (Embedded Signup); ver saúde técnica por clínica (filas, outbox pendente, falhas de webhook e envio, versão de migração); suspender ou reativar uma clínica.
- Opera sobre o D1 central e metadados técnicos; não lê contatos, conversas, mensagens ou agenda.
- Toda ação de superadmin entra na auditoria de plataforma com autor, clínica, ação e horário.

## Em aberto

| ID | Questão | Opções | Bloqueia |
| --- | --- | --- | --- |
| Q-SA-01 | O superadmin pode ver conteúdo de uma clínica? | Nunca (só metadados); acesso emergencial com pedido registrado, aprovação dupla, prazo e auditoria visível à clínica; convite temporário feito pelo próprio responsável. | Processo de suporte com dados reais. |
| Q-SA-02 | Como o superadmin se autentica? | Mesmo código por e-mail + segundo fator; chave de segurança (passkey); Cloudflare Access na frente do app. | Publicação do app fora do ambiente de teste. |

Até decidir Q-SA-01, a regra vigente é a invariante 8 de [fronteiras](../product/tenant-boundaries.md): nenhum acesso implícito a conteúdo.

**Origem:** [DEC-012](../product/decisions.md), [atores](../product/actors-permissions.md), [arquitetura](../architecture/overview.md).
