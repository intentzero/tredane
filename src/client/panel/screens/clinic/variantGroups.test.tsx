import { describe, expect, it } from 'vitest'
import {
  claimedElsewhere,
  firstSynonymCollision,
  foldWord,
  serviceClaims,
} from './variantGroups'

describe('foldWord / claimedElsewhere (assertSynonymsNoCollision no painel)', () => {
  it('dobra acentos como foldSynonym do servidor', () => {
    expect(foldWord('Peito')).toBe('peito')
    expect(foldWord('peito')).toBe('peito')
    expect(foldWord('Abdômen')).toBe('abdomen')
    expect(foldWord('abdômen')).toBe('abdomen')
    expect(foldWord('  Abdômen  ')).toBe('abdomen')
  })

  it('«peito» colide com a zona «Peito» no mesmo serviço', () => {
    const claims = serviceClaims({
      id: 'svc_1',
      name: 'Depilação',
      synonyms: [],
      zones: [
        { name: 'peito e abdômen', synonyms: ['abdominal', 'barriga'] },
        { name: 'Peito', synonyms: [] },
      ],
    })
    const owner = 'svc_1:' + foldWord('peito e abdômen')
    expect(claimedElsewhere('peito', owner, claims)).toBe('Depilação › Peito')
    expect(claimedElsewhere('Peito', owner, claims)).toBe('Depilação › Peito')
    expect(claimedElsewhere('abdominal', owner, claims)).toBeNull()
    expect(claimedElsewhere('barriga', owner, claims)).toBeNull()
  })

  it('acentos iguais: «abdômen» colide com sinônimo «abdomen» noutra opção', () => {
    const claims = serviceClaims({
      id: 'svc_1',
      name: 'Depilação',
      synonyms: [],
      zones: [
        { name: 'peito e abdômen', synonyms: [] },
        { name: 'Barriga', synonyms: ['abdomen'] },
      ],
    })
    const owner = 'svc_1:' + foldWord('peito e abdômen')
    expect(claimedElsewhere('Abdômen', owner, claims)).toBe('Depilação › Barriga')
  })

  it('firstSynonymCollision aponta a primeira palavra em conflito', () => {
    const claims = serviceClaims({
      id: 'svc_1',
      name: 'Depilação',
      synonyms: [],
      zones: [
        { name: 'peito e abdômen', synonyms: ['abdominal', 'peito', 'barriga'] },
        { name: 'Peito', synonyms: [] },
      ],
    })
    const hit = firstSynonymCollision(
      ['abdominal', 'peito', 'barriga'],
      'svc_1:' + foldWord('peito e abdômen'),
      claims,
    )
    expect(hit).toEqual({ word: 'peito', other: 'Depilação › Peito' })
  })

  it('variantes irmãs (mesmo nome, outro público) partilham dono e não colidem', () => {
    const claims = serviceClaims({
      id: 'svc_1',
      name: 'Depilação',
      synonyms: [],
      zones: [
        { name: 'Axila', synonyms: ['sovaco'] },
        { name: 'Axila', synonyms: ['sovaco'] },
      ],
    })
    const owner = 'svc_1:' + foldWord('Axila')
    expect(claimedElsewhere('sovaco', owner, claims)).toBeNull()
  })
})
