import type { BufferGeometry, Material, Object3D, Texture } from 'three'

/**
 * Frees every GPU resource hanging off a subtree.
 *
 * Browsers cap how many live WebGL contexts a page may hold, and a leaked
 * geometry or texture keeps its context's memory pinned for the whole session.
 * A player fights dozens of battles, so anything the scene allocates has to
 * come back on unmount — this walker is what guarantees that as layers are
 * added, without every new layer having to remember its own teardown.
 */

/** Only the parts of a node this walker cares about. */
interface Renderable {
  geometry?: BufferGeometry
  material?: Material | Material[]
}

function isTexture(value: unknown): value is Texture {
  return typeof value === 'object' && value !== null && 'isTexture' in value
}

function disposeMaterial(material: Material): void {
  const fields = material as unknown as Record<string, unknown>

  // Map slots on the built-in materials (map, alphaMap, ...).
  for (const value of Object.values(fields)) {
    if (isTexture(value)) value.dispose()
  }

  // Sampler uniforms on a ShaderMaterial.
  const uniforms = fields['uniforms']
  if (uniforms !== null && typeof uniforms === 'object') {
    for (const uniform of Object.values(uniforms as Record<string, { value?: unknown }>)) {
      const value = uniform?.value
      if (isTexture(value)) value.dispose()
    }
  }

  material.dispose()
}

export function disposeObject3D(root: Object3D): void {
  root.traverse((node) => {
    const { geometry, material } = node as Object3D & Renderable
    geometry?.dispose()

    if (Array.isArray(material)) {
      for (const entry of material) disposeMaterial(entry)
    } else if (material) {
      disposeMaterial(material)
    }
  })

  root.clear()
}
