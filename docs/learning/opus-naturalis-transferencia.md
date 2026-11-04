# Transferência Tredane → Opus Naturalis

**Estado:** nota de transferência (**Proposto** para aplicação noutro produto). Padrões listados como **Confirmado** no Tredane; aplicabilidade Opus fica **Em aberto** até validação no domínio.  
**Não inventa** métricas nem dados reais. Não substitui MVP/DECs/ADRs do Tredane.  
**Checkout:** o repositório `opusnaturalis` **não** está neste pacote — tudo o que depende do domínio Opus fica **Em aberto**.  
**Não copiar:** DECs/ADRs específicos, WABA, copy Meta, schema SQLite do DO, frases DEC-104.  
**Ler primeiro:** [licoes-arquitectura-tredane.md](licoes-arquitectura-tredane.md) e [prompt-fragilidade-flow.md](prompt-fragilidade-flow.md).

---

## 1. O que reutilizar (padrões)

Padrões genéricos, independentes de estética ou WhatsApp. Estado: **Confirmado** como lição no Tredane; **Proposto** como aplicáveis a outro produto até validação no domínio Opus.

| Padrão | Em uma frase | Evidência Tredane |
| --- | --- | --- |
| **Canal → domínio** | Limites do canal (single-select, botões, formulários) moldam entidades e fluxos; não só a UI | DEC-135/138; sonda |
| **Quadro canónico** | Um objecto de sessão por conversa/processo; todos os caminhos escrevem os mesmos campos | ADR-0015; #510 |
| **Id ≠ rótulo** | Persistência e efeitos usam ids estáveis; labels são copy e podem truncar | #507; DEC-134 |
| **Fronteira de efeito** | Interpretar / pré-preencher ≠ commit; um gesto explícito versionado cria o efeito | DEC-061 |
| **Núcleo determinístico + LLM assistivo** | Regras e catálogo no caminho feliz; modelo só no residual, com validador | DEC-104 |
| **Eco / limiar de confiança** | Antes de oferecer o passo seguinte, confirmar o que o texto livre entendeu; sem drop silencioso | DEC-137; #509 |
| **Validade visível** | Ofertas e propostas expiram de forma legível; commit fora da validade explica e reoferece | #511; DEC-061 |
| **Handoff com contexto estruturado** | Transferência humana leva o quadro, não um link genérico | #512 |
| **Medir estrago** | Aceite = pedido vs resultado (campos, correcções, voltas), não «tom» | #506 |
| **Isolamento em camadas** | Store por tenant ≠ isolamento automático de API, filas, ficheiros, tempo real | ADR-0012 / DEC-038 |
| **Estrutura para colher, chat para confirmar** | Formulário / Flow para preencher; mensagem para proposta e commit | DEC-138; ADR-0016 |

---

## 2. O que adaptar (domínio estética / WhatsApp)

Isto **não** se porta à letra. Cada linha é específica do Tredane ou da Meta.

| Conceito Tredane | Por que adaptar | Pista para Opus (**Em aberto**) |
| --- | --- | --- |
| Serviços / variantes / género da variante (DEC-078/079) | Domínio de clínica de estética | Quais entidades Opus têm «variantes» e restrições de combinação? |
| Linha Feminina/Masculina sem sexo na ficha (DEC-075) | Regra de produto estética | Opus tem audiência ou perfil sensível? |
| Lista Meta single-select vs multi-zona | Limitação WhatsApp Cloud API | Opus usa WhatsApp? Outro canal? Qual a restrição equivalente? |
| WhatsApp Flow + `data_exchange` + cifra | Superfície Meta (#514) | Canal estruturado de Opus? |
| Proposta 30 min + botão Confirmar (DEC-061) | Política de marcação | Qual é o «commit» de Opus (encomenda, reserva, pagamento)? |
| Pix / Woovi na conta da clínica (DEC-047/049) | Pagamento BR estética | Modelo de pagamento Opus |
| Relógio da clínica sem IANA na copy | Multi-clínica BR | Fusos / pontos de atendimento Opus |
| Durable Object + SQLite por clínica | Topologia Cloudflare escolhida | Stack Opus (**Em aberto** — sem repo) |
| Clerk sem Organizations + memberships D1 | Identidade Tredane | Auth Opus (**Em aberto**) |

---

## 3. O que NÃO copiar

| Item | Motivo |
| --- | --- |
| Textos DEC-### / REQ-### / ADR-00## | Identificadores e decisões do produto Tredane |
| Frases aprovadas DEC-104 / copy de actos | Propriedade e tom da clínica; nova aprovação por produto |
| IDs WABA, `phone_number_id`, tokens Meta, chaves Flow | Segredos e vínculo por tenant |
| Schema `schedule_sessions` / `BookingFrame` tal-qual | Acoplado ao funil de marcação estética |
| Issues #506–#515 como backlog Opus | São trabalho Tredane |
| Assumir Tech Provider / Embedded Signup | Gate externo Meta; pode não existir noutro produto |
| «Um DO por clínica» como dogma | É DEC-038 do Tredane; Opus pode ter outra unidade de isolamento |
| Métricas ou resultados da sonda como benchmarks | Exemplos de falha, não KPIs públicos |

---

## 4. Checklist — perguntas antes de portar

Responder por escrito. Se a resposta for «não sei», marcar **Em aberto** e não implementar o padrão à cega.

### Domínio e efeito

1. Qual é o efeito colateral irreversível (ou caro de reverter) no Opus?  
2. Que gesto explícito o autoriza? Texto livre pode autorizá-lo?  
3. Existe proposta / rascunho versionado antes do commit?  
4. O que acontece se o commit chegar depois da validade?

### Canal

5. Qual o canal principal (WhatsApp, web, app, e-mail)?  
6. O canal é single-select, multi-select, formulário, ou só texto?  
7. O rótulo visível pode truncar ou perder contexto (data, SKU, variante)?  
8. Precisamos de um caminho estruturado (Flow/form) **e** texto livre no mesmo quadro?

### Estado

9. Onde vive o «quadro» da sessão (DB, KV, DO, cookie)?  
10. Todos os caminhos (toque, texto, correção, handoff) escrevem a mesma estrutura?  
11. «Recomeçar» / timeout limpa o quadro sem exigir apagar o contacto?

### IA

12. O modelo pode criar o efeito, ou só preencher campos / redigir?  
13. Há validador determinístico à saída?  
14. Frases fixas vs geração: quem aprova copy nova?

### Multi-tenant e ops

15. Qual a unidade de isolamento (conta, loja, projeto)?  
16. Authz na API + store + filas + ficheiros + realtime estão testados em cruzamento?  
17. Como se mede estrago em testes (pedido vs resultado)?

### Lacunas deste checkout (**Em aberto**)

18. Existe repo Opus Naturalis acessível? (Neste pacote: **não**.)  
19. Opus já usa Cloudflare / Clerk / WhatsApp?  
20. Há decisões de produto Opus equivalentes a DEC-061 / DEC-104?

---

## 5. Sequência sugerida de portabilidade

**Proposto** (ordem prudente; ajustar quando o repo Opus existir):

1. Mapear o efeito e a fronteira de commit (secção 4.1).  
2. Desenhar o quadro canónico mínimo (campos + proveniência).  
3. Definir ids estáveis vs labels do canal.  
4. Só depois: LLM residual + eco/limiar.  
5. Só se o canal exigir: formulário estruturado (análogo ao Flow), sem duplicar a regra de negócio dentro do JSON estático.  
6. Harness que falha quando o resultado ≠ pedido (estrago), com `knownFailure` creditado à issue certa.

Não começar pelo prompt do LLM nem por copiar o ADR-0016.

---

## 6. Referências

| Doc | Para quê |
| --- | --- |
| [licoes-arquitectura-tredane.md](licoes-arquitectura-tredane.md) | Base durável Tredane |
| [prompt-fragilidade-flow.md](prompt-fragilidade-flow.md) | 12 práticas + falhas da sonda |
| [linkedin-post-tredane.md](linkedin-post-tredane.md) | Narrativa pública (não é spec) |
| Repo `intentzero/tredane`: MVP, ADR-0012/0015/0016, DEC-061/104/138 | Fonte autoritativa de produto |

---

*Nota gerada 03/11/2026; copiada para `docs/learning/`. Actualizar a secção 2 e as perguntas 18–20 quando houver acesso ao código ou às decisões Opus Naturalis.*
