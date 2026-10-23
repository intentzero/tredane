# ADR-0002 — Topologia multi-tenant no D1

- **Estado:** Em aberto. **Opção recomendada para prototipagem com dados sintéticos:** um D1 partilhado, sempre com tenant_id e testes de isolamento.
- **Responsável pela decisão:** responsável pelo produto com validação técnica e requisitos da clínica piloto.
- **Decidir antes de:** armazenar dados reais de clientes.

## Contexto

D1 suporta ambos os modelos: um banco partilhado com escopo por clínica ou um banco por clínica. O Durable Object de cada clínica não implica separação no D1.

## Opções

**A — D1 partilhado:** migrações e operação mais simples na primeira fatia; exige filtros por tenant em todas as consultas, chaves compostas, testes rigorosos, controle de visibilidade e capacidade suficiente de escrita.

**B — D1 por clínica:** isolamento físico de dados e possibilidade de distribuir carga; exige provisioning, roteamento dinâmico e migrações/recuperação por banco. Atenção a limites e custos operacionais.

## Critérios de decisão

Quantidade de clínicas, dados e anexos sensíveis, throughput, custo por tenant, retenção, possibilidade de exportação/exclusão isolada, recuperação e operação de migrações. A segurança exigida é idêntica nas bordas da API, fila, objetos e arquivos.

## Regra provisória de engenharia

Podemos escrever testes e seeds para A em ambiente local, **sem converter A em decisão irrevogável**. Encapsular acesso à persistência em módulos de domínio, sem acoplar UI ou regras do negócio ao mecanismo de binding do D1. O contexto de tenant deve ser sempre verificado na fronteira do backend.

**Origem:** [DEC-010](../product/decisions.md), [fronteiras](../product/tenant-boundaries.md), [modelo lógico](../architecture/data-model.md).
