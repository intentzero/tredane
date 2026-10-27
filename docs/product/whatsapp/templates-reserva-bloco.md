# Modelos de mensagem (utility) — reserva por bloco

> **Status: rascunho. NÃO submetidos à Meta.** Só devem ser enviados para aprovação
> depois de revisão do Paulo. Enquanto não houver modelo aprovado, o app só envia
> as mensagens da reserva por bloco **dentro da janela de 24 h** (texto livre); fora
> dela, mostra o aviso e oferece «Copiar texto».

Categoria: **UTILITY** · Idioma: **pt_BR** · Sem botões, sem mídia.

## 1. `reserva_bloco_confirmacao` — bloco reservado, hora exata depois

Enviada logo após «Reservar e avisar paciente» (opção A: uma confirmação agora, a hora exata depois).

```
Olá, {{1}}! Reservamos {{2}}, {{3}}, com {{4}} para {{5}}. Confirmamos a hora exata até {{6}}. Se tiver preferência de horário, é só responder aqui.
```

| Variável | Exemplo | Origem |
|---|---|---|
| `{{1}}` | Marina | primeiro nome do contato |
| `{{2}}` | terça, 3/11 | dia do bloco |
| `{{3}}` | de manhã | período (`de manhã`, `à tarde` ou `das 9h às 13h`) |
| `{{4}}` | Dra. Ana | profissional |
| `{{5}}` | preenchimento labial | procedimento |
| `{{6}}` | segunda, 2/11 | prazo «Confirmar até» |

Exemplo completo: «Olá, Marina! Reservamos terça, 3/11, de manhã, com Dra. Ana para preenchimento labial. Confirmamos a hora exata até segunda, 2/11. Se tiver preferência de horário, é só responder aqui.»

## 2. `reserva_bloco_hora_confirmada` — hora exata definida

Enviada em «Definir hora» → «Confirmar e avisar paciente».

```
Olá, {{1}}! Seu horário está confirmado.
{{2}} — {{3}}, às {{4}} (até {{5}})
Com {{6}}
Se precisar remarcar, é só responder esta mensagem.
```

| Variável | Exemplo | Origem |
|---|---|---|
| `{{1}}` | Marina | primeiro nome do contato |
| `{{2}}` | Preenchimento labial | procedimento |
| `{{3}}` | terça, 3/11 | dia |
| `{{4}}` | 10:00 | início |
| `{{5}}` | 11:00 | fim |
| `{{6}}` | Dra. Ana | profissional (e sala, se houver) |

## Observações

- No app, os textos livres (dentro das 24 h) usam emojis (✅, 💙); nos modelos para a
  Meta eles foram retirados para reduzir o risco de reclassificação como MARKETING.
- A mensagem «Enviar opções» (2–3 horas para a paciente escolher) é só texto livre,
  dentro das 24 h; não tem modelo proposto.
- Código dos textos livres: `src/client/panel/screens/holds/holdFormat.ts`.
