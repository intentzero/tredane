/**
 * R2Bucket mínimo em memória para testes unitários (#34).
 */
type Stored = {
  body: Uint8Array
  httpMetadata?: R2HTTPMetadata
  customMetadata?: Record<string, string>
  uploaded: Date
  etag: string
}

function asObject(key: string, o: Stored): R2Object {
  return {
    key,
    size: o.body.byteLength,
    etag: o.etag,
    httpEtag: o.etag,
    uploaded: o.uploaded,
    httpMetadata: o.httpMetadata,
    customMetadata: o.customMetadata,
    checksums: {},
    storageClass: 'Standard',
    version: undefined,
    range: undefined,
    writeHttpMetadata() {
      /* noop */
    },
  } as unknown as R2Object
}

export function createMemoryR2Bucket(): R2Bucket {
  const objects = new Map<string, Stored>()

  return {
    async head(key: string) {
      const o = objects.get(key)
      return o ? asObject(key, o) : null
    },
    async get(key: string) {
      const o = objects.get(key)
      if (!o) return null
      const body = o.body
      const base = asObject(key, o)
      return {
        ...base,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(body)
            controller.close()
          },
        }),
        bodyUsed: false,
        arrayBuffer: async () => {
          const copy = new Uint8Array(body.byteLength)
          copy.set(body)
          return copy.buffer
        },
        text: async () => new TextDecoder().decode(body),
        json: async () => JSON.parse(new TextDecoder().decode(body)),
        blob: async () => {
          const copy = new Uint8Array(body.byteLength)
          copy.set(body)
          return new Blob([copy])
        },
      } as unknown as R2ObjectBody
    },
    async put(
      key: string,
      value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null,
      options?: R2PutOptions,
    ) {
      let bytes: Uint8Array
      if (value == null) bytes = new Uint8Array()
      else if (typeof value === 'string') bytes = new TextEncoder().encode(value)
      else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value)
      else if (ArrayBuffer.isView(value)) {
        bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      } else if (typeof Blob !== 'undefined' && value instanceof Blob) {
        bytes = new Uint8Array(await value.arrayBuffer())
      } else {
        const reader = (value as ReadableStream<Uint8Array>).getReader()
        const chunks: Uint8Array[] = []
        for (;;) {
          const { done, value: chunk } = await reader.read()
          if (done) break
          chunks.push(chunk)
        }
        const total = chunks.reduce((n, c) => n + c.byteLength, 0)
        bytes = new Uint8Array(total)
        let offset = 0
        for (const c of chunks) {
          bytes.set(c, offset)
          offset += c.byteLength
        }
      }
      const etag = `etag_${key}_${bytes.byteLength}`
      const httpMetadata =
        options?.httpMetadata && !(options.httpMetadata instanceof Headers)
          ? options.httpMetadata
          : undefined
      const stored: Stored = {
        body: bytes,
        httpMetadata,
        customMetadata: options?.customMetadata,
        uploaded: new Date(),
        etag,
      }
      objects.set(key, stored)
      return asObject(key, stored)
    },
    async delete(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) objects.delete(k)
    },
    async list(options?: R2ListOptions) {
      const prefix = options?.prefix ?? ''
      const keys = [...objects.keys()]
        .filter((k) => k.startsWith(prefix))
        .sort()
      const limit = options?.limit ?? 1000
      const start = options?.cursor
        ? keys.findIndex((k) => k > options.cursor!) + 1
        : 0
      const slice = keys.slice(Math.max(0, start), Math.max(0, start) + limit)
      const truncated = start + limit < keys.length
      return {
        objects: slice.map((key) => asObject(key, objects.get(key)!)),
        truncated,
        cursor: truncated ? slice[slice.length - 1] : undefined,
        delimitedPrefixes: [],
      }
    },
    createMultipartUpload() {
      throw new Error('multipart_not_implemented')
    },
    resumeMultipartUpload() {
      throw new Error('multipart_not_implemented')
    },
  } as unknown as R2Bucket
}
