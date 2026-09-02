import { OrthographicCamera, PlaneGeometry, Scene, WebGLRenderer } from 'three'
import type { BufferGeometry } from 'three'
import { createActor, createImpact, createProjectiles } from './actors'
import type { Actor, ImpactBurst, Projectiles } from './actors'
import { createTerrainBackdrop } from './backdrop'
import type { TerrainBackdrop } from './backdrop'
import { disposeObject3D } from './dispose'
import { createScenery } from './scenery'
import type { Scenery } from './scenery'
import { emojiTexture, radialTexture } from './textures'
import type { DuelView } from './view'
import { CAMERA_Z, GROUND_Y, RENDER_ORDER, frustumFor } from './world'

/**
 * The WebGL battlefield.
 *
 * Deliberately framework-free: it owns pixels and GPU memory and nothing else.
 * It is handed a fight each frame and draws it. It never advances the fight,
 * never reads input, and never decides anything — so the CSS fallback can draw
 * the very same fight without any of this existing.
 *
 * Nothing here ever draws Persian text. Arabic-script shaping and bidi do not
 * survive a WebGL text pipeline, so every label stays in the DOM above the
 * canvas. Emoji are safe, and are rasterised in `textures.ts`.
 */

/** Army height in world units. The frame is never shorter than 12. */
const ACTOR_SIZE = 3.6

export interface FieldDescription {
  /** Stable key seeding the scenery. The terrain id does nicely. */
  seed: string
  /** The terrain's own gradient stops, so the canvas matches the banner. */
  colors: readonly [string, string]
  /** The commander leading the fight. */
  playerEmoji: string
  /** The weapon that commander is carrying, drawn at their side. */
  playerWeaponEmoji: string
  enemyEmoji: string
}

export interface BattleSceneOptions {
  canvas: HTMLCanvasElement
  field: FieldDescription
  /** Fired if the GPU drops the context; the caller should fall back to CSS. */
  onContextLost?: () => void
}

export interface ResourceCounts {
  geometries: number
  textures: number
  programs: number
}

/** How many scenes are alive right now. Must return to 0 after every battle. */
let liveScenes = 0

/**
 * What the renderer still held after the last teardown freed its objects.
 * Every field should be 0; anything else is a leak.
 */
let lastTeardown: ResourceCounts | null = null

export function sceneDiagnostics(): { live: number; lastTeardown: ResourceCounts | null } {
  return { live: liveScenes, lastTeardown }
}

export class BattleScene {
  private readonly canvas: HTMLCanvasElement
  private readonly renderer: WebGLRenderer
  private readonly scene: Scene
  private readonly camera: OrthographicCamera
  /** One unit quad behind every sprite in the scene — this is a 2D game. */
  private readonly quad: BufferGeometry
  private readonly backdrop: TerrainBackdrop
  private readonly scenery: Scenery
  private readonly player: Actor
  private readonly enemy: Actor
  private readonly shots: Projectiles
  private readonly impact: ImpactBurst
  private readonly onContextLost: (() => void) | undefined

  private disposed = false
  private contextLost = false
  private width = 0
  private height = 0
  private frameAt = 0
  /** Previous flinch timers, so a rising edge can fire the impact burst. */
  private wasHurt = { player: 0, enemy: 0 }

  private readonly handleContextLost = (event: Event): void => {
    // Keeping the default would make the loss permanent and noisy. We simply
    // stop drawing; the canvas turns transparent and the CSS field that sits
    // behind it takes over, so the player never sees a hole.
    event.preventDefault()
    this.contextLost = true
    this.onContextLost?.()
  }

  constructor({ canvas, field, onContextLost }: BattleSceneOptions) {
    this.canvas = canvas
    this.onContextLost = onContextLost

    // Everything that costs no GPU memory is built first, so that if any of it
    // throws we have not yet taken a WebGL context we would have to give back.
    this.scene = new Scene()
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100)
    this.camera.position.z = CAMERA_Z

    this.quad = new PlaneGeometry(1, 1)
    // One white radial map serves as ground shadow, wind-up tell, shots and
    // sparks; each material tints it differently.
    const radial = radialTexture()

    this.backdrop = createTerrainBackdrop(field.colors, this.quad)
    this.scenery = createScenery(field.seed, field.colors, this.quad)
    this.player = createActor(
      emojiTexture(field.playerEmoji),
      radial,
      this.quad,
      RENDER_ORDER.player,
      emojiTexture(field.playerWeaponEmoji),
    )
    this.enemy = createActor(emojiTexture(field.enemyEmoji), radial, this.quad, RENDER_ORDER.enemy)
    this.shots = createProjectiles(radial, this.quad)
    this.impact = createImpact(radial, this.quad)

    this.scene.add(
      this.backdrop.mesh,
      ...this.scenery.meshes,
      ...this.enemy.meshes,
      ...this.player.meshes,
      ...this.shots.meshes,
      ...this.impact.meshes,
    )

    // Throws when the browser refuses a context. The caller catches and falls
    // back to CSS rather than letting the battle screen die.
    this.renderer = new WebGLRenderer({
      canvas,
      // Transparent, so the field's CSS gradient shows through until the first
      // frame lands, and again if the context is ever lost. No black flash.
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    })
    this.renderer.setClearColor(0x000000, 0)

    canvas.addEventListener('webglcontextlost', this.handleContextLost)
    liveScenes += 1
  }

  /**
   * @param cssWidth  the field's CSS width, from a ResizeObserver
   * @param cssHeight the field's CSS height
   */
  resize(cssWidth: number, cssHeight: number): void {
    if (this.disposed || cssWidth <= 0 || cssHeight <= 0) return
    if (cssWidth === this.width && cssHeight === this.height) return

    this.width = cssWidth
    this.height = cssHeight

    const view = frustumFor(cssWidth / cssHeight)
    this.camera.left = -view.width / 2
    this.camera.right = view.width / 2
    this.camera.top = view.height / 2
    this.camera.bottom = -view.height / 2
    this.camera.updateProjectionMatrix()

    // Re-read the ratio on every resize: dragging a window between a laptop
    // screen and an external monitor changes it without changing the CSS size.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    // `false` keeps Three.js out of the canvas's CSS box — layout stays with CSS.
    this.renderer.setSize(cssWidth, cssHeight, false)

    this.backdrop.resize(view.width, view.height, cssWidth, cssHeight)
    this.scenery.resize(view.width, view.height)
  }

  /**
   * Draws one frame of a fight and reports whether anything reached the canvas.
   *
   * @param now the rAF timestamp, in milliseconds
   */
  render(now: number, view: DuelView, reducedMotion: boolean): boolean {
    if (this.disposed || this.contextLost || this.width === 0) return false

    const dt = this.frameAt === 0 ? 0 : Math.min(0.1, (now - this.frameAt) / 1000)
    this.frameAt = now

    // A flinch that has just started is a blow that has just landed.
    this.fireBurstOnHit('player', view.player)
    this.fireBurstOnHit('enemy', view.enemy)

    this.scenery.update(reducedMotion ? 0 : now / 1000)
    this.player.apply(view.player, 'player', ACTOR_SIZE)
    this.enemy.apply(view.enemy, 'enemy', ACTOR_SIZE)
    this.shots.apply(view.projectiles, ACTOR_SIZE)
    this.impact.update(dt, ACTOR_SIZE)

    // Shake is applied in CSS to the whole field, so the HUD and the arena move
    // together and the fallback gets it too. The camera stays put.
    this.renderer.render(this.scene, this.camera)
    return true
  }

  private fireBurstOnHit(side: 'player' | 'enemy', fighter: DuelView['player']): void {
    const previous = this.wasHurt[side]
    this.wasHurt[side] = fighter.hurt
    if (fighter.hurt > previous) {
      this.impact.strike(fighter.x, GROUND_Y + ACTOR_SIZE * 0.5)
    }
  }

  resourceCounts(): ResourceCounts {
    const { memory, programs } = this.renderer.info
    return { geometries: memory.geometries, textures: memory.textures, programs: programs?.length ?? 0 }
  }

  /** Gives back every GPU resource, including the context itself. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true

    // Before forceContextLoss(), which would otherwise fire our own handler.
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost)

    try {
      disposeObject3D(this.scene)
      lastTeardown = this.resourceCounts()
    } finally {
      this.renderer.dispose()
      this.renderer.forceContextLoss()
      liveScenes -= 1
    }
  }
}
