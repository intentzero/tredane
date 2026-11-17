#!/usr/bin/env node
/**
 * Gera um esqueleto JSON de cenário de laboratório a partir de um guião já reescrito
 * (nunca colar texto bruto de review_samples).
 *
 * Uso: node scripts/lab-scenario-stub.mjs --id R99-meu-caso --wa 550000000199
 */
const args = process.argv.slice(2)
function readFlag(name, fallback) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const id = readFlag('--id', 'RXX-descricao-curta')
const waId = readFlag('--wa', '550000000199')
const displayName = readFlag('--name', 'ClienteLab')

const stub = {
  id,
  waId,
  displayName,
  note: 'REESCREVER: origem rsamp_xxx / cnv_xxx (Avaliar). Não copiar mensagens reais.',
  steps: [
    {
      say: '<< frase sintética do cliente >>',
      assertReply: {
        mustContain: ['<< trecho esperado >>'],
        mustNotContain: ['<< frase proibida >>'],
        slotSetMustInclude: [],
        slotSetMustExclude: [],
      },
    },
  ],
  expect: {
    note: 'Verificar assertReply em cada passo e lab_state ao fim.',
  },
}

console.log(JSON.stringify(stub, null, 2))