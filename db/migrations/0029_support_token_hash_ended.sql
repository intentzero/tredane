-- Sessões de suporte já terminadas deixam de guardar o hash do token (decisão 5 de 17/11/2026, #895).
-- A coluna é NOT NULL e única: o marcador «ended:<id>» nunca coincide com um hash SHA-256 em hexadecimal.
UPDATE `support_sessions` SET `token_hash` = 'ended:' || `id` WHERE `status` <> 'active' AND `token_hash` NOT LIKE 'ended:%';
