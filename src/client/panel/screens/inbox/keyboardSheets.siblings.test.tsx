// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * TR-569: regressão CSS — ReviewSheet / template picker / Conversas Agendar
 * limitam-se a --panel-vvh com o teclado aberto (hook lift faz o bottom).
 */
describe('TR-569 — folhas sibling com teclado iOS', () => {
  it('agd-sheet, inbox-template-picker e conversas-agendar-sheet-modal usam --panel-vvh', () => {
    const panel = readFileSync(join(__dirname, '../../../ui/panel.css'), 'utf8')
    const agendar = readFileSync(join(__dirname, '../agenda/agendar.css'), 'utf8')
    expect(agendar).toMatch(
      /:root\[data-keyboard=['"]open['"]\]\s*\.agd-sheet\s*\{[^}]*max-height:\s*var\(--panel-vvh/s,
    )
    expect(panel).toMatch(
      /:root\[data-keyboard=['"]open['"]\]\s*\.inbox-template-picker\s*\{[^}]*max-height:\s*var\(--panel-vvh/s,
    )
    expect(panel).toMatch(
      /:root\[data-keyboard=['"]open['"]\]\s*\.conversas-agendar-sheet-modal\s*\{[^}]*height:\s*calc\(var\(--panel-vvh/s,
    )
  })

  it('call sites importam useVisualViewportSheet em modo lift', () => {
    const review = readFileSync(join(__dirname, '../agenda/AgendarScreen.tsx'), 'utf8')
    const thread = readFileSync(join(__dirname, './InboxThread.tsx'), 'utf8')
    const conversas = readFileSync(join(__dirname, './ConversasArea.tsx'), 'utf8')
    expect(review).toMatch(/useVisualViewportSheet\(p\.isOpen,\s*\{\s*mode:\s*'lift'\s*\}\)/)
    expect(thread).toMatch(/useVisualViewportSheet\(pickerOpen,\s*\{\s*mode:\s*"lift"\s*\}\)/)
    expect(conversas).toMatch(/useVisualViewportSheet\(agendarOpen,\s*\{\s*mode:\s*'lift'\s*\}\)/)
  })
})
