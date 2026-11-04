import { describe, expect, it } from 'vitest'
import {
  decryptFlowRequest,
  encryptFlowRequestForTest,
  encryptFlowResponse,
  generateFlowKeyPair,
  importFlowPrivateKey,
} from './crypto'

describe('whatsapp flow crypto (ADR-0016 §5)', () => {
  it('cifra e decifra round-trip com IV invertido na resposta', async () => {
    const pair = await generateFlowKeyPair()
    const payload = { version: '3.0', action: 'ping', flow_token: 'fl1_test' }
    const encrypted = await encryptFlowRequestForTest(pair.publicKey, payload)
    const privateKey = await importFlowPrivateKey(pair.privatePem)
    const decrypted = await decryptFlowRequest(privateKey, encrypted)
    expect(decrypted.payload).toEqual(payload)

    const responseB64 = await encryptFlowResponse(decrypted.aesKey, decrypted.iv, {
      data: { status: 'active' },
    })
    expect(typeof responseB64).toBe('string')
    expect(responseB64.length).toBeGreaterThan(16)
  })

  it('falha ao decifrar com chave errada', async () => {
    const a = await generateFlowKeyPair()
    const b = await generateFlowKeyPair()
    const encrypted = await encryptFlowRequestForTest(a.publicKey, { action: 'ping' })
    await expect(decryptFlowRequest(b.privateKey, encrypted)).rejects.toThrow(
      /flow_aes_key_decrypt_failed/,
    )
  })
})
