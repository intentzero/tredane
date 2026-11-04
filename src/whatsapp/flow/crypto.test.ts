import { describe, expect, it } from 'vitest'
import {
  decryptFlowRequest,
  decryptFlowResponseForTest,
  encryptFlowRequestForTest,
  encryptFlowResponse,
  generateFlowKeyPair,
  importFlowPrivateKey,
} from './crypto'

describe('whatsapp flow crypto (ADR-0016 §5)', () => {
  it('cifra e decifra round-trip com IV de 16 bytes (Meta) e resposta invertida', async () => {
    const pair = await generateFlowKeyPair()
    const payload = { version: '3.0', action: 'ping', flow_token: 'fl1_test' }
    const encrypted = await encryptFlowRequestForTest(pair.publicKey, payload)
    // Meta: initial_vector é 128 bits (ex. G/1rq1naEOMR4TJHFvIs/Q== → 16 bytes).
    expect(Buffer.from(encrypted.initial_vector, 'base64').byteLength).toBe(16)

    const privateKey = await importFlowPrivateKey(pair.privatePem)
    const decrypted = await decryptFlowRequest(privateKey, encrypted)
    expect(decrypted.payload).toEqual(payload)
    expect(decrypted.iv.byteLength).toBe(16)

    const responseB64 = await encryptFlowResponse(decrypted.aesKey, decrypted.iv, {
      data: { status: 'active' },
    })
    expect(typeof responseB64).toBe('string')
    expect(responseB64.length).toBeGreaterThan(16)
    await expect(
      decryptFlowResponseForTest(decrypted.aesKey, decrypted.iv, responseB64),
    ).resolves.toEqual({ data: { status: 'active' } })
  })

  it('aceita IV de 12 bytes (legado L1) e recusa outros comprimentos', async () => {
    const pair = await generateFlowKeyPair()
    const encrypted = await encryptFlowRequestForTest(pair.publicKey, { action: 'ping' })
    const privateKey = await importFlowPrivateKey(pair.privatePem)

    // Forçar IV de 12 bytes com cifra válida.
    const rawAes = crypto.getRandomValues(new Uint8Array(16))
    const iv12 = crypto.getRandomValues(new Uint8Array(12))
    const aesKey = await crypto.subtle.importKey(
      'raw',
      rawAes,
      { name: 'AES-GCM', length: 128 },
      false,
      ['encrypt', 'decrypt'],
    )
    const encryptedAesKey = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pair.publicKey, rawAes),
    )
    const plain = new TextEncoder().encode(JSON.stringify({ action: 'ping' }))
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv12, tagLength: 128 },
        aesKey,
        plain,
      ),
    )
    const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
    const with12 = {
      encrypted_aes_key: b64(encryptedAesKey),
      encrypted_flow_data: b64(sealed),
      initial_vector: b64(iv12),
    }
    await expect(decryptFlowRequest(privateKey, with12)).resolves.toMatchObject({
      payload: { action: 'ping' },
    })

    await expect(
      decryptFlowRequest(privateKey, {
        ...encrypted,
        initial_vector: Buffer.alloc(8).toString('base64'),
      }),
    ).rejects.toThrow(/flow_iv_invalid/)
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
