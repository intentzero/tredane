/**
 * Download de mídia Meta para anexos R2 (#34).
 * Synthetic: fixtures por media_id. Live: Graph GET /{media-id} → URL → bytes.
 * Gates #18 — live só com secrets; nunca aceitar URL arbitrária do cliente.
 */
import type { MetaMode } from './types'
import { graphApiVersion, type MetaEnv, resolveMetaMode } from './meta'

export type MetaMediaDownloadInput = {
  mediaId: string
  accessToken: string
}

export type MetaMediaDownloadSuccess = {
  outcome: 'succeeded'
  bytes: Uint8Array
  contentType: string
  filename: string | null
}

export type MetaMediaDownloadFailed = {
  outcome: 'failed'
  errorCode: string
}

export type MetaMediaDownloadResult = MetaMediaDownloadSuccess | MetaMediaDownloadFailed

export type MetaMediaAdapter = {
  mode: MetaMode
  downloadMedia(input: MetaMediaDownloadInput): Promise<MetaMediaDownloadResult>
}

/** Fixtures JPEG/PNG/PDF/OGG mínimas para testes sintéticos. */
const FIXTURE_JPEG = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
])

const FIXTURE_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02,
  0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44,
  0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x00, 0x03, 0x00,
  0x01, 0x00, 0x05, 0xfe, 0xd4, 0xef, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
])

const FIXTURE_PDF = new TextEncoder().encode('%PDF-1.4\n%âãÏÓ\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')

const FIXTURE_OGG = Uint8Array.from([
  0x4f, 0x67, 0x67, 0x53, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x1e,
  0x01, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73,
])

function syntheticFixture(mediaId: string): MetaMediaDownloadResult {
  const id = mediaId.toLowerCase()
  if (id.includes('fail') || id.includes('missing')) {
    return { outcome: 'failed', errorCode: 'meta_media_not_found' }
  }
  if (id.includes('oversize')) {
    // > 5 MiB image limit
    const huge = new Uint8Array(5 * 1024 * 1024 + 64)
    huge[0] = 0xff
    huge[1] = 0xd8
    huge[huge.length - 2] = 0xff
    huge[huge.length - 1] = 0xd9
    return {
      outcome: 'succeeded',
      bytes: huge,
      contentType: 'image/jpeg',
      filename: 'oversize.jpg',
    }
  }
  if (id.includes('blocked') || id.includes('html')) {
    return {
      outcome: 'succeeded',
      bytes: new TextEncoder().encode('<html><script>alert(1)</script></html>'),
      contentType: 'text/html',
      filename: 'x.html',
    }
  }
  if (id.includes('pdf') || id.includes('document')) {
    return {
      outcome: 'succeeded',
      bytes: FIXTURE_PDF,
      contentType: 'application/pdf',
      filename: 'doc.pdf',
    }
  }
  if (id.includes('audio') || id.includes('ogg')) {
    return {
      outcome: 'succeeded',
      bytes: FIXTURE_OGG,
      contentType: 'audio/ogg',
      filename: 'voice.ogg',
    }
  }
  if (id.includes('png')) {
    return {
      outcome: 'succeeded',
      bytes: FIXTURE_PNG,
      contentType: 'image/png',
      filename: 'pic.png',
    }
  }
  return {
    outcome: 'succeeded',
    bytes: FIXTURE_JPEG,
    contentType: 'image/jpeg',
    filename: 'pic.jpg',
  }
}

export function createSyntheticMetaMediaAdapter(): MetaMediaAdapter {
  return {
    mode: 'synthetic',
    async downloadMedia(input) {
      if (!input.mediaId || !input.accessToken) {
        return { outcome: 'failed', errorCode: 'meta_media_invalid' }
      }
      return syntheticFixture(input.mediaId)
    },
  }
}

export function createLiveMetaMediaAdapter(env: MetaEnv): MetaMediaAdapter {
  const version = graphApiVersion(env)
  return {
    mode: 'live',
    async downloadMedia(input) {
      if (!input.mediaId || !input.accessToken) {
        return { outcome: 'failed', errorCode: 'meta_media_invalid' }
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 20_000)
      try {
        const metaRes = await fetch(
          `https://graph.facebook.com/${version}/${encodeURIComponent(input.mediaId)}`,
          {
            headers: { Authorization: `Bearer ${input.accessToken}` },
            signal: controller.signal,
          },
        )
        if (!metaRes.ok) {
          return { outcome: 'failed', errorCode: `meta_media_http_${metaRes.status}` }
        }
        const meta = (await metaRes.json()) as {
          url?: string
          mime_type?: string
          file_size?: number
        }
        if (!meta.url || !meta.url.startsWith('https://')) {
          return { outcome: 'failed', errorCode: 'meta_media_url_missing' }
        }
        // Apenas URL devolvida pela Graph — nunca URL do cliente.
        const binRes = await fetch(meta.url, {
          headers: { Authorization: `Bearer ${input.accessToken}` },
          signal: controller.signal,
        })
        if (!binRes.ok) {
          return { outcome: 'failed', errorCode: `meta_media_bin_${binRes.status}` }
        }
        const buf = new Uint8Array(await binRes.arrayBuffer())
        const contentType =
          meta.mime_type ??
          binRes.headers.get('content-type')?.split(';')[0]?.trim() ??
          'application/octet-stream'
        return {
          outcome: 'succeeded',
          bytes: buf,
          contentType,
          filename: null,
        }
      } catch (err) {
        const name = err instanceof Error ? err.name : ''
        if (name === 'AbortError') {
          return { outcome: 'failed', errorCode: 'meta_media_timeout' }
        }
        return { outcome: 'failed', errorCode: 'meta_media_network' }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

export function createMetaMediaAdapter(env: MetaEnv): MetaMediaAdapter {
  const mode = resolveMetaMode(env)
  return mode === 'live'
    ? createLiveMetaMediaAdapter(env)
    : createSyntheticMetaMediaAdapter()
}

export const SYNTHETIC_MEDIA_FIXTURES = {
  jpeg: FIXTURE_JPEG,
  png: FIXTURE_PNG,
  pdf: FIXTURE_PDF,
  ogg: FIXTURE_OGG,
} as const
