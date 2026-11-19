// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('BlockForm — De/Até no iPhone', () => {
  it('CSS: date/time mantêm min-height e não colapsam o edit interno do WebKit', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/client/ui/panel.css'), 'utf8')
    expect(css).toMatch(
      /\.block-form-date input\s*\{[^}]*min-height:\s*var\(--size-control-default\)/s,
    )
    expect(css).toMatch(
      /\.block-form-date input::-webkit-datetime-edit\s*,\s*\.block-form-date input::-webkit-date-and-time-value\s*\{[^}]*min-height:/s,
    )
    expect(css).toMatch(/\.block-form-date input\s*\{[^}]*-webkit-appearance:\s*none/s)
  })
})
