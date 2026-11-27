# Mocks de marketing: «A Lia marca uma limpeza de pele»

**Estado:** material de **go to market**, **Proposto** (Paulo, 26–27/11/2026). Não é especificação de produto: a fonte de verdade das telas continua a ser [docs/design/README.md](../../README.md) e [docs/product/ux-ui.md](../../../product/ux-ui.md).

Uma história em nove ecrãs, contada do ponto de vista de uma clínica de estética **fictícia** que usa o Tredane: a cliente pede a marcação no WhatsApp, marca pela página web, e a equipa recebe o aviso, vê a agenda cheia e acompanha a conversa.

## Ecrãs

Todos em PNG pronto a usar. Celular: 1170 × 2532 (390 × 844 a 3×). Desktop: 2880 × 1920 (1440 × 960 a 2×).

| # | PNG | O que mostra |
| --- | --- | --- |
| 01 | [png/01-ecra-de-bloqueio.png](png/01-ecra-de-bloqueio.png) | iPhone com o papel de parede da clínica e quatro notificações do Tredane (a da Lia em destaque, mais três e «mais 7 agendamentos novos») |
| 02 | [png/02-notificacao-expandida.png](png/02-notificacao-expandida.png) | A notificação da Lia expandida: resumo, «Ver na agenda» e «Falar com a Lia» |
| 03 | [png/03-agenda-celular.png](png/03-agenda-celular.png) | Agenda do dia no celular, 27 marcações, a da Lia com «Novo» |
| 04 | [png/04-whatsapp.png](png/04-whatsapp.png) | A conversa da Lia no WhatsApp com a assistente virtual da clínica |
| 05 | [png/05-conversas-celular.png](png/05-conversas-celular.png) | Lista de conversas no celular, com «Precisam de alguém» |
| 06 | [png/06-conversa-celular.png](png/06-conversa-celular.png) | Uma conversa no celular (vista do painel, IA a atender) |
| 07 | [png/07-agenda-desktop.png](png/07-agenda-desktop.png) | Grade do dia no desktop, três profissionais, 27 marcações |
| 08 | [png/08-conversas-desktop.png](png/08-conversas-desktop.png) | Conversas no desktop: lista e estado «Escolha uma conversa» |
| 09 | [png/09-conversa-desktop.png](png/09-conversa-desktop.png) | Conversa da Lia no desktop: lista, mensagens, composer e ficha da cliente |

## Dados fictícios (não mudar para dados reais)

- Clínica: **Maison Lótus · Estética · Ana Vidal**. Papel de parede e nome inventados; o desenho é só um fundo ilustrativo.
- Pessoas: Lia, Ana, Gi, Dra. Paula e todas as clientes são inventadas. Telefone `+55 11 98888-0000`, preço `R$ 180` e horários também.
- Procedimentos por profissional: Ana (estética facial), Gi (corporal), Dra. Paula (procedimentos médicos). Não trocar sem rever a coerência entre os ecrãs.
- Cenário: quinta-feira, 26/11, às 9:41. A marcação da Lia é amanhã (sexta 27/11, 14:30, Ana), e a última mensagem da conversa é das 09:40.

## O que verificar antes de publicar um anúncio

Os ecrãs misturam funcionalidades em estados diferentes. Como na [central de ajuda](../../../product/ajuda.md), só se anuncia o que está **Confirmado e em produção**:

- A **página web da cliente** (botão «Abrir agenda», marcar sem Flow) é a DEC-196 a DEC-202, **Proposto**.
- O aviso de **sinal por Pix** («Sinal recebido») depende da DEC-047/049 e do adaptador real do provedor.
- A **notificação push** à equipa e o texto exato das notificações são propostas deste material.
- «IA a atender» e «Assumir» seguem as DEC-083/209; os textos são de exemplo.
- O ecrã de WhatsApp usa o aspeto genérico de uma conversa, **sem o logotipo da Meta** (regra do [guia da marca](../../brand/README.md)). Se a peça precisar do logotipo, seguir as regras da Meta.

## Como está organizado

| Pasta | Conteúdo |
| --- | --- |
| `png/` | Imagens finais (acima) |
| `html/` | A mesma tela em HTML estático, sem dependências além das fontes do Google Fonts (precisam de rede). Servem para refazer o PNG |
| `canvas/` | Fonte editável: um `.dc.html` por tela e o `canvas.json` com a posição de cada uma, para reabrir no editor de design (Design canvas) |
| `tools/render-static.cjs` | Converte um `.dc.html` em HTML estático (Node, sem pacotes) |

### Refazer os PNG

A partir da raiz do repositório, com o Chrome instalado (macOS):

```bash
cd docs/design/marketing/lia-agendamento
node tools/render-static.cjs canvas/Main.dc.html html/01-ecra-de-bloqueio.html
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars \
  --force-device-scale-factor=3 --window-size=390,844 --virtual-time-budget=8000 \
  --screenshot="$PWD/png/01-ecra-de-bloqueio.png" "file://$PWD/html/01-ecra-de-bloqueio.html"
```

Para o desktop: `--force-device-scale-factor=2 --window-size=1440,960`. Para a agenda no celular (03), passe como 3.º argumento do script o trecho que desliza a lista até às 14:30 (ver o `.dc.html`).

O editor de design não está ligado ao repositório. Se mudar um ecrã lá, exporte de novo e atualize `canvas/`, `html/` e `png/` juntos, para as três cópias não divergirem.
