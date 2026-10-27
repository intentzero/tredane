/**
 * Setup do projeto jsdom: o jsdom não implementa scrollIntoView, e sem
 * `globals` a Testing Library não desmonta sozinha entre testes — árvores
 * React vivas depois do teardown davam «window is not defined» (AccountMenu).
 */
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
}

afterEach(() => {
  cleanup()
})
