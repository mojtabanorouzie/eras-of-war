import { Mesh, ShaderMaterial, Vector2, Vector3 } from 'three'
import type { BufferGeometry } from 'three'
import { parseColor, unit } from './palette'
import { LAYER_Z, RENDER_ORDER } from './world'

/**
 * The terrain gradient, rendered as a single full-frame quad.
 *
 * It reproduces `linear-gradient(150deg, var(--t1), var(--t2))` — the exact
 * declaration `.battle__field` and `.terrain` (the TerrainBanner) already use —
 * so the canvas and the banner above it are the same two colours running the
 * same direction. CSS gradient angles are physical, not logical: `dir="rtl"`
 * does *not* mirror them, so 150deg here means 150deg there.
 */

/** CSS measures gradient angles clockwise from "to top". */
const GRADIENT_ANGLE = (150 * Math.PI) / 180

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/**
 * Colours are mixed in sRGB, matching what a browser does for a CSS gradient.
 * This is a plain ShaderMaterial with no colour-management chunks included, so
 * whatever we write here reaches the framebuffer untouched — which is exactly
 * why the uniforms carry sRGB-encoded values rather than linear ones.
 */
const FRAGMENT_SHADER = /* glsl */ `
  varying vec2 vUv;

  uniform vec2 uSize;
  uniform vec3 uFrom;
  uniform vec3 uTo;
  uniform float uAngle;

  void main() {
    vec2 direction = vec2(sin(uAngle), cos(uAngle));
    // CSS gradient-line length for a box of uSize at this angle.
    float span = abs(uSize.x * direction.x) + abs(uSize.y * direction.y);
    vec2 offset = (vUv - 0.5) * uSize;
    float t = clamp(dot(offset, direction) / max(span, 1.0) + 0.5, 0.0, 1.0);
    gl_FragColor = vec4(mix(uFrom, uTo, t), 1.0);
  }
`

export interface TerrainBackdrop {
  readonly mesh: Mesh
  /**
   * @param worldW  quad width in world units
   * @param worldH  quad height in world units
   * @param cssW    field width in CSS pixels — sets the gradient's angle
   * @param cssH    field height in CSS pixels
   */
  resize(worldW: number, worldH: number, cssW: number, cssH: number): void
}

/** @param colors the terrain's own `colors` pair, straight from `src/data`. */
export function createTerrainBackdrop(
  colors: readonly [string, string],
  quad: BufferGeometry,
): TerrainBackdrop {
  const uniforms = {
    uSize: { value: new Vector2(1, 1) },
    uFrom: { value: new Vector3(...unit(parseColor(colors[0]))) },
    uTo: { value: new Vector3(...unit(parseColor(colors[1]))) },
    uAngle: { value: GRADIENT_ANGLE },
  }

  const material = new ShaderMaterial({
    uniforms,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    depthWrite: false,
  })

  const mesh = new Mesh(quad, material)
  mesh.position.z = LAYER_Z.backdrop
  mesh.renderOrder = RENDER_ORDER.backdrop

  return {
    mesh,
    resize(worldW, worldH, cssW, cssH) {
      mesh.scale.set(worldW, worldH, 1)
      uniforms.uSize.value.set(cssW, cssH)
    },
  }
}
