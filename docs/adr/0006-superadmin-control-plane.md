# ADR-0006 — App de superadmin e plano de controle

- **Estado:** **Aceitos** em 23/10/2026 o app separado para superadmins, a regra de acesso a conteúdo e a autenticação pelo Clerk ([DEC-012](../product/decisions.md)). **Proposto** o desenho abaixo.
- **Altera:** [DEC-013](../product/decisions.md), que excluía qualquer painel de operador da plataforma do primeiro recorte.

## Problema

Com um D1 por clínica ([ADR-0002](0002-d1-topology.md)) e ativação do WhatsApp assistida ([DEC-009](../product/decisions.md)), a equipe do Tredane precisa criar clínicas, provisionar bancos, convidar responsáveis, acompanhar a ativação e diagnosticar falhas, sem misturar essas funções com o painel da clínica.

## Decisão e proposta

**Confirmado:** app separado do painel das clínicas, usado apenas por superadmins (ACT-05).

**Proposto:**
- Mesma base técnica (React + Worker/Hono), servido em domínio ou rota própria. O superadmin é identificado pelo Clerk com o metadado privado `superadmin: true`, lido pelo Worker no servidor a cada requisição do app; um superadmin não ganha associação a clínicas por ser superadmin.
- Funções do MVP: criar clínica; provisionar e migrar o D1 da clínica; convidar e reenviar convite ao responsável; ver estado da ativação do WhatsApp (Embedded Signup); ver saúde técnica por clínica (filas, outbox pendente, falhas de webhook e envio, versão de migração); suspender ou reativar uma clínica.
- Opera sobre o D1 central e metadados técnicos; não lê contatos, conversas, mensagens ou agenda.
- Toda ação de superadmin entra na auditoria de plataforma com autor, clínica, ação e horário.

## Decisões de 23/10/2026

**Q-SA-01 (acesso a conteúdo) — Confirmado:** o superadmin nunca vê conteúdo de uma clínica. Se precisar, o responsável da clínica concede acesso temporário como membro (proposta: 24 h, papel de atendente), que fica na auditoria da clínica e da plataforma e pode ser revogado por ele a qualquer momento. Opções descartadas: acesso sem exceção, acesso emergencial com dupla aprovação.

**Q-SA-02 (autenticação) — Confirmado:** Clerk com metadado privado `superadmin: true`. Opções descartadas: Cloudflare Access, passkey próprio, TOTP.

## Riscos e controles propostos

- O metadado privado só é lido no servidor. O app nunca decide ser superadmin por dado do navegador, e o Worker confere o metadado em cada requisição (não só no login).
- Quem altera o metadado no painel do Clerk concede poder sobre todas as clínicas: restringir esse acesso ao Clerk a poucas pessoas, com segundo fator obrigatório, e registrar quando um usuário é marcado ou desmarcado como superadmin.
- Exigir segundo fator do Clerk para contas superadmin (**Proposto**).
- O acesso temporário de suporte é um vínculo comum no D1 central (papel atendente, `expires_at`), expirado e removido automaticamente; nada de bypass no código de autorização.

## Em aberto

Custo e plano do Clerk para o número de usuários previsto, residência dos dados de identidade (revisão jurídica) e processo interno de marcar/remover superadmin.

**Origem:** [DEC-012](../product/decisions.md), [atores](../product/actors-permissions.md), [arquitetura](../architecture/overview.md).
