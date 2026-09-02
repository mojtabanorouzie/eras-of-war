/**
 * Can this browser actually hand us a WebGL context?
 *
 * This deliberately lives outside `src/render/`: it touches no Three.js at all,
 * and `Battle.tsx` has to answer the question *before* it decides whether to
 * download the Three.js chunk. Keeping it here leaves `src/render/**` a pure
 * Three.js zone with exactly one React consumer.
 *
 * The answer is cached because probing costs a real WebGL context, and browsers
 * cap how many of those may exist at once. Asking twice would be a slow leak.
 */

let cached: boolean | undefined

function probe(): boolean {
  if (typeof document === 'undefined') return false

  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    if (!gl) return false
    // We only wanted to know it exists — give the context straight back.
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return true
  } catch {
    // Some privacy modes throw instead of returning null.
    return false
  }
}

export function isWebGLAvailable(): boolean {
  if (cached === undefined) cached = probe()
  return cached
}
