const STUB = new URL('./worker-bundle-stub-cloudflare.mjs', import.meta.url).href

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:workers') {
    return { url: STUB, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}