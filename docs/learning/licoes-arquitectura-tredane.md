# Lições de arquitectura — Tredane

**Estado:** síntese **Confirmado** onde cita DEC/ADR/MVP; partes de Flow detalhado e deploy ficam **Proposto** / **Em aberto**. Rascunho de base de conhecimento — **não** substitui `docs/MVP.md` nem `docs/product/decisions.md`.  
**Não inventa** métricas nem dados reais de clínicas ou clientes; exemplos de comportamento são fictícios ou de clínica de teste.  
**Audiência:** Paulo (produto) e quem for portar padrões para outros produtos.  
**Origem:** MVP, núcleo conversacional WhatsApp, Phase 1 hardening (#506–#512 / PRs #517–#524), caminho para Flow (DEC-138, ADR-0016, #514).  
**Fontes de entrada:** `docs/MVP.md`, ADR-0012 / 0015 / 0016, DEC-038 / 061 / 104 / 127 / 133–138, [prompt-fragilidade-flow.md](prompt-fragilidade-flow.md), seed verbalizado (03/11/2026), relatórios #506–#512.  
**Estado das afirmações:** **Confirmado** · **Proposto** · **Em aberto** · **Fora do MVP**.

---

## 1. Problema

O Tredane é um SaaS multi-tenant de atendimento para clínicas de estética: WhatsApp Business Cloud API, painel, pipeline, agenda própria e IA assistiva. (**Confirmado**, `docs/MVP.md`.)

No caminho feliz por toques, a cliente chega a marcar: linha → Opções → Horários → proposta versionada → botão Confirmar. Texto «sim» não marca (**Confirmado**, DEC-061). Combinações de zonas vão por texto livre; a lista Meta é single-select (**Confirmado**, DEC-135). Depois do texto, o bot ecoa «Entendi: … Certo?» com Sim/Corrigir antes de Horários; Sim só confirma zonas (**Confirmado**, DEC-137).

A sonda real de novembro de 2026 (clínica de teste, WhatsApp) mostrou o defeito central: **a cliente acredita que pediu as duas zonas ou aquela hora; o bot avança com um quadro incompleto.** Mais frases no chat não resolvem. (**Confirmado** como achado da sonda; DEC-138; [prompt-fragilidade-flow.md](prompt-fragilidade-flow.md).)

---

## 2. Decisões confirmadas vs propostas

### Confirmado (produto / arquitectura)

| Tema | Decisão | Origem |
| --- | --- | --- |
| Topologia | Um Durable Object por clínica + SQLite nativo operacional; D1 central (tenants, memberships, convites, suporte); R2 anexos | DEC-038, ADR-0012 |
| Confirmação de marcação | Só o botão Confirmar numa proposta versionada pelo backend marca; texto livre nunca marca | DEC-061 (revisa DEC-060) |
| IA no atendimento automático | Frases determinísticas no caminho normal; LLM só interpreta o não coberto e responde perguntas abertas com validador; falha → frase DEC-107 + alerta, sem pausar a IA | DEC-104 (+ DEC-107–115) |
| Estado da conversa | Um `BookingFrame` por conversa no SQLite do DO; mesma TX que a mensagem de saída; não derivar do histórico | ADR-0015, DEC-127 |
| Escolhas interativas M5 | Sempre ligadas; rótulos Feminina/Masculina/Todas/Opções/Horários; corte 24 chars no título | DEC-133, DEC-134 |
| Zonas / eco | Opções single-select + texto para combinações; eco antes de Horários; plural leve só na linha travada; sem descarte silencioso | DEC-135, DEC-137 |
| Digitação | Indicador nativo Meta enquanto o bot prepara resposta (fail-soft) | DEC-136 |
| Caminho principal a médio prazo | WhatsApp Flow com `data_exchange` (serviço → género se preciso → variantes multi → horário); chat como recurso; Flow não marca | DEC-138 |
| Phase 1 (núcleo) | Doze práticas no núcleo e no texto livre, já, sem esperar a Meta | DEC-138 |

### Proposto (desenho, ainda sujeito a revisão / implementação)

| Tema | Estado | Origem |
| --- | --- | --- |
| Desenho detalhado do Flow (ecrãs, cifra, endpoint, copy C1–C15, testes) | **Proposto** até revisão do Paulo; ADR não autoriza código nem deploy | ADR-0016 (#513 → #517) |
| Implementação do Flow | Issue **#514**; depende de revisão do ADR, copy aprovada e pré-requisitos Meta | DEC-138, ADR-0016 |
| Retirada das listas M5 quando o Flow entrar | Planeado em **#515** | DEC-138 |
| Copy nova no Flow | Nenhuma C1–C15 aprovada | DEC-104 + ADR-0016 §10 |

### Em aberto (bloqueia ou condiciona)

- Protocolo de revogação D1/DO, migrações/recuperação por instância (**Em aberto**, ADR-0012).
- Gates Meta / Clerk / LGPD antes de dados reais (**Em aberto**, `pilot-gates.md`).
- Deploy / sonda staging pós-Phase 1: seed e notes marcam Staging Deploy ainda pendente do Paulo (**Em aberto** operacional).
- Pré-requisitos Meta do Flow: chave por ambiente vs por WABA, scopes, verificação do negócio, hostname, App Review, edição de Flow publicado vs clone (**Em aberto**, ADR-0016 §13).
- Remarcação (DEC-091) dentro do Flow de quatro ecrãs — recomendação: fora deste recorte (**Em aberto**).
- Botões Sim/Corrigir do eco depois do Flow — recomendação: manter (**Em aberto**, ADR-0016).

---

## 3. Falhas reais da sonda (novembro 2026)

Clínica de teste; exemplos fictícios de comportamento. Sem dados reais de pacientes.

| Achado | Sintoma | Fecho Phase 1 |
| --- | --- | --- |
| Sessão antiga | Saltava para horários; «Terminar» não limpava o frame — só apagar o contacto | #508 / PR #524 — recomeçar / idle / fecho limpam o `BookingFrame` |
| Sinónimo de serviço | «Quero depilar» não encontrava Depilação | #509 / PR #521 — sinónimos da ficha nos extractors |
| Homónimos de zona | Com Feminina escolhida, «Axila» misturava género | Corrigido antes (#502); L1 A-15 verde |
| Descarte silencioso | «Axilas e pernas» → horário só de Pernas | DEC-137 + #509 — leftover / unrecognized; eco antes de Horários |
| Id vs rótulo | Toque «11-03 17:00» não abria proposta; título mês-dia vs texto dia/mês | #505 + #507 / PR #518 — id `YYYY-MM-DDTHH:MM`; título `terça 03/11 17:00` |
| Confirmar expirado | Confirmar após validade ainda podia confundir | #511 / PR #523 — não marca; explica; oferece alternativas; validade visível |
| Catálogo sem match | Link Google + «falar com a equipe» sem dizer o que faltou | #512 / PR #520 — diz o pedido; lista serviços; handoff leva o quadro |

Harness L1 (#506 / PR #522): casos A-13…A-19 + métricas de estrago ES-01…04. Medir se a marcação bateu no pedido, quantas zonas entraram, quantas correções, quantas voltas até Confirmar — **não** o «tom» da frase. (**Confirmado** como prática DEC-138 / F1-0.)

---

## 4. As doze práticas (DEC-138 / Phase 1)

Adoptar mesmo que o Flow entre. O Flow **não** as substitui. (**Confirmado**, DEC-138; detalhe em [prompt-fragilidade-flow.md](prompt-fragilidade-flow.md).)

1. **Limiar de confiança** — só preenche campo com correspondência única; nunca oferece horário com uma zona a menos. (#509)
2. **Id, nunca o título** — toque / Flow / lista trazem o id do horário; o título é rótulo. (#507)
3. **Uma forma de data à cliente** — `terça 03/11 17:00` no relógio da clínica; sem fuso IANA na copy; sem mês-dia. (DEC-098/copy; #507)
4. **Um quadro, todos os caminhos** — toque, texto, eco, correção, handoff e Flow escrevem os mesmos campos; a proposta lê esse quadro. (#510, ADR-0015)
5. **Recomeçar limpa o frame** — «começar de novo» / outra coisa / fim de conversa apagam serviço, linha, zonas e hora pendente. (#508)
6. **Uma pergunta, a do campo que falta** — linha já escolhida → não perguntar género. (#510)
7. **Corrigir volta ao campo certo** — Corrigir zonas reabre zonas; não salta o passo seguinte. (#510)
8. **Validade visível** — lista e proposta dizem até quando valem; Confirmar fora da validade explica e oferece outras horas. (#511)
9. **Atalho de texto com eco** — frase completa cai no quadro e vê «Entendi: … Certo?» antes de Horários/proposta; Sim do eco não marca. (DEC-137)
10. **Handoff com o quadro** — alerta à equipe leva serviço/zonas/hora entendidos; não substitui falha de leitura por link externo. (#512)
11. **Sinónimos e plural só na linha já escolhida** — «depilar» → Depilação; «Axilas» → Axila feminina se a linha é feminina. (#509)
12. **Medir o estrago, não o tom** — harness L1/L2/L3 + sonda manual contam marcação vs pedido, zonas, correções, voltas. (#506)

---

## 5. Topologia Cloudflare (o que reter)

**Confirmado** (DEC-038, ADR-0012):

| Camada | Papel |
| --- | --- |
| Clerk | Identidade/sessão; sem Organizations no MVP |
| Worker (Hono) | Authz, roteamento, integrações |
| D1 central | Tenants, memberships N:N, convites, suporte, auditoria admin |
| DO + SQLite por clínica | Contatos, conversas, mensagens, pipeline, catálogo, agenda, outbox, `BookingFrame` |
| R2 privado | Anexos |
| Queues / Workflows | Efeitos externos assíncronos com tenant e idempotência |
| WebSockets hibernáveis no DO | Tempo real do painel; memória ≠ fonte de verdade |

**Lição transferível:** um DO por tenant **não** isola sozinho D1, R2, Queues, WebSockets nem webhooks. Autorização no Worker + coerência no DO + testes de isolamento cruzado. Não há transação atómica única entre D1, SQLite do DO, R2 e Meta. (**Confirmado** como consequência ADR-0012.)

**Relógio:** fuso IANA é da infra (`clinic_settings.timezone`); a copy à cliente usa o relógio civil da clínica sem nome de fuso. Confundir HH:MM de display com id de slot fura invariantes (ex. INV-03 na validade). (**Confirmado** na prática; seed item 7.)

---

## 6. Núcleo determinístico + IA assistiva

**Confirmado:**

- Estrutura para colher (listas / Flow / `BookingFrame`); chat para confirmar o efeito colateral (proposta + Confirmar). (ADR-0016 / DEC-138; DEC-061.)
- O LLM não escolhe zona, hora nem marca. (DEC-104, DEC-138.)
- Frase nova à cliente exige aprovação do Paulo. (DEC-104.)
- Capacidade de marcação por botão sempre ligada; owner pausa na clínica. (DEC-061.)

**Proposto / Fora do MVP:** respostas e agendamentos plenamente autónomos sem botão; ver DEC-084 (avaliação contínua) e limites do MVP.

---

## 7. O que NÃO fazer

| Anti-padrão | Porquê | Origem |
| --- | --- | --- |
| Alargar o LLM para escolher zona/hora ou marcar | Viola a fronteira de efeito; a sonda falhou por quadro incompleto, não por «tom» | DEC-061, DEC-104, DEC-138 |
| Menu de dez níveis no chat | Fragilidade e abandono; Flow estruturado + núcleo | Prompt / DEC-138 |
| Catálogo estático no JSON do Flow | Horas dependem das zonas, duração, sala, profissional | ADR-0016 opção (b) descartada |
| Duplicar a agenda dentro do Flow | Flow lê a mesma `queryAvailability` / filtro Tempo | DEC-138, ADR-0016 |
| Aceitar «sim» escrito como confirmação de horário | Fronteira DEC-061 | DEC-061 |
| Tratar título da lista como id | Perde o dia; toque não liga à oferta | #507, sonda |
| Avançar com N−1 zonas em silêncio | Cliente acredita no pedido completo | DEC-137, #509 |
| Assumir que DO+SQLite = isolamento total | Fugas em D1/R2/WS/Queues | ADR-0012 |
| Frase nova sem aprovação | DEC-104 | DEC-104 |
| Marcar / Pix / sala / profissional no Flow | Fora do contrato DEC-138 | DEC-138, DEC-047 |

---

## 8. Phase 1 — mapa rápido (#506–#512)

| Issue | Prática | PR (repo) | Nota |
| --- | --- | --- | --- |
| #506 | Harness + métricas de estrago | #522 merged | A-13…A-19 |
| #507 | Id + título de horário | #518 merged | |
| #508 | Recomeçar limpa frame | #524 merged | |
| #509 | Sem drop silencioso + sinónimos | #521 merged | |
| #510 | Um só quadro | #519 | Unifica toque/texto/eco; prep `provenance: flow` |
| #511 | Validade / Confirmar expirado | #523 merged | Copy DEC-104 confirmada |
| #512 | Catálogo miss + handoff com quadro | #520 | |
| ADR-0016 | Desenho Flow | #517 | **Proposto** |
| #514 | Implementar Flow | — | **Em aberto** |
| #515 | Retirar M5 ao entrar Flow | — | **Em aberto** |

Seed (03/11/2026): Phase 1 merged cobrindo #506–#512 + ADR-0016; Staging Deploy ainda pendente do Paulo.

---

## 9. Caminho Flow (resumo)

**Confirmado (DEC-138):** caminho principal = Flow `data_exchange` em quatro passos (serviço; género se o serviço tiver os dois sexos; variantes em multi-seleção + Todas; horário da agenda da clínica). Sem flag. Testar no WABA da clínica de teste. Chat = recurso se o Flow não abrir. Texto livre continua com eco (DEC-137). Só Confirmar marca (DEC-061).

**Proposto (ADR-0016):** endpoint cifrado, `flow_token` no D1, leitura no DO, escrita do quadro no `nfm_reply`, proposta versionada no chat. Não implementar a partir deste documento.

**Em aberto:** issue **#514** (código + prova no WABA); gates Meta da secção 8 do ADR; Deploy.

---

## 10. Checklist mental (antes de mudar o funil)

1. Este caminho escreve no mesmo `BookingFrame`?
2. O efeito colateral (marcar) passa só pelo Confirmar da proposta versionada?
3. O id da escolha é estável (catálogo / `YYYY-MM-DDTHH:MM`), não o rótulo?
4. Há limiar de confiança / eco antes de oferecer horário?
5. Recomeçar e handoff limpam ou carregam o quadro de forma explícita?
6. A métrica de aceite mede estrago (pedido vs marcado), não estilo de frase?
7. Frase nova à cliente: DEC-104 aprovada?
8. Isolamento: Worker authz + DO tenant + sem IDs livres do cliente?

---

## 11. Documentos relacionados (repo + learning)

| Documento | Uso |
| --- | --- |
| `docs/MVP.md` | Recorte e decisões resumidas |
| `docs/product/decisions.md` | DEC-061, 104, 127, 133–138, … |
| `docs/adr/0012-clinic-durable-object-sqlite.md` | Topologia |
| `docs/adr/0015-estado-persistente-da-conversa.md` | BookingFrame |
| `docs/adr/0016-whatsapp-flow-agendamento.md` | Flow (Proposto) |
| [prompt-fragilidade-flow.md](prompt-fragilidade-flow.md) | Prompt completo das 12 práticas + sonda |
| [linkedin-post-tredane.md](linkedin-post-tredane.md) | Rascunho público |
| [opus-naturalis-transferencia.md](opus-naturalis-transferencia.md) | Transferência de padrões |

---

*Última síntese: 03/11/2026. Afirmações de merge/deploy reflectem o seed e os relatórios do store nessa data; verificar `main` antes de actuar. Pacote copiado para `docs/learning/` para artigos / transferência.*
