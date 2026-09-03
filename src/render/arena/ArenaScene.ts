import { Euler, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three'
import type { InstancedMesh, Object3D } from 'three'
import {
  ACTOR_HEIGHT,
  ADS_CAMERA_DISTANCE,
  ADS_CAMERA_HEIGHT,
  ADS_CAMERA_SHOULDER,
  BRIEFING_SECONDS,
  CAMERA_DISTANCE,
  CAMERA_FAR,
  CAMERA_FOV,
  CAMERA_HEIGHT,
  CAMERA_LERP,
  CAMERA_NEAR,
  CAMERA_SHOULDER,
} from '../../game/arena/world'
import type { Terrain } from '../../game/types'
import { disposeObject3D } from '../dispose'
import { createCommander, createEnemyPool } from './arenaActors'
import type { Commander, EnemyPool } from './arenaActors'
import { createArenaFx } from './arenaFx'
import { createArenaPacks } from './arenaPacks'
import type { ArenaPacks } from './arenaPacks'
import type { ArenaFx } from './arenaFx'
import { createArenaTerrain } from './arenaTerrain'
import type { ArenaTerrain } from './arenaTerrain'
import type { ArenaView } from './view'

/**
 * The 3D arena.
 *
 * Deliberately framework-free, exactly as `BattleScene` was: it owns pixels and
 * GPU memory and nothing else. It is handed a fight each frame and draws it. It
 * never advances the fight, never reads input and never decides anything — the
 * `ArenaView` contract in `./view.ts` is structural precisely so that this
 * whole directory can be deleted without the rules noticing.
 *
 * Nothing here ever draws Persian text. Arabic-script shaping and bidi do not
 * survive a WebGL text pipeline, so every label stays in the DOM above the
 * canvas. Emoji are safe, and are rasterised in `../textures.ts`.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: `render()` allocates nothing. Every
 * vector, quaternion and matrix it needs was built before the first frame and
 * lives at module or instance scope. A battle is sixty frames a second for a
 * minute and a half on a phone, and a single `new Vector3()` in here is ninety
 * thousand objects for the collector to find.
 */

/* ------------------------------------------------------------------ *
 *  Camera rig
 * ------------------------------------------------------------------ */

/**
 * Where the camera aims from and where the collision probe starts: the
 * commander's upper chest. Starting the probe at the feet would let the camera
 * be pulled through a knee-high wall it can see straight over.
 */
const PIVOT_HEIGHT = ACTOR_HEIGHT * 0.86

/**
 * Radius of the sphere the camera pretends to be while probing cover.
 *
 * It must exceed the near clip plane (0.1) by a comfortable margin, or a wall
 * the probe declares clear still slices the frustum open. It must also stay
 * under the narrowest gap the level generator leaves between two pieces of
 * cover, or the camera would refuse to follow the player down a city alley.
 */
const CAMERA_PROBE_RADIUS = 0.36

/**
 * How much of the aim pitch the boom is allowed to swing through.
 *
 * The camera's ROTATION always uses the full pitch, because the crosshair is a
 * fixed element at the centre of the DOM HUD and the shot must go where it
 * points. The boom only orbits a third of the way, because a full orbit at the
 * pitch limit would bury the camera in the floor.
 */
const CAMERA_PITCH_ORBIT = 0.34

/** The camera never drops below this, whatever the pitch asks for. */
const CAMERA_MIN_HEIGHT = 0.75

/**
 * How fast the camera is allowed back OUT once cover stops blocking it.
 *
 * Coming in is instant — a frame spent inside a tree is a frame of black
 * screen. Going back out is slow, because a camera that snaps to full distance
 * the moment a trunk clears reads as a glitch rather than as a camera.
 */
const CAMERA_UNBLOCK_LERP = 4.5

/** World units of camera displacement at full shake. */
const SHAKE_AMPLITUDE = 0.34

/** Extra boom during the drop-in, so the fight opens on a wide establishing shot. */
const BRIEFING_PULL = 7

/* ------------------------------------------------------------------ *
 *  Scratch
 * ------------------------------------------------------------------ */

const cameraPivot = new Vector3()
const cameraDesired = new Vector3()
const cameraTarget = new Vector3()
const cameraSafe = new Vector3()
const muzzlePoint = new Vector3()
const cameraEuler = new Euler(0, 0, 0, 'YXZ')

/** Frame-rate independent easing. A raw `dt` multiply is not the same thing. */
function approach(current: number, goal: number, rate: number, dt: number): number {
  return current + (goal - current) * (1 - Math.exp(-rate * dt))
}

/* ------------------------------------------------------------------ *
 *  Diagnostics
 * ------------------------------------------------------------------ */

export interface ArenaResourceCounts {
  geometries: number
  textures: number
  programs: number
}

/** How many arenas are alive right now. Must return to 0 after every fight. */
let liveScenes = 0

/**
 * What the renderer still held after the last teardown freed its objects.
 * Every field should be 0; anything else is a leak, and a player enters and
 * leaves a battle dozens of times in one session.
 */
let lastTeardown: ArenaResourceCounts | null = null

export function arenaDiagnostics(): { live: number; lastTeardown: ArenaResourceCounts | null } {
  return { live: liveScenes, lastTeardown }
}

/* ------------------------------------------------------------------ *
 *  The scene
 * ------------------------------------------------------------------ */

export interface ArenaSceneOptions {
  canvas: HTMLCanvasElement
  terrain: Terrain
  /** Drawn as an insignia on the commander's pack, facing the camera. */
  heroEmoji: string
  /** Fired if the GPU drops the context; the caller should stop drawing. */
  onContextLost?: () => void
}

export class ArenaScene {
  private readonly canvas: HTMLCanvasElement
  private readonly renderer: WebGLRenderer
  private readonly scene: Scene
  private readonly camera: PerspectiveCamera
  private readonly terrain: ArenaTerrain
  private readonly commander: Commander
  private readonly enemies: EnemyPool
  private readonly fx: ArenaFx
  private readonly packs: ArenaPacks
  private readonly onContextLost: (() => void) | undefined

  private disposed = false
  private contextLost = false
  private width = 0
  private height = 0
  private frameAt = 0

  /** Cover arrives with the first frame, not with the constructor. See `render`. */
  private coverBuilt = false

  /** Smoothed camera position, so the boom lags the commander instead of welding to them. */
  private readonly boom = new Vector3()
  private boomReady = false

  /** How much of the desired boom length cover is currently allowing. */
  private occlusion = 1

  /** Last field of view pushed into the projection matrix. */
  private fieldOfView = CAMERA_FOV

  private readonly handleContextLost = (event: Event): void => {
    // Keeping the default would make the loss permanent and noisy. We simply
    // stop drawing and tell the caller, which reverts to its own fallback.
    event.preventDefault()
    this.contextLost = true
    this.onContextLost?.()
  }

  constructor({ canvas, terrain, heroEmoji, onContextLost }: ArenaSceneOptions) {
    this.canvas = canvas
    this.onContextLost = onContextLost

    // Everything that costs no GPU memory is built first, so that if any of it
    // throws we have not yet taken a WebGL context we would have to give back.
    this.scene = new Scene()
    // CAMERA_FOV is a VERTICAL field of view, which is what Three.js wants.
    this.camera = new PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR)
    // The camera is driven entirely from yaw and pitch, never from lookAt: the
    // crosshair is a fixed DOM element and the shot has to leave through it.
    this.camera.rotation.order = 'YXZ'

    this.terrain = createArenaTerrain(terrain)
    this.scene.fog = this.terrain.fog
    this.commander = createCommander(heroEmoji)
    this.enemies = createEnemyPool()
    this.fx = createArenaFx()
    this.packs = createArenaPacks()

    this.scene.add(
      this.terrain.group,
      this.commander.group,
      this.enemies.group,
      this.fx.group,
      this.packs.group,
    )

    // Throws when the browser refuses a context. The caller catches and falls
    // back rather than letting the battle screen die.
    this.renderer = new WebGLRenderer({
      canvas,
      // Transparent, so the stage's CSS shows through until the first frame
      // lands and again if the context is ever lost. No black flash.
      alpha: true,
      /*
       * Multisampling is the most expensive thing a phone can be asked for at
       * full screen, and a device already rendering at devicePixelRatio 2 is
       * supersampling for free. So it is spent only where it is actually
       * needed: low-density displays. Read once, because the flag is fixed for
       * the life of the context and cannot be changed on a monitor swap.
       */
      antialias: (window.devicePixelRatio || 1) < 1.5,
      // Unlike the duel — which was a handful of quads and asked for low power —
      // this is a real-time 3D scene and wants the better GPU when there is one.
      powerPreference: 'high-performance',
    })
    // Opaque, and the same colour as the fog, so the fogged floor runs into the
    // sky with no seam. The clear colour is only ever seen where the sky dome
    // does not reach, but a mismatch there is instantly visible as a band.
    this.renderer.setClearColor(this.terrain.horizon, 1)

    canvas.addEventListener('webglcontextlost', this.handleContextLost)
    liveScenes += 1
  }

  /**
   * @param cssWidth  the stage's CSS width, from a ResizeObserver
   * @param cssHeight the stage's CSS height
   */
  resize(cssWidth: number, cssHeight: number): void {
    if (this.disposed || cssWidth <= 0 || cssHeight <= 0) return
    if (cssWidth === this.width && cssHeight === this.height) return

    this.width = cssWidth
    this.height = cssHeight

    this.camera.aspect = cssWidth / cssHeight
    this.camera.updateProjectionMatrix()

    // Re-read the ratio on every resize: dragging a window between a laptop
    // screen and an external monitor changes it without changing the CSS size.
    // Capped at 2 — beyond that a phone is shading four times the pixels for a
    // difference nobody can see.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    // `false` keeps Three.js out of the canvas's CSS box — layout stays in CSS.
    this.renderer.setSize(cssWidth, cssHeight, false)
  }

  /**
   * Draws one frame of a fight and reports whether anything reached the canvas.
   *
   * @param now the rAF timestamp, in milliseconds
   */
  render(now: number, view: ArenaView, reducedMotion: boolean): boolean {
    if (this.disposed || this.contextLost || this.width === 0) return false

    /*
     * Clamped at both ends. The ceiling stops a stalled tab from teleporting
     * the camera on the frame it wakes up. The floor matters more than it
     * looks: every ease in here is `1 - exp(-rate * dt)`, and a negative dt
     * turns that into a number above 1, which does not slow the camera down —
     * it throws it backwards past where it started.
     */
    const dt = this.frameAt === 0 ? 0 : Math.max(0, Math.min(0.1, (now - this.frameAt) / 1000))
    this.frameAt = now

    /*
     * Cover is raised here rather than in the constructor because the React
     * bridge is handed a terrain and a subscription, never a fight — the layout
     * of the ground does not exist until the first frame arrives. It is still
     * built exactly once, and never touched again for the rest of the battle.
     */
    if (!this.coverBuilt) {
      this.coverBuilt = true
      this.terrain.buildCover(view.cover)
    }

    // The commander first: the muzzle position the effects layer needs comes
    // off the rig this call places.
    this.commander.apply(view.player, view.gun, dt, view.elapsed, reducedMotion)

    // Then the camera, because everything after it billboards to the camera's
    // orientation and would otherwise be a frame behind.
    this.updateCamera(view, dt, now, reducedMotion)

    this.enemies.apply(view.enemies, dt, this.camera.quaternion, reducedMotion)
    this.fx.consume(view.events, this.commander.muzzle(muzzlePoint))
    this.fx.bullets(view.bullets)
    this.packs.apply(view.packs, reducedMotion)
    this.fx.update(dt, this.camera.quaternion)

    this.renderer.render(this.scene, this.camera)
    return true
  }

  private updateCamera(view: ArenaView, dt: number, now: number, reducedMotion: boolean): void {
    const { player } = view
    const ads = Math.max(0, Math.min(1, player.ads))

    /* --- Field of view ---------------------------------------------- */

    // The gun's zoom is spent over the same eased 0..1 the boom is, so the
    // pull-in and the zoom land together and read as one movement.
    const fov = CAMERA_FOV * (1 + (view.gun.adsZoom - 1) * ads)
    if (Math.abs(fov - this.fieldOfView) > 0.01) {
      this.fieldOfView = fov
      this.camera.fov = fov
      this.camera.updateProjectionMatrix()
    }

    /* --- Where the boom wants to be ---------------------------------- */

    // The drop-in opens wide and settles into the fighting framing as the
    // briefing runs out, which is what makes a wave arriving feel like an
    // arrival rather than a spawn.
    const briefing =
      view.phase === 'briefing' ? Math.max(0, Math.min(1, view.briefingLeft / BRIEFING_SECONDS)) : 0

    const distance = CAMERA_DISTANCE + (ADS_CAMERA_DISTANCE - CAMERA_DISTANCE) * ads + briefing * BRIEFING_PULL
    const height = CAMERA_HEIGHT + (ADS_CAMERA_HEIGHT - CAMERA_HEIGHT) * ads + briefing * BRIEFING_PULL * 0.85
    const shoulder = CAMERA_SHOULDER + (ADS_CAMERA_SHOULDER - CAMERA_SHOULDER) * ads

    /*
     * Yaw 0 faces -Z and increases counter-clockwise seen from above, so the
     * commander's forward is (-sin, 0, -cos), the direction BEHIND them is
     * (sin, 0, cos), and their right is (cos, 0, -sin). Getting these two signs
     * wrong is the classic way to end up with a camera in front of the player
     * looking at their face.
     */
    const sinYaw = Math.sin(player.yaw)
    const cosYaw = Math.cos(player.yaw)

    // Recoil is deliberately left out of the orbit: it is a rotational punch to
    // the view, not a swing of the boom, and putting it here would make every
    // shot heave the whole camera backwards.
    const orbit = player.pitch * CAMERA_PITCH_ORBIT
    const reach = distance * Math.cos(orbit)
    const rise = Math.max(CAMERA_MIN_HEIGHT, height - distance * Math.sin(orbit))

    cameraPivot.set(
      player.pos.x,
      // A downed commander's camera settles toward the ground with them.
      PIVOT_HEIGHT * (player.alive ? 1 : 0.5),
      player.pos.z,
    )
    cameraDesired.set(
      player.pos.x + sinYaw * reach + cosYaw * shoulder,
      rise,
      player.pos.z + cosYaw * reach - sinYaw * shoulder,
    )

    /* --- Not through the trees ---------------------------------------- */

    const allowed = this.terrain.clearFraction(cameraPivot, cameraDesired, CAMERA_PROBE_RADIUS)
    this.occlusion =
      allowed < this.occlusion
        ? allowed
        : approach(this.occlusion, allowed, CAMERA_UNBLOCK_LERP, dt)
    cameraTarget.lerpVectors(cameraPivot, cameraDesired, this.occlusion)

    if (!this.boomReady) {
      // The very first frame has nothing to lag behind, and easing in from the
      // origin would fly the camera across the whole arena.
      this.boomReady = true
      this.boom.copy(cameraTarget)
    } else {
      this.boom.lerp(cameraTarget, 1 - Math.exp(-CAMERA_LERP * dt))
    }

    /*
     * The smoothing above can cut a corner for a frame or two on its way to a
     * legal position, so the result is probed again and clamped. This is what
     * turns "usually does not clip" into "cannot clip", which matters because
     * the forest and the city are dense enough to do it several times a fight.
     */
    const safe = this.terrain.clearFraction(cameraPivot, this.boom, CAMERA_PROBE_RADIUS)
    if (safe < 1) {
      cameraSafe.lerpVectors(cameraPivot, this.boom, safe)
      this.boom.copy(cameraSafe)
    }
    if (this.boom.y < CAMERA_MIN_HEIGHT * 0.5) this.boom.y = CAMERA_MIN_HEIGHT * 0.5

    /* --- Shake -------------------------------------------------------- */

    // Three incommensurate frequencies, so the noise never settles into a
    // visible rhythm. Reduced motion zeroes it outright rather than damping it;
    // a small shake is still a shake to somebody it makes ill.
    const shake = reducedMotion ? 0 : Math.max(0, Math.min(1, view.shake)) * SHAKE_AMPLITUDE
    if (shake > 0) {
      const t = now * 0.001
      this.camera.position.set(
        this.boom.x + Math.sin(t * 61.3) * shake,
        this.boom.y + Math.sin(t * 74.7) * shake,
        this.boom.z + Math.sin(t * 53.9) * shake,
      )
    } else {
      this.camera.position.copy(this.boom)
    }

    /* --- Where it looks ------------------------------------------------ */

    // Everything that billboards this frame reads `camera.quaternion` straight,
    // not the world matrix, so no graph update is needed before they do.
    cameraEuler.set(player.pitch + player.recoilKick, player.yaw, 0)
    this.camera.quaternion.setFromEuler(cameraEuler)
  }

  resourceCounts(): ArenaResourceCounts {
    const { memory, programs } = this.renderer.info
    return {
      geometries: memory.geometries,
      textures: memory.textures,
      programs: programs?.length ?? 0,
    }
  }

  /** Gives back every GPU resource, including the context itself. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true

    // Before forceContextLoss(), which would otherwise fire our own handler.
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost)

    try {
      // `disposeObject3D` frees geometries, materials and their maps, but an
      // InstancedMesh also owns per-instance attribute buffers that only its
      // own dispose() releases — and this scene is almost entirely instanced.
      this.scene.traverse((node: Object3D) => {
        const instanced = node as Partial<InstancedMesh>
        if (instanced.isInstancedMesh) (node as InstancedMesh).dispose()
      })
      // Emoji textures that were swapped off a billboard are the one thing the
      // scene-graph walker cannot reach.
      this.enemies.dispose()

      disposeObject3D(this.scene)
      lastTeardown = this.resourceCounts()
    } finally {
      this.renderer.dispose()
      this.renderer.forceContextLoss()
      liveScenes -= 1
    }
  }
}
