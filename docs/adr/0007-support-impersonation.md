# ADR-0007 — Impersonação de usuário para suporte e manutenção

**Estado:** Confirmado o requisito de produto de impersonação por superadmin; **Em aberto** a escolha entre mecanismo nativo do Clerk e modo de suporte próprio.
**Origem:** 23/10/2026, decisão explícita do responsável pelo produto.
**Relacionada:** [ADR-0006](0006-clerk-platform-admin.md).

## Objetivo

Na Platform Admin, um superadmin deve poder selecionar uma clínica e um usuário que possua membership vigente naquela clínica e **abrir o painel como esse usuário** para reproduzir incidentes, manutenção e diagnóstico. A interface e a autorização devem refletir a role **do usuário impersonado naquele tenant**, mas a auditoria sempre preserva a identidade do superadmin responsável.

**Isto é uma sessão de suporte, não acesso irrestrito nem transferência de propriedade de conta.** Não requer que o superadmin seja membro permanente do tenant.

## Duas soluções candidatas

### A — Clerk nativo: actor tokens

Um Worker de administração valida a sessão atual + `privateMetadata.superadmin === true`, tenant e membership do alvo, regista justificativa e solicita um actor token à Clerk Backend API com `user_id` do alvo e `actor.sub` do superadmin. O link de uso único inicia uma sessão de impersonação Clerk, com `act` identificando o ator. Toda API operacional valida o ator real, a sessão de suporte e o membership/role do alvo. A experiência é a identidade do alvo no Clerk, mas permanece atribuível.

**Limitação comercial verificada em 23/10/2026:** a documentação Clerk informa **até 5 impersonações/mês gratuitas**, com custo/upgrade a confirmar antes de adoção como função frequente. A sessão padrão tem 10 minutos de inatividade e duração máxima padrão de 30 minutos (ajustável conforme API). A utilização do token pode encerrar a sessão atual no navegador; evitar afetar a sessão de admin com isolamento de fluxo/janela e UX explícita.

Referência: https://clerk.com/docs/guides/users/impersonation

### B — Modo de suporte próprio do Tredane

O superadmin continua autenticado como **ele mesmo** no Clerk. A API cria no D1 uma `support_sessions` de curta duração com `actor_clerk_user_id`, `subject_clerk_user_id`, `tenant_id`, motivo, estado, prazo e escopo. Um token/identificador opaco não reutilizável em outro contexto autoriza o painel a usar o membership e role do **subject** nas verificações de negócio. Cada requisição confere Clerk identity do **actor**, `superadmin` atual, suporte ativo, tenant, expiração e membership atual do subject. Auditoria grava as duas identidades.

O browser não pode escolher livremente um usuário a impersonar, nem converter um header de `subject_id` em autorização. O modo de suporte é emitido e validado pelo servidor, vinculado à sessão Clerk e invalidado explicitamente ao terminar.

**Vantagem:** não depende do volume de impersonações cobradas pelo Clerk, usa as sessões Clerk existentes e controla escopo e auditoria. **Custo:** aumenta responsabilidade de engenharia, exige testes rigorosos de revogação, replay, CSRF, sessão, identidades e isolamento.

## Recomendação (proposta, não aceita)

Para frequência desconhecida de uso e sensibilidade a custos, preferir o **modo de suporte próprio (B)**, após revisão de segurança. Se for necessário reproduzir a experiência real de login Clerk do usuário final, escolher actor tokens (A) para esse cenário e verificar preço antes da implementação.

**A escolha A/B continua Em aberto** e não impede documentar o fluxo administrativo nem o esquema inicial de tenants e memberships.

## Restrições obrigatórias para ambas

- **Autorização:** login Clerk vigente, flag `privateMetadata.superadmin === true` verificada no backend, membership válido do usuário alvo no tenant escolhido, MFA/step-up proposto e motivo de suporte obrigatório.
- **Escopo:** exatamente um tenant e um subject por sessão; privilégios efetivos iguais ou **mais restritos** que a role do subject. A flag global do actor não eleva essa role dentro da Clinic App.
- **Tempo:** TTL curto proposto de 15 minutos, renovação explícita e revogação imediata pelo admin ou por perda da flag/membership. Validar expiração por requisição e ao distribuir eventos em tempo real.
- **Visibilidade:** banner persistente "Modo suporte — atuando como [usuário] na clínica [tenant]" com botão de encerrar; ações realizadas não são apresentadas ao sistema como se tivessem sido executadas diretamente pelo usuário.
- **Auditoria:** cada mutação e eventos sensíveis registam `actor_clerk_user_id`, `subject_clerk_user_id`, `tenant_id`, `support_session_id`, motivo, tipo de ação, timestamp e resultado; evitar copiar conteúdo confidencial para o log.
- **Ações sensíveis:** inicialmente bloquear alterar credenciais, memberships, papéis, faturação, tokens e chaves; envio de mensagens, exclusões e exportações de dados devem ter política explícita/justificação extra antes de habilitar. Preferir modo de leitura no primeiro incremento.
- **Dados pessoais:** estabelecer política contratual, base legal, aviso/consentimento quando necessário, retenção de logs e tratamento do acesso de suporte **antes** de permitir uso em dados reais.
- **WebSockets:** sessões de suporte mantêm o contexto `actor + subject + tenant + support_session_id`; expiração/revogação interrompe a distribuição de eventos, inclusive após hibernação.
- **Resiliência:** falha de Clerk/D1, sessão expirada ou alvo removido do tenant => negar; nunca fazer fallback para acesso de superadmin global ao conteúdo.

## Cenários de aceite

1. Superadmin inicia suporte para usuário com membership na clínica A e vê apenas dados autorizados de A.
2. O mesmo alvo tem roles diferentes em A e B: permissões são recalculadas por tenant.
3. Não-superadmin recebe 403; metadata `superadmin: "true"` não autoriza.
4. Mudança de flag ou revogação de membership encerra acesso, inclusive por WebSocket.
5. Audit log distingue claramente ator, alvo e ação; usuário real não recebe atribuição falsa.
6. Iniciar sessão de A não permite trocar para B modificando URL, cookie, token ou headers.
7. Sessão de suporte expira e pode ser encerrada; pedidos posteriores falham.
8. Ações administrativas globais e alterações de credenciais são negadas durante modo suporte.

**Entregável da F1:** selecionar A/B, desenhar endpoint seguro de emissão/revogação, armazenamento e política de retenção, tests adversariais, UI com banner e procedimento de suporte.
