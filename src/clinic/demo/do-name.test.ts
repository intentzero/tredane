import { describe, expect, it } from 'vitest'
import { DEMO_CLINIC_TENANT_ID } from './ids'
import { DEMO_CLINIC_DO_GENERATION, clinicDurableObjectName } from './do-name'

describe('clinicDurableObjectName', () => {
  it('mantém o id normal para tenants reais', () => {
    expect(clinicDurableObjectName('tenant_aaaaaaaaaaaaaaaaaaaaaaaa')).toBe(
      'tenant_aaaaaaaaaaaaaaaaaaaaaaaa',
    )
  })

  it('sufixa a geração na demo', () => {
    expect(clinicDurableObjectName(DEMO_CLINIC_TENANT_ID)).toBe(
      `${DEMO_CLINIC_TENANT_ID}:${DEMO_CLINIC_DO_GENERATION}`,
    )
  })
})
