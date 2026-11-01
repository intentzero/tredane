import { describe, expect, it } from 'vitest'
import {
  areaNavLabel,
  areaTitle,
  panelHref,
  resolvePanelRoute,
  resolveRootRedirect,
} from './routes'

describe('panel routes (#22)', () => {
  it('resolve painel entrar / clinicas / áreas', () => {
    expect(resolvePanelRoute('/entrar')).toEqual({ kind: 'entrar' })
    expect(resolvePanelRoute('/entrar/factor-one')).toEqual({ kind: 'entrar' })
    expect(resolvePanelRoute('/clinicas')).toEqual({ kind: 'clinicas' })
    expect(resolvePanelRoute('/c/clinic-demo-a/conversas')).toEqual({
      kind: 'area',
      area: 'conversas',
      tenantId: 'clinic-demo-a',
      section: 'lista',
      conversationId: undefined,
      contactId: undefined,
    })
    expect(resolvePanelRoute('/c/clinic-demo-a/acompanhamento')).toEqual({
      kind: 'area',
      area: 'acompanhamento',
      tenantId: 'clinic-demo-a',
      section: 'quadro',
    })
    expect(resolvePanelRoute('/c/clinic-demo-a/acompanhamento/opp_1')).toEqual({
      kind: 'area',
      area: 'acompanhamento',
      tenantId: 'clinic-demo-a',
      section: 'detalhe',
      opportunityId: 'opp_1',
    })
    expect(resolvePanelRoute('/c/clinic-demo-a/agenda')).toEqual({
      kind: 'area',
      area: 'agenda',
      tenantId: 'clinic-demo-a',
      section: 'dia',
      date: undefined,
    })
    expect(resolvePanelRoute('/c/clinic-demo-a/agenda/agendar')).toEqual({
      kind: 'area',
      area: 'agenda',
      tenantId: 'clinic-demo-a',
      section: 'agendar',
      date: undefined,
    })
    expect(resolvePanelRoute('/c/clinic-demo-a/agenda/semana')).toEqual({
      kind: 'area',
      area: 'agenda',
      tenantId: 'clinic-demo-a',
      section: 'semana',
    })
    expect(resolvePanelRoute('/c/clinic-demo-a/agenda/compromisso/apt_1')).toEqual({
      kind: 'area',
      area: 'agenda',
      tenantId: 'clinic-demo-a',
      section: 'compromisso',
      appointmentId: 'apt_1',
      date: undefined,
    })
    expect(
      resolvePanelRoute('/c/clinic-demo-a/agenda/compromisso/apt_1', '?date=2026-11-02'),
    ).toEqual({
      kind: 'area',
      area: 'agenda',
      tenantId: 'clinic-demo-a',
      section: 'compromisso',
      appointmentId: 'apt_1',
      date: '2026-11-02',
    })
    expect(resolvePanelRoute('/c/clinic-demo-a/agenda', '?date=2026-11-02')).toEqual({
      kind: 'area',
      area: 'agenda',
      tenantId: 'clinic-demo-a',
      section: 'dia',
      date: '2026-11-02',
    })
    expect(resolvePanelRoute('/c/clinic-demo-a/avisos')).toEqual({
      kind: 'area',
      area: 'avisos',
      tenantId: 'clinic-demo-a',
    })
    expect(resolvePanelRoute('/')).toBeNull()
    expect(resolvePanelRoute('/prova')).toBeNull()
  })

  it('href avisos PWA (#42)', () => {
    expect(
      panelHref({ kind: 'area', area: 'avisos', tenantId: 'clinic-demo-a' }),
    ).toBe('/c/clinic-demo-a/avisos')
  })

  it('href agenda / agendar / semana / compromisso (#35/#36)', () => {
    expect(
      panelHref({
        kind: 'area',
        area: 'agenda',
        tenantId: 'clinic-demo-a',
        section: 'dia',
      }),
    ).toBe('/c/clinic-demo-a/agenda')
    expect(
      panelHref({
        kind: 'area',
        area: 'agenda',
        tenantId: 'clinic-demo-a',
        section: 'dia',
        date: '2026-11-02',
      }),
    ).toBe('/c/clinic-demo-a/agenda?date=2026-11-02')
    expect(
      panelHref({
        kind: 'area',
        area: 'agenda',
        tenantId: 'clinic-demo-a',
        section: 'agendar',
      }),
    ).toBe('/c/clinic-demo-a/agenda/agendar')
    expect(
      panelHref({
        kind: 'area',
        area: 'agenda',
        tenantId: 'clinic-demo-a',
        section: 'semana',
      }),
    ).toBe('/c/clinic-demo-a/agenda/semana')
    expect(
      panelHref({
        kind: 'area',
        area: 'agenda',
        tenantId: 'clinic-demo-a',
        section: 'compromisso',
        appointmentId: 'apt_1',
      }),
    ).toBe('/c/clinic-demo-a/agenda/compromisso/apt_1')
    expect(
      panelHref({
        kind: 'area',
        area: 'agenda',
        tenantId: 'clinic-demo-a',
        section: 'compromisso',
        appointmentId: 'apt_1',
        date: '2026-11-02',
      }),
    ).toBe('/c/clinic-demo-a/agenda/compromisso/apt_1?date=2026-11-02')
  })

  it('rótulo curto Acompanhar e título Acompanhamento (DEC-045)', () => {
    expect(areaNavLabel('acompanhamento')).toBe('Acompanhar')
    expect(areaTitle('acompanhamento')).toBe('Acompanhamento')
    expect(
      panelHref({
        kind: 'area',
        area: 'clinica',
        tenantId: 'clinic-demo-a',
        section: 'hub',
      }),
    ).toBe('/c/clinic-demo-a/clinica')
  })

  it('resolve Equipe (S1)', () => {
    expect(resolvePanelRoute('/c/clinic-demo-a/clinica/equipe')).toEqual({
      kind: 'area',
      area: 'clinica',
      tenantId: 'clinic-demo-a',
      section: 'equipe',
    })
    expect(
      panelHref({
        kind: 'area',
        area: 'clinica',
        tenantId: 'clinic-demo-a',
        section: 'equipe',
      }),
    ).toBe('/c/clinic-demo-a/clinica/equipe')
  })

  it('resolve sub-rotas WhatsApp (#31)', () => {
    expect(resolvePanelRoute('/c/clinic-demo-a/clinica/whatsapp')).toEqual({
      kind: 'area',
      area: 'clinica',
      tenantId: 'clinic-demo-a',
      section: 'whatsapp',
    })
    expect(resolvePanelRoute('/c/clinic-demo-a/clinica/whatsapp/trocar')).toEqual({
      kind: 'area',
      area: 'clinica',
      tenantId: 'clinic-demo-a',
      section: 'whatsapp-trocar',
    })
    expect(
      panelHref({
        kind: 'area',
        area: 'clinica',
        tenantId: 'clinic-demo-a',
        section: 'whatsapp-desconectar',
      }),
    ).toBe('/c/clinic-demo-a/clinica/whatsapp/desconectar')
    expect(resolvePanelRoute('/c/clinic-demo-a/clinica/whatsapp/historico')).toEqual({
      kind: 'area',
      area: 'clinica',
      tenantId: 'clinic-demo-a',
      section: 'whatsapp-historico',
    })
    expect(
      panelHref({
        kind: 'area',
        area: 'clinica',
        tenantId: 'clinic-demo-a',
        section: 'whatsapp-historico',
      }),
    ).toBe('/c/clinic-demo-a/clinica/whatsapp/historico')
    expect(resolvePanelRoute('/c/clinic-demo-a/clinica/whatsapp/dev-sync')).toEqual({
      kind: 'area',
      area: 'clinica',
      tenantId: 'clinic-demo-a',
      section: 'whatsapp-dev-sync',
    })
    expect(
      panelHref({
        kind: 'area',
        area: 'clinica',
        tenantId: 'clinic-demo-a',
        section: 'whatsapp-dev-sync',
      }),
    ).toBe('/c/clinic-demo-a/clinica/whatsapp/dev-sync')
  })

  it('resolve Clientes lista e ficha (Opção C)', () => {
    expect(resolvePanelRoute('/c/clinic-demo-a/clientes')).toEqual({
      kind: 'area',
      area: 'clientes',
      tenantId: 'clinic-demo-a',
      section: 'lista',
    })
    expect(resolvePanelRoute('/c/clinic-demo-a/clientes/ctc_1')).toEqual({
      kind: 'area',
      area: 'clientes',
      tenantId: 'clinic-demo-a',
      section: 'ficha',
      contactId: 'ctc_1',
    })
    expect(
      panelHref({
        kind: 'area',
        area: 'clientes',
        tenantId: 'clinic-demo-a',
        section: 'lista',
      }),
    ).toBe('/c/clinic-demo-a/clientes')
    expect(
      panelHref({
        kind: 'area',
        area: 'clientes',
        tenantId: 'clinic-demo-a',
        section: 'ficha',
        contactId: 'ctc_1',
      }),
    ).toBe('/c/clinic-demo-a/clientes/ctc_1')
    expect(areaTitle('clientes')).toBe('Clientes')
    expect(areaNavLabel('clientes')).toBe('Clientes')
  })

  it('resolve sub-rotas de conversas (#29)', () => {
    expect(resolvePanelRoute('/c/clinic-demo-a/conversas')).toEqual({
      kind: 'area',
      area: 'conversas',
      tenantId: 'clinic-demo-a',
      section: 'lista',
      conversationId: undefined,
      contactId: undefined,
    })
    expect(resolvePanelRoute('/c/clinic-demo-a/conversas/cnv_1')).toEqual({
      kind: 'area',
      area: 'conversas',
      tenantId: 'clinic-demo-a',
      section: 'thread',
      conversationId: 'cnv_1',
      contactId: undefined,
    })
    expect(resolvePanelRoute('/c/clinic-demo-a/conversas/cnv_1/contato')).toEqual({
      kind: 'area',
      area: 'conversas',
      tenantId: 'clinic-demo-a',
      section: 'contato',
      conversationId: 'cnv_1',
      contactId: undefined,
    })
    expect(
      panelHref({
        kind: 'area',
        area: 'conversas',
        tenantId: 'clinic-demo-a',
        section: 'thread',
        conversationId: 'cnv_1',
      }),
    ).toBe('/c/clinic-demo-a/conversas/cnv_1')
  })

  it('resolve sub-rotas de configuração da clínica (#28)', () => {
    expect(resolvePanelRoute('/c/clinic-demo-a/clinica')).toEqual({
      kind: 'area',
      area: 'clinica',
      tenantId: 'clinic-demo-a',
      section: 'hub',
      entityId: undefined,
    })
    expect(resolvePanelRoute('/c/clinic-demo-a/clinica/servicos/novo')).toEqual({
      kind: 'area',
      area: 'clinica',
      tenantId: 'clinic-demo-a',
      section: 'servico',
      entityId: 'novo',
    })
    expect(resolvePanelRoute('/c/clinic-demo-a/clinica/recursos/profissional/pro_1')).toEqual({
      kind: 'area',
      area: 'clinica',
      tenantId: 'clinic-demo-a',
      section: 'profissional',
      entityId: 'pro_1',
    })
    expect(resolvePanelRoute('/c/clinic-demo-a/clinica/horarios')).toEqual({
      kind: 'area',
      area: 'clinica',
      tenantId: 'clinic-demo-a',
      section: 'horarios',
      entityId: undefined,
    })
  })
})

describe('root redirect', () => {
  it('/ redireciona para /entrar; outras rotas não', () => {
    expect(resolveRootRedirect('/')).toBe('/entrar')
    expect(resolveRootRedirect('')).toBe('/entrar')
    expect(resolveRootRedirect('//')).toBe('/entrar')
    expect(resolveRootRedirect('/entrar')).toBeNull()
    expect(resolveRootRedirect('/clinicas')).toBeNull()
    expect(resolveRootRedirect('/prova')).toBeNull()
  })
})
