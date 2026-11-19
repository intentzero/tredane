/**
 * DEC-211: o endereço da clínica sai. A localização é só o link do Google Business
 * (`google_business_url`). Não há clínicas em produção, por isso sem período de transição.
 * `appointment_proposals.clinic_location_text` fica: passa a guardar o link.
 */
export const MIGRATION_ID = 76
export const MIGRATION_NAME = '0076_drop_clinic_address'

export const STATEMENTS = [`ALTER TABLE clinic_settings DROP COLUMN clinic_address`] as const
