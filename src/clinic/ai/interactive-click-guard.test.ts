import { describe, expect, it } from 'vitest'
import {
  CHOICE_CLICK_FALLBACK_TEXT,
  CHOICE_STALE_CLICK_FALLBACK_TEXT,
  pickFallbackBody,
} from './interactive-click-guard'

describe('pickFallbackBody', () => {
  it('stale_cleared → texto de oferta indisponível', () => {
    expect(pickFallbackBody('stale_cleared', 'no_pending')).toBe(CHOICE_STALE_CLICK_FALLBACK_TEXT)
  })

  it('reason expired → texto de oferta indisponível', () => {
    expect(pickFallbackBody('stale_reoffered', 'expired')).toBe(CHOICE_STALE_CLICK_FALLBACK_TEXT)
    expect(pickFallbackBody('applied', 'expired')).toBe(CHOICE_STALE_CLICK_FALLBACK_TEXT)
  })

  it('timeout → texto de recebi sua escolha', () => {
    expect(pickFallbackBody('applied', 'timeout')).toBe(CHOICE_CLICK_FALLBACK_TEXT)
  })

  it('already_sent → texto de recebi sua escolha', () => {
    expect(pickFallbackBody('applied', 'already_sent')).toBe(CHOICE_CLICK_FALLBACK_TEXT)
  })

  it('error → texto de recebi sua escolha', () => {
    expect(pickFallbackBody('applied', 'error')).toBe(CHOICE_CLICK_FALLBACK_TEXT)
  })

  it('sem reason → texto de recebi sua escolha', () => {
    expect(pickFallbackBody('applied')).toBe(CHOICE_CLICK_FALLBACK_TEXT)
    expect(pickFallbackBody()).toBe(CHOICE_CLICK_FALLBACK_TEXT)
  })
})
