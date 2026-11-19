# Unit economics da assinatura por clínica

**Estado:** **Proposto.** Estudo de 18/11/2026 para estimar quanto cobrar por clínica. Não é preço aprovado, não cria DEC e não muda o recorte do MVP.

O modelo editável está em [unit-economics-assinatura.canvas.tsx](unit-economics-assinatura.canvas.tsx), ao lado deste texto. Ele importa `cursor/canvas` e serve para refinar premissas (conversas, horas de suporte, regime, quem paga a Meta). A leitura abaixo é o caso-base gravado nesta data. Se o canvas divergir, vale o que estiver no arquivo do repositório depois da próxima revisão.

## Leitura do caso-base

Clínica pequena (cerca de 200 conversas por mês), Simples Anexo V a 15,5% da nota, Meta paga pela clínica, remessa de Cloudflare e Anthropic no enquadramento de SaaS técnico.

| Mensalidade | Imposto da nota | O que sobra no piloto | Percentual da nota |
| --- | ---: | ---: | ---: |
| R$ 397 | cerca de R$ 62 | cerca de R$ 177 | cerca de 45% |
| R$ 497 | cerca de R$ 77 | cerca de R$ 262 | cerca de 53% |
| R$ 697 | cerca de R$ 108 | cerca de R$ 431 | cerca de 62% |

Para sobrar 60% da nota depois do imposto e do custo de piloto (cerca de R$ 158), o preço precisa passar de cerca de **R$ 646**. O degrau comercial seguinte, na escada R$ 297 / 397 / 497 / 697 / 897 / 1.097 / 1.297, é **R$ 697**.

Com fator R de 28% ou mais (Anexo III, 6% na primeira faixa), o mesmo custo leva o degrau de 60% de volta para **R$ 497**. O pró-labore que compra esses 28% não está nas horas de suporte.

Isto não substitui um contador. O Tredane ainda não tem CNPJ (VAL-13).

## O que entra no custo de uma clínica

O custo que manda no piloto é hora de gente. A IA e a Cloudflare, mesmo com o tributo da remessa, ficam na casa de poucos reais por clínica neste volume.

| Linha | Caso-base, clínica pequena | Quem paga |
| --- | ---: | --- |
| IA (Haiku 5.5 no caminho quente, Sonnet 5.5 no «gerar outra») | cerca de R$ 2,50 | Tredane |
| Infra Cloudflare (hipótese de US$ 1 × câmbio) | R$ 5,40 | Tredane |
| Tributos da remessa em dólar | cerca de R$ 4 | Tredane, fora do DAS |
| Suporte no piloto, 1,5 h × R$ 80 | R$ 120 | Tredane |
| Onboarding de 4 h, diluído em 12 meses | cerca de R$ 27 | Tredane |
| WhatsApp service + utility | cerca de R$ 22 | Clínica, na conta do número |
| **Custo do Tredane no piloto** | **cerca de R$ 158** | |

Em regime (0,4 h de suporte por mês, onboarding já pago) o custo cai para a casa dos R$ 40 mais os mesmos tributos da nota. A margem em regime, no preço que segura o piloto, fica folgada. O primeiro mês tira as horas de onboarding inteiras do caixa; a tabela mostra a média de doze meses.

## Perfis

Os três perfis usam a mesma hora (R$ 80), o mesmo câmbio (R$ 5,40) e o mesmo pacote de imposto. O degrau é o primeiro da escada em que ainda sobram 60% da nota no piloto.

| Perfil | Volume de partida | Leitura |
| --- | --- | --- |
| Estúdio, 1 profissional | 80 conversas, 1 h de suporte no piloto | O piso fica abaixo do da clínica pequena. Conferir no canvas. |
| Clínica pequena, 2 a 3 | 200 conversas, 8 saídas de serviço, 1,5 h | Degrau **R$ 697** no Anexo V; **R$ 497** no Anexo III. |
| Clínica ocupada, 5 a 8 | 500 conversas, 2,5 h de suporte | O suporte empurra o degrau do Anexo V para a casa de **R$ 1.097**. R$ 497 nesse perfil não segura 60% no piloto. |

## Fórmula

```
custo = IA + infra + tributo da remessa + suporte + onboarding diluído + Meta absorvida
imposto da nota = mensalidade × alíquota efetiva
sobra = mensalidade − imposto da nota − custo
piso para 60% da nota = custo / (1 − alíquota − 0,60)
```

A alíquota efetiva do Simples é `(RBT12 × nominal − parcela a deduzir) / RBT12`. RBT12, neste estudo, é a receita anualizada `clínicas pagantes × mensalidade testada × 12`. Com 15 clínicas a R$ 397–697 a receita fica na primeira faixa (até R$ 180 mil). Acima disso a alíquota sobe; o canvas recalcula.

Meta absorvida só entra no custo se o Tredane pagar a conta. No caso-base a conta é da clínica (DEC-009) e o valor não entra na nota do Tredane.

## Imposto da nota

**Proposto como caso-base:** Simples Nacional, Anexo V, 15,5% na primeira faixa. SaaS de software próprio segue o fator R (folha ÷ receita bruta dos 12 meses). Abaixo de 28%, Anexo V. Em 28% ou mais, Anexo III, que começa em 6%. Fontes usadas em 18/11/2026: LC 123/2006, anexos III e V; SC Cosit 222/2019 e 271/2024 para licenciamento do próprio software.

No Simples e no Lucro Presumido esse imposto incide sobre a receita. A fatura da Cloudflare não o reduz.

Lucro Presumido, neste estudo: ISS da cidade + PIS 0,65% + COFINS 3% + IRPJ 4,8% + CSLL 2,88% (15% e 9% sobre presunção de 32%). Com ISS de 2%, cerca de 13,3% da nota. Com ISS de 5%, cerca de 16,3%. O adicional de 10% de IRPJ aparece quando o lucro presumido do mês passa de R$ 20 mil.

| Regime na clínica pequena, a R$ 497 | Efeito no caso-base |
| --- | --- |
| Anexo V, 15,5% | Sobra cerca de 53% da nota no piloto. O degrau de 60% é R$ 697. |
| Anexo III, 6% | O degrau de 60% volta a R$ 497. |
| Lucro Presumido, ISS 2% | Fica entre os dois. Conferir no canvas. |
| Lucro Presumido, ISS 5% | Perto do Anexo V. |

## Remessa: Cloudflare e Anthropic

**Proposto como caso-base**, e **em aberto** quanto ao enquadramento. Cloudflare e Anthropic cobram em dólar. O DAS não inclui essa remessa (LC 123/2006, art. 13, § 1º). Quando o fornecedor recebe o valor cheio, o estudo soma, sobre a fatura de IA + infra:

- IOF-câmbio 3,5% (Decreto 12.499/2025, citado em novembro de 2026; o referendo do plenário do STF na ADC 96 ainda estava pendente na fonte consultada)
- IRRF 15% com gross-up, 17,65% do valor pago (RIR/2018, art. 786)
- CIDE 10% sobre a base reajustada, se a nuvem for serviço técnico (SC Cosit 191/2017)
- PIS/Cofins-Importação 9,25%, base reajustada (IN RFB 2.121/2022, art. 273)
- ISS da importação, 2% no caso-base (o município pode ir a 5%)

O conjunto fica em cerca de 47% a mais sobre a fatura em dólar. Em cerca de R$ 8 de fatura, são cerca de R$ 4 por clínica por mês. Não muda o degrau de R$ 697.

O canvas tem mais duas leituras: licença de uso sem CIDE (SC Cosit 107/2023) e só o IOF de 3,5%, que é o que o cartão cobra mesmo sem a empresa recolher o resto.

A partir de 2027 o PIS/Cofins-Importação dá lugar à CBS. IRRF e CIDE permanecem. Vale revisar esta secção nessa data.

## Meta

**Confirmado para o desenho do produto, hipótese para o caixa:** a conta e o número são da clínica (DEC-009). O caso-base deixa a fatura fora da mensalidade do Tredane. Cartão Brasil de 1/10/2026: service R$ 0,035 a partir da mensagem 1.001 de cada número, por mês; utility R$ 0,035. As 1.000 primeiras de serviço são grátis e não acumulam. Marketing, R$ 0,3217, fica de fora: campanha e lembrete de retorno não estão neste recorte.

A cobrança em reais sai em boleto da Facebook Brasil. Isso não é remessa ao exterior, então IOF, IRRF e CIDE da secção anterior não se aplicam a essa fatura. O repasse de PIS/Cofins 9,25% e ISS 2,9% que a Meta anunciou para 2026 é de anúncio, não do cartão de mensagem da API. Se a conta da API voltar a ser faturada em dólar pela Meta Platforms Inc., a remessa da secção anterior passa a incidir também sobre ela.

Pix de sinal cai na conta da clínica (DEC-047). Não há take rate do Tredane neste estudo.

## De onde vêm os números de custo

- Modelos em `src/ai/budgets.ts`: extrator, exceção e rascunho automático em `claude-haiku-5-5`; «gerar outra» em `claude-sonnet-5-5`. Teto de 300 rascunhos por dia por clínica (`AI_DAILY_DRAFT_CAP`). No Haiku, mesmo o teto cheio fica na casa de dezenas de reais.
- Preço Anthropic usado (prompt até 100 mil tokens): Haiku 5.5 US$ 0,10 / US$ 0,50 por milhão; Sonnet 5.5 US$ 2 / US$ 10. Cada chamada de Haiku, na hipótese: 2.500 tokens de entrada e 600 de saída, thinking incluído. Sonnet: 4.000 e 800.
- Caminho de agenda é frase do backend (DEC-104). A chamada de Haiku entra quando o código não cobre a mensagem.
- Infra de US$ 1 por clínica é hipótese da parcela variável (Worker, Durable Object, D1, Clerk). O mínimo da conta Cloudflare fica no custo fixo da empresa, não nesta linha, para não contar duas vezes.
- Câmbio R$ 5,40 por dólar é hipótese.
- Hora de suporte R$ 80 é hipótese de alguém da operação, não salário aprovado.

## Referência de mercado

Páginas públicas em novembro de 2026, não um teto decidido. Agenda com prontuário e financeiro cobra menos e entrega o que este MVP não tem: Trinks na casa de R$ 55 a R$ 146 conforme a equipe, WhatsApp à parte; Clinicorp Standard na casa de R$ 112 a R$ 160. Central de WhatsApp com agenda e Pix fica mais perto do recorte: Atendize de R$ 197 a R$ 497; módulo de WhatsApp da Belle citado a R$ 229 em cima do sistema.

## Custo fixo da empresa

O canvas separa um custo fixo mensal (hipótese de partida R$ 12.000, ferramentas e retirada, fora do custo por clínica). Com a sobra do piloto da clínica pequena a R$ 697, a conta de clínicas para cobrir esse fixo muda junto com o preço. Não usar a sobra de R$ 397, que é anterior ao imposto.

## Em aberto

- Regime tributário. Sem CNPJ, Anexo V é a hipótese conservadora, não enquadramento.
- Enquadramento da Cloudflare e da Anthropic: serviço técnico com CIDE, ou licença sem CIDE.
- Horas reais de suporte no piloto e volume real de conversas. Ainda não há clínica pagante.
- Quem paga a Meta no contrato: a clínica, como na DEC-009, ou o Tredane por dentro da mensalidade.
- ISS do município, quando houver sede.
- Se a mensalidade de lista fica em R$ 497 (Anexo III ou preço comercial abaixo do piso de 60%) ou em R$ 697 (Anexo V com 60% da nota).

## Ao refinar

1. Mudar a premissa no [canvas](unit-economics-assinatura.canvas.tsx) e conferir o degrau.
2. Se a leitura de caso-base mudar, atualizar a tabela deste arquivo na mesma alteração.
3. Preço só vira decisão quando o responsável pelo produto escolher regime, quem paga a Meta e a mensalidade. Aí o registro é uma DEC, e este estudo continua como a conta que a sustentou.
