/**
 * Cifra do endpoint de dados do WhatsApp Flow (ADR-0016 §5).
 * Algoritmo documentado para data API 3.0 (também usado com 4.0 até a Meta
 * documentar outro): RSA-OAEP SHA-256 + AES-128-GCM; resposta com IV invertido.
 *
 * A chave privada vive só em `WHATSAPP_FLOW_PRIVATE_KEY` (Worker secret).
 * Nunca logar corpo decifrado, response_json ou a chave.
 */

const AES_TAG_BITS = 128
const AES_KEY_BITS = 128

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin)
}

function pemToBinary(
  pem: string,
  label: 'PRIVATE KEY' | 'PUBLIC KEY',
): Uint8Array<ArrayBuffer> {
  const begin = `-----BEGIN ${label}-----`
  const end = `-----END ${label}-----`
  const start = pem.indexOf(begin)
  const stop = pem.indexOf(end)
  if (start < 0 || stop < 0) {
    throw new Error('flow_pem_invalid')
  }
  const body = pem
    .slice(start + begin.length, stop)
    .replace(/\s+/g, '')
  return b64ToBytes(body)
}

export async function importFlowPrivateKey(pem: string): Promise<CryptoKey> {
  const pkcs8 = pemToBinary(pem, 'PRIVATE KEY')
  return crypto.subtle.importKey(
    'pkcs8',
    pkcs8 as BufferSource,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['decrypt'],
  )
}

export async function importFlowPublicKey(pem: string): Promise<CryptoKey> {
  const spki = pemToBinary(pem, 'PUBLIC KEY')
  return crypto.subtle.importKey(
    'spki',
    spki as BufferSource,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  )
}

/** Gera par RSA-2048 sem frase-passe (só para testes L1). */
export async function generateFlowKeyPair(): Promise<{
  privateKey: CryptoKey
  publicKey: CryptoKey
  privatePem: string
  publicPem: string
}> {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt'],
  )
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))
  const wrap = (label: string, bytes: Uint8Array) => {
    const b64 = bytesToB64(bytes)
    const lines = b64.match(/.{1,64}/g) ?? [b64]
    return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`
  }
  return {
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    privatePem: wrap('PRIVATE KEY', pkcs8),
    publicPem: wrap('PUBLIC KEY', spki),
  }
}

export type FlowEncryptedRequest = {
  encrypted_flow_data: string
  encrypted_aes_key: string
  initial_vector: string
}

export type FlowDecryptedRequest = {
  aesKey: CryptoKey
  iv: Uint8Array<ArrayBuffer>
  payload: unknown
}

function flipIv(iv: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(iv.length)
  for (let i = 0; i < iv.length; i++) out[i] = iv[i]! ^ 0xff
  return out
}

export async function decryptFlowRequest(
  privateKey: CryptoKey,
  body: FlowEncryptedRequest,
): Promise<FlowDecryptedRequest> {
  const encryptedAesKey = b64ToBytes(body.encrypted_aes_key)
  const iv = b64ToBytes(body.initial_vector)
  const cipherWithTag = b64ToBytes(body.encrypted_flow_data)

  if (iv.length !== 12) throw new Error('flow_iv_invalid')
  if (cipherWithTag.length <= 16) throw new Error('flow_cipher_invalid')

  let rawAes: ArrayBuffer
  try {
    rawAes = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, encryptedAesKey)
  } catch {
    throw new Error('flow_aes_key_decrypt_failed')
  }
  if (rawAes.byteLength !== AES_KEY_BITS / 8) throw new Error('flow_aes_key_length')

  const aesKey = await crypto.subtle.importKey(
    'raw',
    rawAes,
    { name: 'AES-GCM', length: AES_KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  )

  const tagLen = AES_TAG_BITS / 8
  const ciphertext = cipherWithTag.subarray(0, cipherWithTag.length - tagLen)
  const tag = cipherWithTag.subarray(cipherWithTag.length - tagLen)
  const combined = new Uint8Array(ciphertext.length + tag.length)
  combined.set(ciphertext)
  combined.set(tag, ciphertext.length)

  let plain: ArrayBuffer
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: AES_TAG_BITS },
      aesKey,
      combined,
    )
  } catch {
    throw new Error('flow_payload_decrypt_failed')
  }

  const text = new TextDecoder().decode(plain)
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error('flow_payload_json_invalid')
  }
  return { aesKey, iv, payload }
}

export async function encryptFlowResponse(
  aesKey: CryptoKey,
  requestIv: Uint8Array<ArrayBuffer>,
  responseJson: unknown,
): Promise<string> {
  const iv = flipIv(requestIv)
  const plain = new TextEncoder().encode(JSON.stringify(responseJson))
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, tagLength: AES_TAG_BITS },
      aesKey,
      plain,
    ),
  )
  return bytesToB64(sealed)
}

/** Decifra a resposta HTTP do endpoint (IV invertido) — só testes L1. */
export async function decryptFlowResponseForTest(
  aesKey: CryptoKey,
  requestIv: Uint8Array<ArrayBuffer>,
  responseB64: string,
): Promise<unknown> {
  const iv = flipIv(requestIv)
  const sealed = b64ToBytes(responseB64)
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: AES_TAG_BITS },
    aesKey,
    sealed,
  )
  return JSON.parse(new TextDecoder().decode(plain))
}

/** Cifra um pedido (só testes L1 / stubs). */
export async function encryptFlowRequestForTest(
  publicKey: CryptoKey,
  payload: unknown,
): Promise<FlowEncryptedRequest> {
  const rawAes = crypto.getRandomValues(new Uint8Array(AES_KEY_BITS / 8))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const aesKey = await crypto.subtle.importKey(
    'raw',
    rawAes,
    { name: 'AES-GCM', length: AES_KEY_BITS },
    true,
    ['encrypt', 'decrypt'],
  )
  const encryptedAesKey = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, rawAes),
  )
  const plain = new TextEncoder().encode(JSON.stringify(payload))
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, tagLength: AES_TAG_BITS },
      aesKey,
      plain,
    ),
  )
  return {
    encrypted_aes_key: bytesToB64(encryptedAesKey),
    encrypted_flow_data: bytesToB64(sealed),
    initial_vector: bytesToB64(iv),
  }
}
