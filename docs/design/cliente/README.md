# Página web da cliente — mocks C-01 a C-12

**Estado:** **Proposto** (17/11/2026). A direção está **Confirmada** (DEC-196 a DEC-200, Paulo); estes mocks ainda não foram revistos por ele. Desenho técnico em [ADR-0018](../../adr/0018-pagina-web-cliente.md); spec de UX em [ux-ui.md](../../product/ux-ui.md) (secção «Página web da cliente»).

Mobile first (390×844), com o **layout compacto Confirmado** (Paulo, 17/11/2026; regras em [ux-ui.md](../../product/ux-ui.md)), só com valores de [tokens.json](../tokens.json) (validado por `tools/check_mocks.py`). Nomes, valores e datas são **fictícios**. Cada `.html` é estático e autocontido, exportado do canvas de design (privado); o PNG está em `previews/`.

| ID | Arquivo | Tela | Jornada · requisito |
| --- | --- | --- | --- |
| C-01 | `C-01-Inicio.html` | Início: marcações com zonas/combo · preço, Agendar, Falar com a equipe | JRN-20 · REQ-115 |
| C-02 | `C-02-Servico.html` | Agendar 1 de 4: procurar, «Para quem é?» e serviço (tocar avança) | JRN-21 · REQ-112, REQ-117 |
| C-03 | `C-03-Variantes.html` | Agendar 2 de 4: procurar zona e zonas (seleção múltipla, total) | JRN-21 · REQ-112, REQ-117 |
| C-04 | `C-04-Horario.html` | Agendar 3 de 4: «Quem prefere?» (DEC-218), mês e setas de semana, dias, horas por Manhã/Tarde/Noite | JRN-21 · REQ-112 |
| C-05 | `C-05-Revisao.html` | Agendar 4 de 4: revisão com linha **Com**, **Confirmar** (aviso de sinal e validade) | JRN-21 · REQ-112 |
| C-06 | `C-06-Feito.html` | Horário marcado (nome da profissional) e recibo no WhatsApp | JRN-21 · REQ-116 |
| C-07 | `C-07-Remarcar.html` | Remarcar: mesmo serviço e zonas, sem novo sinal | JRN-22 · REQ-113 |
| C-08 | `C-08-Cancelar.html` | Cancelar com sinal fora da janela: política e aceite explícito | JRN-22 · REQ-114 |
| C-09 | `C-09-LinkUsado.html` | Link usado ou expirado | JRN-23 · REQ-111 |
| C-10 | `C-10-Busca.html` | Procurar: zonas e serviços encontrados, termo destacado | JRN-21 · REQ-117 |
| C-11 | `C-11-BuscaVazia.html` | Procurar: nada encontrado, com «Perguntar no WhatsApp» | JRN-21 · REQ-117 |
| C-12 | `C-12-Calendario.html` | Escolher data: calendário do mês com dias livres marcados e «Primeira data livre» | JRN-21, JRN-22 · REQ-112, REQ-113 |

Estados que a UI real ainda precisa (não desenhados): carregando, sem horários livres (com alternativas), vaga perdida ao confirmar, erro de rede, sessão expirada, página pausada pela owner, «Pedir à equipe» enquanto a janela de crédito não é aplicada (DEC-198), lista vazia em C-01, pesquisa a carregar.
