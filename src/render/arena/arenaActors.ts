import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector3,
} from 'three'
import type { BufferGeometry, Object3D, Texture } from 'three'
import { ACTOR_HEIGHT, ACTOR_RADIUS, MUZZLE_HEIGHT, ROLL_TIME } from '../../game/arena/world'
import { emojiTexture, radialTexture } from '../textures'
import type { ArenaView, ArenaViewEnemyKind, EnemyView, PlayerView } from './view'

/**
 * The bodies in the arena: the commander seen from behind, and the squad coming
 * at them.
 *
 * The game still ships no models — everything is Three.js primitives — but a
 * capsule with a stick was making the fight look like a physics demo, so the
 * primitives are now spent on ARTICULATION instead of on being few. Every
 * fighter is a little jointed rig: hips, knees, shoulders, elbows, a head that
 * looks where its owner looks, and a weapon that is actually held in two hands.
 * The hold is the whole trick. A gun floating beside a torso reads as a block
 * with a stick; the same gun with a hand on the grip and a hand on the fore-end
 * reads as a soldier, and a cheap two-bone IK solve per arm is all it costs.
 *
 * Nothing is allocated per frame. Rigs and weapons are built once, joints are
 * posed in `apply`, and every vector, quaternion and colour the posing needs
 * lives at module scope. The enemy pool, the drop-in, the death collapse and
 * the dispose accounting all keep the shape they shipped with.
 *
 * What this file still owns above all is legibility, and the WIND-UP TELL. An
 * enemy's `windUp` is the player's only warning before a blow lands. It keeps
 * its three channels — the pool of light, the converging ring, the body heating
 * toward the tell colour — and now gains a fourth: the striking arm physically
 * rears back over the wind-up, so the body itself telegraphs.
 *
 * Nothing here draws Persian text. Emoji are rasterised through `textures.ts`
 * and hung on billboards; every label lives in the DOM above the canvas.
 */

/* ------------------------------------------------------------------ *
 *  Shared feel constants
 * ------------------------------------------------------------------ */

/**
 * The reference wind-up, in seconds.
 *
 * `windUp` counts down and each enemy kind commits for a different length of
 * time, so the tell is drawn against a fixed window instead: a blow more than
 * this far away shows the tell at its faintest, and the last half-second is
 * where it ramps. Widen it and slow enemies telegraph too early to feel
 * dangerous; narrow it and the player gets no time to move.
 */
const TELL_WINDOW = 0.55

/** The duel's own tell colours, carried over so the read is already learned. */
const TELL_EARLY = new Color(0xffb347)
const TELL_LATE = new Color(0xff4d4d)

/** A hit reads white-hot; reeling from a stagger reads cold. */
const HURT_GLOW = new Color(0xffe9c4)
const COLD_TINT = new Color(0x9ec6ff)

/** Seconds a body takes to fall, sink and be gone. */
const DEATH_TIME = 0.7

/** Seconds of the drop-in scale-up. Shorter than the briefing, on purpose. */
const DROP_IN_TIME = 0.42

/** How far above the arena an enemy falls in from. */
const DROP_IN_HEIGHT = 7

/**
 * Enemy slots allocated up front.
 *
 * Waves top out well below this; twelve leaves room for the boss wave plus
 * stragglers still collapsing from the wave before. Nothing is ever allocated
 * beyond it — a thirteenth enemy simply is not drawn, which is a far better
 * failure than a stutter mid-fight.
 */
const ENEMY_POOL = 12

/**
 * Ground speed, in units per second, at which a walk cycle reaches full
 * amplitude. Deliberately a touch under the commander's walk speed so ordinary
 * movement already swings the limbs fully and sprinting reads through frequency
 * and lean instead of through ever-wilder legs.
 */
const FULL_STRIDE_SPEED = 6

/** Radians of stride phase advanced per world unit walked. Sets step length. */
const STRIDE_RATE = 1.9

/* ------------------------------------------------------------------ *
 *  Scratch
 * ------------------------------------------------------------------ */

const scratchPosition = new Vector3()
const scratchScale = new Vector3()
const scratchAxis = new Vector3()
const scratchQuaternion = new Quaternion()
const scratchTumble = new Quaternion()
const scratchEuler = new Euler(0, 0, 0, 'YXZ')
const scratchMatrix = new Matrix4()
const scratchColor = new Color()

// Dedicated pose scratch, separate from the general set above so the arm
// solver and the target bookkeeping can never trample each other mid-frame.
const armTargetR = new Vector3()
const armTargetL = new Vector3()
const poleScratch = new Vector3()
const poseVec = new Vector3()
const nockScratch = new Vector3()
const stringVec = new Vector3()

const DOWN = new Vector3(0, -1, 0)

/** Overshoots past 1 and settles: the drop-in lands with weight. */
function backOut(t: number): number {
  const p = t - 1
  return 1 + 2.4 * p * p * p + 1.4 * p * p
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t
}

/** A 0→1→0 bump over t in 0..1. Drives gestures that go out and come back. */
function bell(t: number): number {
  return 4 * t * (1 - t)
}

/* ------------------------------------------------------------------ *
 *  Two-bone arm solver
 * ------------------------------------------------------------------ */

const ikTo = new Vector3()
const ikDir = new Vector3()
const ikAxis = new Vector3()
const ikFore = new Vector3()
const ikQuatA = new Quaternion()
const ikQuatB = new Quaternion()

/**
 * Points a shoulder+elbow chain so the hand lands on `target`.
 *
 * This is the piece that makes a weapon look HELD. The gun is posed first —
 * raised for ADS, dipped for a reload, kicked by recoil — and then each arm is
 * solved backwards from its grip point, so the hands stay glued to the weapon
 * through every state without a single hand-animated keyframe.
 *
 * Plain law-of-cosines two-bone IK, solved in the torso's local space (both
 * shoulders and the aim mount are children of the torso, so everything already
 * agrees on a frame). `pole` says which way the elbow points; without it the
 * bend direction is ambiguous and elbows fold through the ribcage.
 *
 * Limbs are modelled hanging along -Y with the pivot at the joint, so a bone's
 * orientation is just "rotate -Y onto this direction". `setFromUnitVectors`
 * picks the twist arbitrarily, which is invisible on cylindrical limbs.
 */
function solveArm(
  shoulder: Object3D,
  elbow: Object3D,
  target: Vector3,
  pole: Vector3,
  upper: number,
  fore: number,
): void {
  ikTo.copy(target).sub(shoulder.position)
  // Never quite full reach: a perfectly straight arm loses its elbow and reads
  // as a rod, and the solver's bend axis degenerates besides.
  const distance = Math.min(Math.max(ikTo.length(), 0.1), (upper + fore) * 0.985)
  ikDir.copy(ikTo).normalize()

  // Interior angle at the shoulder, between the reach line and the upper arm.
  const cosAlpha = Math.min(
    1,
    Math.max(-1, (upper * upper + distance * distance - fore * fore) / (2 * upper * distance)),
  )
  const alpha = Math.acos(cosAlpha)

  // Rotating the reach line toward the pole by that angle gives the upper-arm
  // direction with the elbow displaced to the pole's side.
  ikAxis.copy(ikDir).cross(pole)
  if (ikAxis.lengthSq() < 1e-6) ikAxis.set(-ikDir.y, ikDir.x, 0)
  if (ikAxis.lengthSq() < 1e-6) ikAxis.set(1, 0, 0)
  ikAxis.normalize()
  ikQuatA.setFromAxisAngle(ikAxis, alpha)
  ikDir.applyQuaternion(ikQuatA)

  ikQuatA.setFromUnitVectors(DOWN, ikDir)
  shoulder.quaternion.copy(ikQuatA)

  // The forearm runs from the elbow to the hand; the elbow's LOCAL rotation is
  // the difference between the two world orientations.
  ikFore.copy(target).sub(shoulder.position).addScaledVector(ikDir, -upper).normalize()
  ikQuatB.setFromUnitVectors(DOWN, ikFore)
  elbow.quaternion.copy(ikQuatA.invert().multiply(ikQuatB))
}

/* ------------------------------------------------------------------ *
 *  The commander's proportions and palette
 * ------------------------------------------------------------------ */

/** Slate armour with gold trim: neither one blends into any of the five terrains. */
const ARMOUR_COLOUR = 0x38455a
const TRIM_COLOUR = 0xf0b429
/** The tunic and cape under the plate. Warmer and darker than the armour. */
const CLOTH_COLOUR = 0x7a2f2a
/** The sliver of face under the helmet. Any face detail would be wasted pixels. */
const SKIN_COLOUR = 0xd9a066
const GUN_METAL = 0x232a36
const GUN_WOOD = 0x6e4a2f

/** Radians the torso tips into a sprint. Enough to read; not enough to obscure. */
const SPRINT_LEAN = 0.19

/** How close to the floor the hips drop mid-roll. */
const ROLL_HIP_HEIGHT = 0.62

// The skeleton, in rig space (origin at the hip, 0.9 above the feet). These
// have to sum: hip height = thigh + shin + ankle slab, or the boots either
// hover or plunge through the floor.
const HIP = ACTOR_HEIGHT * 0.5
const HIP_X = 0.17
const THIGH_LEN = 0.42
const SHIN_LEN = 0.44
const ANKLE = HIP - THIGH_LEN - SHIN_LEN
/** The torso group sits just above the hip; everything upstairs is local to it. */
const TORSO_LIFT = 0.06
const SHOULDER_X = 0.27
const SHOULDER_Y = 0.46
const UPPER_ARM = 0.34
const FORE_ARM = 0.32
const HEAD_Y = 0.64

/** Seconds a melee swing takes to travel its arc. */
const SWING_TIME = 0.34
/** Seconds the recoil pose takes to recover after a shot. */
const KICK_TIME = 0.11

/* ------------------------------------------------------------------ *
 *  The guns
 * ------------------------------------------------------------------ */

/** Everything the renderer knows about the player's weapon. */
type GunView = ArenaView['gun']

/**
 * The eight silhouettes a weapon can wear.
 *
 * Classification is mechanical, never by id: a new weapon added to `src/data`
 * lands on whichever silhouette its behaviour implies, and gets a sensible
 * model for free. The tests run in a fixed order because the traits overlap —
 * the catapult has gravity AND splash, and must read as a launcher, not a bow.
 */
type GunClass =
  | 'axe'
  | 'bow'
  | 'launcher'
  | 'energy'
  | 'musket'
  | 'sniper'
  | 'carbine'
  | 'pistol'
  | 'rifle'

function classifyGun(gun: GunView): GunClass {
  if (gun.melee) return 'axe'
  // A round that drops but does not burst is an arrow. The lobbed shell also
  // drops, which is why splash is checked inside this test and again below.
  if (gun.gravity > 0 && gun.splash === 0) return 'bow'
  if (gun.splash > 0) return 'launcher'
  if (gun.overheat) return 'energy'
  if (gun.pellets > 1) return 'musket'
  // A gun that halves the field of view is being aimed through glass.
  if (gun.adsZoom <= 0.6) return 'sniper'
  if (gun.automatic) return 'carbine'
  // What is left is a plain trigger-per-shot firearm. A gun that barely zooms
  // is fired off the hip — a pistol; one that zooms properly is shouldered — a
  // rifle. The view exposes no barrel length, so the zoom IS the length.
  return gun.adsZoom > 0.8 ? 'pistol' : 'rifle'
}

/**
 * Where the string hand sits on a bow, and the parts the draw animates.
 * Kept nullable rather than optional so `exactOptionalPropertyTypes` never
 * meets an `undefined` assignment.
 */
interface BowParts {
  readonly stringTop: Mesh
  readonly stringBottom: Mesh
  readonly arrow: Mesh
  readonly tipTop: Vector3
  readonly tipBottom: Vector3
  readonly nockRest: Vector3
  readonly nockDrawn: Vector3
}

/**
 * A built weapon: the meshes, plus every point the rig needs to hold and fire
 * it. All vectors are in the spaces the per-frame code uses them in — grips in
 * weapon space, anchors in torso space — so posing never converts anything.
 */
interface BuiltGun {
  readonly kind: GunClass
  readonly weapon: Group
  /** Where the round leaves, in weapon space. The one point fx trusts. */
  readonly muzzleLocal: Vector3
  /** Right hand on the grip, left hand on the support, in weapon space. */
  readonly gripR: Vector3
  readonly gripL: Vector3
  /** Where the left hand goes mid-reload, in weapon space. */
  readonly magazineLocal: Vector3
  /** Where the weapon mount sits relative to the torso, hip-fired and aimed. */
  readonly hipAnchor: Vector3
  readonly adsAnchor: Vector3
  /** Elbow directions for each arm in each stance. ADS lifts the off elbow. */
  readonly poleRHip: Vector3
  readonly poleRAds: Vector3
  readonly poleLHip: Vector3
  readonly poleLAds: Vector3
  /** Extra recoil throw, because a launcher should not kick like a pistol. */
  readonly kickScale: number
  /** Energy cells to pulse, or null for guns with nothing to glow. */
  readonly glow: MeshBasicMaterial | null
  readonly bow: BowParts | null
}

interface GunMaterials {
  readonly metal: MeshLambertMaterial
  readonly wood: MeshLambertMaterial
  readonly trim: MeshLambertMaterial
}

/** One shaped, placed box/cylinder/cone: the whole vocabulary of a gun model. */
function part(
  parent: Group,
  geometry: BufferGeometry,
  material: MeshLambertMaterial | MeshBasicMaterial,
  sx: number,
  sy: number,
  sz: number,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
): Mesh {
  const mesh = new Mesh(geometry, material)
  mesh.scale.set(sx, sy, sz)
  mesh.position.set(x, y, z)
  mesh.rotation.set(rx, ry, rz)
  parent.add(mesh)
  return mesh
}

/**
 * Builds the weapon model for a mechanical class.
 *
 * Geometry conventions: the weapon group's origin is the main grip, forward is
 * -Z (the way the commander faces), and every mesh is a scaled unit shape from
 * the caller's shared set. Each builder registers its true barrel end in
 * `muzzleLocal`; that point, pushed through the weapon's world matrix, is what
 * the muzzle flash and tracers come off.
 */
function buildGun(
  kind: GunClass,
  materials: GunMaterials,
  box: BufferGeometry,
  cylY: BufferGeometry,
  cylZ: BufferGeometry,
  coneZ: BufferGeometry,
): BuiltGun {
  const weapon = new Group()
  const { metal, wood, trim } = materials

  // The defaults describe a shouldered two-handed long gun; each branch below
  // overwrites what its silhouette needs. Vectors are cloned per gun because
  // the per-frame code lerps toward them and must never share storage.
  const muzzleLocal = new Vector3(0, 0.02, -0.6)
  const gripR = new Vector3(0, -0.05, 0.05)
  const gripL = new Vector3(0, -0.03, -0.32)
  const magazineLocal = new Vector3(0, -0.15, -0.04)
  const hipAnchor = new Vector3(0.2, 0.3, -0.08)
  const adsAnchor = new Vector3(0.1, 0.4, -0.05)
  const poleRHip = new Vector3(1, -0.4, -0.2)
  const poleRAds = new Vector3(1, -0.1, -0.3)
  const poleLHip = new Vector3(-1, -0.6, -0.3)
  const poleLAds = new Vector3(-0.9, 0.9, -0.2)
  let kickScale = 1
  let glow: MeshBasicMaterial | null = null
  let bow: BowParts | null = null

  switch (kind) {
    case 'axe': {
      // A hafted axe, held across the body. The haft runs along local Y so the
      // swing arc can simply yaw the whole group through the target.
      part(weapon, cylY, wood, 0.05, 1.05, 0.05, 0, 0.1, 0)
      // The head: a broad flat blade, a spine block, and a counter-spike.
      part(weapon, box, metal, 0.045, 0.3, 0.34, 0.02, 0.42, -0.2, 0, 0, 0)
      part(weapon, box, metal, 0.07, 0.14, 0.14, 0, 0.42, -0.02)
      part(weapon, box, metal, 0.05, 0.08, 0.16, 0, 0.42, 0.12, 0.5, 0, 0)
      // A gold collar under the head, because this is the hero's axe.
      part(weapon, cylY, trim, 0.06, 0.06, 0.06, 0, 0.3, 0)
      muzzleLocal.set(0, 0.45, -0.3)
      gripR.set(0, -0.08, 0)
      gripL.set(0, -0.34, 0)
      magazineLocal.copy(gripL)
      hipAnchor.set(0.16, 0.26, -0.06)
      adsAnchor.set(0.12, 0.32, -0.1)
      poleLHip.set(-1, -0.3, -0.3)
      poleLAds.set(-1, 0.2, -0.4)
      kickScale = 0
      break
    }

    case 'bow': {
      // A genuinely curved stave: a torus arc, rotated so it bulges toward the
      // target and its tips point back at the archer. The arc is 1.9 radians —
      // enough curve to read as a bow at a glance, not so much it becomes a C.
      const stave = new TorusGeometry(0.55, 0.028, 8, 22, 1.9)
      stave.rotateZ(-0.95)
      stave.rotateY(Math.PI / 2)
      stave.translate(0, 0, 0.55)
      const staveMesh = new Mesh(stave, wood)
      weapon.add(staveMesh)
      // Gold caps on the tips, where a Persian recurve carries its horn.
      const tipTop = new Vector3(0, Math.sin(0.95) * 0.55, 0.55 - Math.cos(0.95) * 0.55)
      const tipBottom = new Vector3(0, -tipTop.y, tipTop.z)
      part(weapon, box, trim, 0.05, 0.07, 0.05, tipTop.x, tipTop.y, tipTop.z)
      part(weapon, box, trim, 0.05, 0.07, 0.05, tipBottom.x, tipBottom.y, tipBottom.z)
      // A leather grip wrap at the riser.
      part(weapon, cylY, metal, 0.045, 0.16, 0.045, 0, 0, 0)

      // The string is two thin cylinders that meet at the nock, re-aimed every
      // frame as the draw hand moves, so the string visibly bends with the pull.
      const stringTop = new Mesh(cylY, metal)
      const stringBottom = new Mesh(cylY, metal)
      weapon.add(stringTop, stringBottom)
      const arrow = new Mesh(cylZ, wood)
      arrow.scale.set(0.018, 0.018, 0.72)
      weapon.add(arrow)

      bow = {
        stringTop,
        stringBottom,
        arrow,
        tipTop,
        tipBottom,
        nockRest: new Vector3(0, 0, tipTop.z),
        nockDrawn: new Vector3(0, 0, tipTop.z + 0.3),
      }
      muzzleLocal.set(0, 0, -0.15)
      // The bow lives in the LEFT hand, extended toward the target; the right
      // hand rides the string, which the per-frame code moves with the draw.
      gripL.set(0, 0, 0.02)
      gripR.copy(bow.nockRest)
      magazineLocal.copy(bow.nockRest)
      hipAnchor.set(0.02, 0.32, -0.14)
      adsAnchor.set(-0.02, 0.38, -0.18)
      poleRHip.set(1, 0.2, 0.5)
      poleRAds.set(1, 0.4, 0.4)
      poleLHip.set(-1, 0.1, -0.2)
      poleLAds.set(-1, 0.3, -0.2)
      kickScale = 0.3
      break
    }

    case 'launcher': {
      // A fat shoulder tube. It rides ON the shoulder rather than in front of
      // the chest, which is the whole silhouette: nothing else on the field
      // carries its weapon above the collarbone.
      part(weapon, cylZ, metal, 0.22, 0.22, 0.95, 0, 0, -0.1)
      part(weapon, coneZ, metal, 0.3, 0.3, 0.22, 0, 0, -0.62)
      // Blast ring at the back — a launcher is open at both ends.
      part(weapon, cylZ, trim, 0.24, 0.24, 0.05, 0, 0, 0.38)
      // Top carry handle and the forward grip post.
      part(weapon, box, metal, 0.04, 0.1, 0.26, 0, 0.17, -0.05)
      part(weapon, cylY, metal, 0.035, 0.12, 0.035, 0, -0.16, -0.28)
      // Shoulder rest under the rear third.
      part(weapon, box, metal, 0.09, 0.05, 0.3, 0, -0.13, 0.16)
      muzzleLocal.set(0, 0, -0.72)
      gripR.set(0, -0.18, 0.12)
      gripL.set(0, -0.2, -0.28)
      magazineLocal.set(0, 0.06, 0.42)
      hipAnchor.set(0.15, 0.46, 0.08)
      adsAnchor.set(0.13, 0.5, 0.1)
      poleRHip.set(1, -0.5, 0.1)
      poleRAds.set(1, -0.4, 0)
      poleLHip.set(-0.7, 0.6, 0.2)
      poleLAds.set(-0.6, 0.8, 0.2)
      kickScale = 2.2
      break
    }

    case 'energy': {
      // Angular, finned, and lit from inside. The glow is a MeshBasicMaterial
      // because emissive surfaces must ignore the sun: a plasma cell is as
      // bright in fog at dusk as at noon, which is what "powered" looks like.
      glow = new MeshBasicMaterial({ color: 0x7df2ff })
      part(weapon, box, metal, 0.085, 0.13, 0.52, 0, 0.01, -0.1)
      part(weapon, box, metal, 0.07, 0.09, 0.3, 0, 0.03, -0.48, 0.06, 0, 0)
      // Three core cells along the spine, and a muzzle jewel.
      part(weapon, box, glow, 0.095, 0.05, 0.07, 0, 0.045, -0.02)
      part(weapon, box, glow, 0.095, 0.05, 0.07, 0, 0.045, -0.14)
      part(weapon, box, glow, 0.095, 0.05, 0.07, 0, 0.045, -0.26)
      part(weapon, box, glow, 0.05, 0.05, 0.05, 0, 0.03, -0.64)
      // Vent fins flare off both sides of the receiver.
      part(weapon, box, metal, 0.02, 0.1, 0.2, 0.06, 0.06, -0.3, 0, 0, 0.5)
      part(weapon, box, metal, 0.02, 0.1, 0.2, -0.06, 0.06, -0.3, 0, 0, -0.5)
      part(weapon, box, metal, 0.06, 0.16, 0.1, 0, -0.1, 0.06, 0.3, 0, 0)
      muzzleLocal.set(0, 0.03, -0.68)
      gripL.set(0, -0.05, -0.3)
      magazineLocal.set(0.06, -0.02, -0.14)
      break
    }

    case 'musket': {
      // Long, wooden, and flared: the blunderbuss mouth is what says "a cloud
      // of shot comes out of this", before the first trigger pull proves it.
      part(weapon, box, wood, 0.07, 0.14, 0.5, 0, -0.04, 0.12, 0.08, 0, 0)
      part(weapon, box, wood, 0.06, 0.09, 0.55, 0, -0.02, -0.35)
      part(weapon, cylZ, metal, 0.055, 0.055, 0.85, 0, 0.03, -0.42)
      part(weapon, coneZ, metal, 0.12, 0.12, 0.16, 0, 0.03, -0.88)
      // The flintlock: a lock plate and a cocked hammer on the right side.
      part(weapon, box, metal, 0.03, 0.1, 0.14, 0.05, 0.02, 0.02)
      part(weapon, box, metal, 0.025, 0.09, 0.03, 0.05, 0.08, 0.04, -0.6, 0, 0)
      part(weapon, cylY, trim, 0.055, 0.03, 0.055, 0, 0.03, -0.6)
      muzzleLocal.set(0, 0.03, -0.94)
      gripL.set(0, -0.06, -0.34)
      kickScale = 1.6
      break
    }

    case 'sniper': {
      // All barrel. The scope tube with its two lens rings is the second read,
      // for anyone the length alone did not convince.
      part(weapon, box, wood, 0.07, 0.13, 0.34, 0, -0.03, 0.14, 0.08, 0, 0)
      part(weapon, box, metal, 0.075, 0.09, 0.3, 0, 0.02, -0.12)
      part(weapon, cylZ, metal, 0.04, 0.04, 1.05, 0, 0.03, -0.6)
      part(weapon, box, metal, 0.03, 0.02, 0.08, 0, -0.02, -1.06)
      part(weapon, cylZ, metal, 0.045, 0.045, 0.26, 0, 0.11, -0.1)
      part(weapon, cylZ, trim, 0.06, 0.06, 0.035, 0, 0.11, -0.22)
      part(weapon, cylZ, trim, 0.06, 0.06, 0.035, 0, 0.11, 0.02)
      muzzleLocal.set(0, 0.03, -1.12)
      gripL.set(0, -0.04, -0.36)
      kickScale = 1.8
      break
    }

    case 'carbine': {
      // Compact and cluttered: receiver, angled magazine, front grip, stubby
      // barrel. Clutter IS the automatic's silhouette — everything the sniper's
      // clean line is not.
      part(weapon, box, metal, 0.08, 0.12, 0.4, 0, 0, -0.02)
      part(weapon, box, metal, 0.06, 0.09, 0.2, 0, -0.02, 0.22)
      part(weapon, cylZ, metal, 0.035, 0.035, 0.3, 0, 0.02, -0.36)
      part(weapon, box, metal, 0.055, 0.22, 0.09, 0, -0.14, -0.02, 0.35, 0, 0)
      part(weapon, cylY, metal, 0.03, 0.12, 0.03, 0, -0.1, -0.24)
      part(weapon, box, metal, 0.02, 0.05, 0.03, 0, 0.09, -0.3)
      part(weapon, box, trim, 0.085, 0.03, 0.08, 0, 0.07, 0.08)
      muzzleLocal.set(0, 0.02, -0.52)
      gripL.set(0, -0.1, -0.24)
      break
    }

    case 'pistol': {
      // Short, high, one-handed. The left hand cups the right wrist instead of
      // a fore-end — the pose, as much as the length, is what says "pistol".
      part(weapon, box, metal, 0.055, 0.08, 0.3, 0, 0.02, -0.06)
      part(weapon, box, metal, 0.05, 0.16, 0.07, 0, -0.08, 0.06, 0.25, 0, 0)
      part(weapon, cylZ, metal, 0.025, 0.025, 0.1, 0, 0.03, -0.24)
      part(weapon, box, trim, 0.02, 0.03, 0.03, 0, 0.07, 0.06)
      muzzleLocal.set(0, 0.03, -0.3)
      gripR.set(0, -0.08, 0.05)
      // The support point is the shooter's own wrist, just behind the grip.
      gripL.set(0.02, -0.12, 0.14)
      magazineLocal.set(0, -0.2, 0.06)
      hipAnchor.set(0.2, 0.34, -0.12)
      adsAnchor.set(0.08, 0.42, -0.1)
      kickScale = 0.8
      break
    }

    case 'rifle': {
      // The full-stock service rifle: one wooden line from butt to fore-end,
      // longer in the barrel than the carbine and cleaner along the top.
      part(weapon, box, wood, 0.07, 0.13, 0.42, 0, -0.03, 0.16, 0.07, 0, 0)
      part(weapon, box, wood, 0.065, 0.08, 0.45, 0, -0.01, -0.24)
      part(weapon, box, metal, 0.075, 0.08, 0.24, 0, 0.03, -0.04)
      part(weapon, cylZ, metal, 0.032, 0.032, 0.6, 0, 0.035, -0.62)
      // Bolt handle on the right, iron sight nub at the muzzle.
      part(weapon, cylY, metal, 0.025, 0.08, 0.025, 0.06, 0.03, 0.0, 0, 0, 1.2)
      part(weapon, box, metal, 0.015, 0.04, 0.02, 0, 0.08, -0.86)
      part(weapon, cylZ, trim, 0.045, 0.045, 0.03, 0, 0.035, -0.32)
      muzzleLocal.set(0, 0.035, -0.92)
      gripL.set(0, -0.05, -0.32)
      kickScale = 1.2
      break
    }
  }

  return {
    kind,
    weapon,
    muzzleLocal,
    gripR,
    gripL,
    magazineLocal,
    hipAnchor,
    adsAnchor,
    poleRHip,
    poleRAds,
    poleLHip,
    poleLAds,
    kickScale,
    glow,
    bow,
  }
}

/* ------------------------------------------------------------------ *
 *  The commander
 * ------------------------------------------------------------------ */

export interface Commander {
  readonly group: Group
  /**
   * Writes the world position of the gun's muzzle into `target` and returns it.
   *
   * The simulation's `muzzle` event carries the aim ray's origin, which sits on
   * the commander's centre line; the flash has to come off the actual barrel or
   * it looks like the player is firing out of their chest. The point registered
   * by each gun builder is the true barrel end, pushed through the weapon's
   * live world matrix, so it tracks the ADS raise, the reload dip and the
   * recoil kick frame by frame.
   */
  muzzle(target: Vector3): Vector3
  /**
   * @param gun the weapon the player brought. The model is built from it on the
   *            first call — the loadout cannot change mid-fight — and memoised.
   */
  apply(player: PlayerView, gun: GunView, dt: number, elapsed: number, reducedMotion: boolean): void
}

export function createCommander(heroEmoji: string): Commander {
  const group = new Group()

  // Everything below hangs off `rig`, whose origin is the commander's HIP, not
  // their feet. That is what lets the dodge roll tumble about the body's centre
  // instead of pivoting around the heels like a felled tree.
  const rig = new Group()
  rig.rotation.order = 'YXZ'
  group.add(rig)

  /* --- Materials --------------------------------------------------- */

  const armour = new MeshLambertMaterial({ color: ARMOUR_COLOUR })
  const trim = new MeshLambertMaterial({ color: TRIM_COLOUR })
  // The cape must be double-sided: the camera lives behind it, but a tumble
  // shows its front, and a one-sided quad would blink out of existence.
  const cloth = new MeshLambertMaterial({ color: CLOTH_COLOUR, side: DoubleSide })
  const skin = new MeshLambertMaterial({ color: SKIN_COLOUR })
  const gunMetal = new MeshLambertMaterial({ color: GUN_METAL })
  const gunWood = new MeshLambertMaterial({ color: GUN_WOOD })
  // Hurt flashes and i-frame strobes tint the whole figure, weapon included,
  // through this list. It is mutable state only in the sense that the emissive
  // channel is rewritten each frame.
  const tintable: readonly MeshLambertMaterial[] = [armour, trim, cloth, skin, gunMetal, gunWood]

  /* --- Shared unit geometry ---------------------------------------- */

  // One unit shape per primitive for the whole rig; every part is a scaled
  // instance. Dispose is idempotent, so the scene walker freeing these once
  // per mesh costs nothing.
  const box = new BoxGeometry(1, 1, 1)
  const sphere = new SphereGeometry(1, 12, 10)
  const cylY = new CylinderGeometry(0.5, 0.5, 1, 10)
  const cylZ = new CylinderGeometry(0.5, 0.5, 1, 10).rotateX(Math.PI / 2)
  // Cones point +Y from the factory; rotated so the wide end faces -Z they
  // become muzzle flares.
  const coneZ = new ConeGeometry(0.5, 1, 10).rotateX(Math.PI / 2)
  // Cape panels pivot at their top edge, so a single X rotation swings them.
  const capeQuad = new PlaneGeometry(1, 1).translate(0, -0.5, 0)

  /* --- Legs -------------------------------------------------------- */

  function buildLeg(side: number): { hip: Group; knee: Group } {
    const hipJoint = new Group()
    hipJoint.position.set(side * HIP_X, -0.02, 0)
    rig.add(hipJoint)

    const thigh = new Mesh(cylY, armour)
    thigh.scale.set(0.13, THIGH_LEN, 0.13)
    thigh.position.y = -THIGH_LEN / 2
    hipJoint.add(thigh)

    const knee = new Group()
    knee.position.y = -THIGH_LEN
    hipJoint.add(knee)

    const shin = new Mesh(cylY, cloth)
    shin.scale.set(0.105, SHIN_LEN, 0.105)
    shin.position.y = -SHIN_LEN / 2
    knee.add(shin)

    // The boot: a slab that reaches forward, because feet point -Z.
    const boot = new Mesh(box, gunMetal)
    boot.scale.set(0.13, ANKLE * 2, 0.24)
    boot.position.set(0, -SHIN_LEN - ANKLE * 0.5, -0.04)
    knee.add(boot)

    return { hip: hipJoint, knee }
  }

  const legL = buildLeg(-1)
  const legR = buildLeg(1)

  const pelvis = new Mesh(box, cloth)
  pelvis.scale.set(0.4, 0.16, 0.26)
  rig.add(pelvis)

  /* --- Torso -------------------------------------------------------- */

  const torso = new Group()
  torso.position.y = TORSO_LIFT
  rig.add(torso)

  // Layered, not one box: a tunic underneath, a chest plate over it, and a
  // gold girdle where they meet. The plate is deliberately a little proud of
  // the tunic so the layering reads even in silhouette.
  const tunic = new Mesh(box, cloth)
  tunic.scale.set(0.44, 0.44, 0.3)
  tunic.position.y = 0.2
  torso.add(tunic)

  const chest = new Mesh(box, armour)
  chest.scale.set(0.5, 0.3, 0.36)
  chest.position.y = 0.34
  torso.add(chest)

  const girdle = new Mesh(box, trim)
  girdle.scale.set(0.46, 0.07, 0.32)
  girdle.position.y = 0.02
  torso.add(girdle)

  const pauldronL = new Mesh(sphere, armour)
  pauldronL.scale.set(0.13, 0.1, 0.14)
  pauldronL.position.set(-SHOULDER_X - 0.04, SHOULDER_Y + 0.03, 0)
  const pauldronR = new Mesh(sphere, armour)
  pauldronR.scale.copy(pauldronL.scale)
  pauldronR.position.set(SHOULDER_X + 0.04, SHOULDER_Y + 0.03, 0)
  torso.add(pauldronL, pauldronR)

  // The pack rides between the cape panels and carries the hero's badge — the
  // first thing the over-the-shoulder camera sees.
  const pack = new Mesh(box, trim)
  pack.scale.set(0.32, 0.34, 0.13)
  pack.position.set(0, 0.3, 0.21)
  torso.add(pack)

  // The commander faces -Z, so their back faces +Z — straight at the camera.
  // A plane's front face is +Z already, so the badge needs no rotation.
  const badge = new Mesh(
    new PlaneGeometry(0.3, 0.3),
    new MeshBasicMaterial({ map: emojiTexture(heroEmoji), transparent: true, depthWrite: false }),
  )
  badge.position.set(0, 0.31, 0.28)
  torso.add(badge)

  // Two cape panels flanking the pack. Panels, not one sheet, so the badge
  // stays visible between them and each can flutter on its own phase.
  const capeL = new Mesh(capeQuad, cloth)
  capeL.scale.set(0.2, 0.58, 1)
  capeL.position.set(-0.16, 0.44, 0.17)
  const capeR = new Mesh(capeQuad, cloth)
  capeR.scale.copy(capeL.scale)
  capeR.position.set(0.16, 0.44, 0.17)
  torso.add(capeL, capeR)

  /* --- Head --------------------------------------------------------- */

  const head = new Group()
  head.position.y = HEAD_Y
  torso.add(head)

  // The face is a sliver of skin under the helmet's brow — set forward and
  // low, so the gap between dome and band reads as a face without one drawn.
  const face = new Mesh(sphere, skin)
  face.scale.setScalar(0.125)
  face.position.set(0, -0.01, -0.045)
  head.add(face)

  const helmet = new Mesh(sphere, armour)
  helmet.scale.set(0.16, 0.155, 0.165)
  helmet.position.set(0, 0.05, 0.01)
  head.add(helmet)

  // The crest: a ridge running front-to-back over the dome, the Persian
  // profile that separates the hero from every helmeted enemy on the field.
  const crest = new Mesh(box, trim)
  crest.scale.set(0.045, 0.12, 0.3)
  crest.position.set(0, 0.17, 0.01)
  crest.rotation.x = -0.12
  head.add(crest)

  const band = new Mesh(cylY, trim)
  band.scale.set(0.34, 0.05, 0.35)
  band.position.set(0, -0.02, 0.01)
  head.add(band)

  /* --- Arms --------------------------------------------------------- */

  function buildArm(side: number): { shoulder: Group; elbow: Group } {
    const shoulder = new Group()
    shoulder.position.set(side * SHOULDER_X, SHOULDER_Y, 0)
    torso.add(shoulder)

    const upper = new Mesh(cylY, armour)
    upper.scale.set(0.1, UPPER_ARM, 0.1)
    upper.position.y = -UPPER_ARM / 2
    shoulder.add(upper)

    const elbow = new Group()
    elbow.position.y = -UPPER_ARM
    shoulder.add(elbow)

    const fore = new Mesh(cylY, cloth)
    fore.scale.set(0.085, FORE_ARM, 0.085)
    fore.position.y = -FORE_ARM / 2
    elbow.add(fore)

    const hand = new Mesh(sphere, skin)
    hand.scale.setScalar(0.055)
    hand.position.y = -FORE_ARM
    elbow.add(hand)

    return { shoulder, elbow }
  }

  const armL = buildArm(-1)
  const armR = buildArm(1)

  /* --- The weapon mount --------------------------------------------- */

  // The gun hangs off `aim`, and both arms are solved to reach it. Posing one
  // group is what keeps ADS, reloads, recoil and the melee swing coherent: the
  // weapon moves, and the hands follow because they are solved onto it.
  const aim = new Group()
  torso.add(aim)

  /** Built on the first apply; the loadout cannot change mid-fight. */
  let built: BuiltGun | null = null

  /* --- Blob shadow --------------------------------------------------- */

  // A sibling of the rig rather than a child, because it must stay flat on the
  // floor while the body above it leans, flinches and tumbles. Same trick the
  // 2D scene used, and the reason we can skip shadow maps on a phone.
  const shadow = new Mesh(
    new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({
      map: radialTexture(),
      color: 0x000000,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    }),
  )
  group.add(shadow)

  /* --- Per-fight animation state ------------------------------------ */

  let deathTime = 0
  /** Stride phase, advanced by distance covered so steps match the ground. */
  let stridePhase = 0
  /** Boolean `sprinting` eased into 0..1 so the lean never snaps. */
  let sprintEase = 0
  /** Last frame's recoil, to detect the rising edge that means "a shot". */
  let lastRecoil = 0
  /** 1 at the instant of a shot, decaying over KICK_TIME. The visual punch. */
  let fireKick = 0
  /** Seconds left of the melee swing arc. */
  let swingLeft = 0
  /** Alternates each swing so the axe goes forehand, backhand, forehand. */
  let swingSign = 1
  /** The reload's full duration, learned from the first frame of `reloadLeft`. */
  let reloadPeak = 0
  /** Eased bow draw: snaps to 0 on release, eases back as the next arrow nocks. */
  let stringEase = 1
  /** Cape lift eased separately from speed so it settles like fabric. */
  let capeLift = 0

  const glowBase = new Color(0x7df2ff)
  const glowHot = new Color(0xffd27a)

  /** Re-aims one string segment from a stave tip to the nock, in weapon space. */
  function layString(segment: Mesh, tip: Vector3, nock: Vector3): void {
    stringVec.copy(nock).sub(tip)
    const length = Math.max(stringVec.length(), 1e-3)
    segment.scale.set(0.012, length, 0.012)
    segment.position.copy(tip).addScaledVector(stringVec, 0.5)
    stringVec.divideScalar(length)
    segment.quaternion.setFromUnitVectors(DOWN, stringVec)
  }

  return {
    group,

    muzzle(target) {
      if (built) {
        // The weapon's ancestors were all posed by this frame's `apply`, so one
        // upward matrix refresh gives the live barrel end — through the ADS
        // raise, the reload dip and the recoil kick, never the chest.
        built.weapon.updateWorldMatrix(true, false)
        return target.copy(built.muzzleLocal).applyMatrix4(built.weapon.matrixWorld)
      }
      // No gun yet (nothing has been applied): fall back to the spec height on
      // the centre line, which is where the simulation says shots originate.
      return target.copy(rig.position).setY(MUZZLE_HEIGHT)
    },

    apply(player, gun, dt, elapsed, reducedMotion) {
      /* --- First contact with the loadout -------------------------- */

      if (!built) {
        built = buildGun(classifyGun(gun), { metal: gunMetal, wood: gunWood, trim }, box, cylY, cylZ, coneZ)
        aim.add(built.weapon)
      }
      const rig2 = built

      /* --- Edges and timers ----------------------------------------- */

      // The simulation adds recoil the instant a shot fires and decays it
      // smoothly, so a rise between frames is exactly one trigger pull. That
      // one bit of information drives the gun kick, the melee swing and the
      // bowstring release without the view growing an event for it.
      if (player.recoilKick > lastRecoil + 1e-5) {
        fireKick = 1
        stringEase = 0
        if (rig2.kind === 'axe') {
          swingLeft = SWING_TIME
          swingSign = -swingSign
        }
      }
      lastRecoil = player.recoilKick
      fireKick = Math.max(0, fireKick - dt / KICK_TIME)
      swingLeft = Math.max(0, swingLeft - dt)

      // `reloadLeft` only counts down; its first value each reload is the full
      // duration, remembered so the gesture can be phrased in 0..1.
      if (player.reloadLeft > reloadPeak) reloadPeak = player.reloadLeft
      if (player.reloadLeft <= 0) reloadPeak = 0
      const reload = reloadPeak > 0 ? 1 - player.reloadLeft / reloadPeak : 0
      const reloading = player.reloadLeft > 0

      sprintEase += ((player.sprinting ? 1 : 0) - sprintEase) * Math.min(1, dt * 9)

      const rolling = player.rollLeft > 0
      const rollProgress = rolling ? 1 - Math.min(1, player.rollLeft / ROLL_TIME) : 0
      deathTime = player.alive ? 0 : deathTime + dt

      /* --- Ground speed and the stride ------------------------------ */

      const speed = Math.hypot(player.vel.x, player.vel.z)
      const stride = clamp01(speed / FULL_STRIDE_SPEED)
      // Phase advances with distance covered, not with time, so the legs
      // physically match the ground going by at any speed — walk, ADS shuffle
      // or sprint — and stop dead when the player does.
      if (player.alive && !rolling) stridePhase += speed * dt * STRIDE_RATE
      const gait = Math.sin(stridePhase)

      /* --- Where the hips are ---------------------------------------- */

      const rollDip = rolling ? Math.sin(rollProgress * Math.PI) : 0
      const fall = Math.min(1, deathTime / DEATH_TIME)
      // The body rises a touch at each stride's passing point. Frozen for
      // reduced motion, where a bobbing camera-anchor is what makes people ill.
      const bob = reducedMotion || rolling || !player.alive ? 0 : Math.abs(Math.cos(stridePhase)) * 0.045 * stride

      rig.position.set(
        player.pos.x,
        player.y + (HIP - rollDip * (HIP - ROLL_HIP_HEIGHT)) * (1 - fall * 0.55) + bob,
        player.pos.z,
      )

      /* --- Which way the rig is facing ------------------------------- */

      if (rolling) {
        // A real tumble, not a spin: one full turn about the horizontal axis
        // perpendicular to the roll direction, over the roll's whole duration.
        scratchAxis.set(player.rollDir.z, 0, -player.rollDir.x)
        if (scratchAxis.lengthSq() < 1e-6) scratchAxis.set(1, 0, 0)
        scratchAxis.normalize()
        scratchTumble.setFromAxisAngle(scratchAxis, rollProgress * Math.PI * 2)
        scratchEuler.set(0, player.yaw, 0)
        scratchQuaternion.setFromEuler(scratchEuler)
        // World-space tumble on the left, body yaw on the right: the commander
        // keeps looking where they were aiming while the body goes over.
        rig.quaternion.copy(scratchTumble).multiply(scratchQuaternion)
      } else {
        // The rig itself only yaws and dies; leaning, flinching and twisting
        // all happen at the torso so the legs stay planted under them.
        scratchEuler.set(fall * 1.45, player.yaw, 0)
        rig.quaternion.setFromEuler(scratchEuler)
      }

      /* --- Legs ------------------------------------------------------ */

      // The tuck is what separates "a roll" from "a statue rotating": knees
      // fold to the chest over the middle of the tumble and open back out.
      // Positive X rotation swings a hanging limb FORWARD, so thighs tuck with
      // positive rotation and knees — which only ever bend backward — with
      // negative. These two signs are the difference between legs and bird legs.
      const tuck = rollDip
      const legSwing = gait * (0.5 + 0.3 * sprintEase) * stride
      legL.hip.rotation.x = -legSwing + tuck * 1.35
      legR.hip.rotation.x = legSwing + tuck * 1.35
      // Each knee bends hardest as its own leg swings back — the half of the
      // cycle a real knee folds through.
      legL.knee.rotation.x = -(0.12 + Math.max(0, gait) * 0.85 * stride) - tuck * 2.1
      legR.knee.rotation.x = -(0.12 + Math.max(0, -gait) * 0.85 * stride) - tuck * 2.1

      /* --- Torso ------------------------------------------------------ */

      const flinch = player.hurt > 0 ? Math.min(1, player.hurt / 0.3) : 0
      const ads = player.ads
      // Leaning into a sprint means pitching toward -Z, which is a NEGATIVE
      // rotation about X. Getting this sign wrong makes them run backwards.
      torso.rotation.x =
        -(SPRINT_LEAN * sprintEase + 0.05) + flinch * 0.34 + player.pitch * 0.1 * (1 - sprintEase)
      // ADS blades the chest behind the gun; hip fire stands more open. A hit
      // twists the shoulders the way the old rig used to twist the whole body.
      torso.rotation.y = -0.16 * ads + 0.08 * (1 - ads)
      torso.rotation.z = flinch * 0.16
      // A slow breath while standing still, so an idle commander is not a
      // freeze-frame. Gated exactly like the bob.
      torso.position.y =
        TORSO_LIFT + (reducedMotion || stride > 0.05 ? 0 : Math.sin(elapsed * 1.8) * 0.008)

      /* --- Head -------------------------------------------------------- */

      // The head carries the aim: it pitches with the look, and ADS tucks it
      // down and toward the stock, cheek to the gun.
      head.rotation.x = player.pitch * 0.55 - ads * 0.12 + tuck * 0.6
      head.rotation.y = -ads * 0.1
      head.rotation.z = -ads * 0.14

      /* --- The weapon mount -------------------------------------------- */

      aim.position.lerpVectors(rig2.hipAnchor, rig2.adsAnchor, ads)
      // The whole mount rides the aim pitch, so pointing up and down is visible
      // on the body, not just the camera. Sprinting swings the gun down out of
      // the way; a reload dips the muzzle while the hands work; recoil punches
      // the mount up and back for a few frames.
      const kick = fireKick * fireKick * rig2.kickScale
      aim.rotation.x =
        player.pitch * (0.7 + 0.3 * ads) -
        sprintEase * (1 - ads) * 0.85 +
        kick * 0.12 -
        (reloading && rig2.kind !== 'bow' ? bell(reload) * 0.45 : 0) -
        tuck * 0.9
      aim.rotation.y = 0
      aim.rotation.z = 0

      /* --- The weapon itself ------------------------------------------- */

      const weapon = rig2.weapon
      weapon.position.set(0, 0, kick * 0.09)

      if (rig2.kind === 'axe') {
        if (swingLeft > 0) {
          // Ease-out arc: the blade leads and the follow-through trails. The
          // sign alternates per swing, forehand then backhand.
          const s = 1 - swingLeft / SWING_TIME
          const e = 1 - (1 - s) * (1 - s) * (1 - s)
          weapon.rotation.set(0.5 - e * 1.1, swingSign * (1.5 - e * 3), 0.1 * swingSign)
        } else {
          // Carried ready across the body; ADS raises it into a two-hand guard.
          weapon.rotation.set(0.4 - ads * 0.3, swingSign * 0.45, 0.12 * swingSign)
        }
      } else {
        weapon.rotation.set(0, 0, 0)
      }

      if (rig2.glow) {
        // The cells breathe faintly at rest and flare hot with fire. Basic
        // material, so "brightness" is just the colour itself scaled.
        const pulse = reducedMotion ? 0.15 : 0.15 * Math.sin(elapsed * 7) + fireKick * 0.9
        rig2.glow.color.lerpColors(glowBase, glowHot, clamp01(fireKick))
        rig2.glow.color.multiplyScalar(0.85 + clamp01(pulse) * 0.5)
      }

      /* --- Bowstring ---------------------------------------------------- */

      if (rig2.bow) {
        // For the bow, `reloadLeft` is the nocking of the next arrow, so the
        // draw hand walks the string back over exactly that window. Release
        // snaps to zero on the shot and the next draw eases in.
        const drawTarget = reloading ? reload : 1
        stringEase += (drawTarget - stringEase) * Math.min(1, dt * 10)
        nockScratch.lerpVectors(rig2.bow.nockRest, rig2.bow.nockDrawn, clamp01(stringEase))
        layString(rig2.bow.stringTop, rig2.bow.tipTop, nockScratch)
        layString(rig2.bow.stringBottom, rig2.bow.tipBottom, nockScratch)
        // The arrow rides the nock, and hides for the first half of the nock
        // gesture — the hand is still reaching for the quiver.
        rig2.bow.arrow.visible = stringEase > 0.15
        rig2.bow.arrow.position.set(0, 0, nockScratch.z - 0.34)
        // The right hand IS the string hand: its grip target is the live nock.
        rig2.gripR.copy(nockScratch)
      }

      /* --- Arms: solved onto the weapon ---------------------------------- */

      // Grip points go weapon space → torso space through the two live
      // transforms above them, then each arm is solved to reach its point.
      armTargetR.copy(rig2.gripR).applyQuaternion(weapon.quaternion).add(weapon.position)
      armTargetR.applyQuaternion(aim.quaternion).add(aim.position)

      if (reloading && rig2.bow === null && rig2.kind !== 'axe') {
        // The reload gesture: the left hand leaves the fore-end, drops to the
        // magazine, and comes back — out and back on the bell curve.
        poseVec.copy(rig2.gripL).lerp(rig2.magazineLocal, bell(reload))
      } else {
        poseVec.copy(rig2.gripL)
      }
      armTargetL.copy(poseVec).applyQuaternion(weapon.quaternion).add(weapon.position)
      armTargetL.applyQuaternion(aim.quaternion).add(aim.position)

      if (tuck > 0.01) {
        // Mid-roll both hands pull the weapon into the chest. The lerp weight
        // is the tuck itself, so the grip dissolves and reforms smoothly.
        armTargetR.lerp(poseVec.set(0.2, 0.12, -0.22), tuck)
        armTargetL.lerp(poseVec.set(-0.2, 0.12, -0.22), tuck)
      }

      poleScratch.lerpVectors(rig2.poleRHip, rig2.poleRAds, ads)
      solveArm(armR.shoulder, armR.elbow, armTargetR, poleScratch, UPPER_ARM, FORE_ARM)
      poleScratch.lerpVectors(rig2.poleLHip, rig2.poleLAds, ads)
      solveArm(armL.shoulder, armL.elbow, armTargetL, poleScratch, UPPER_ARM, FORE_ARM)

      /* --- Cape ----------------------------------------------------------- */

      // The cloth answers motion, not buttons: forward speed lifts it, and it
      // eases down like fabric when the commander stops. The flutter is two
      // incommensurate sines so the panels never march in step.
      const forwardSpeed = -(player.vel.x * Math.sin(player.yaw) + player.vel.z * Math.cos(player.yaw))
      const rightSpeed = player.vel.x * Math.cos(player.yaw) - player.vel.z * Math.sin(player.yaw)
      const liftTarget = clamp01(0.12 + Math.max(0, forwardSpeed) * 0.09 + speed * 0.02 + rollDip * 0.8)
      capeLift += (liftTarget - capeLift) * Math.min(1, dt * 8)
      const flutter = reducedMotion ? 0 : stride * 0.07
      capeL.rotation.x = capeLift * 1.15 + Math.sin(elapsed * 9.1) * flutter
      capeR.rotation.x = capeLift * 1.15 + Math.sin(elapsed * 7.7 + 1.3) * flutter
      // Strafing blows both panels the other way; the clamp keeps them off the
      // pauldrons at full sideways sprint.
      const sway = Math.max(-0.4, Math.min(0.4, -rightSpeed * 0.045))
      capeL.rotation.z = sway + 0.08
      capeR.rotation.z = sway - 0.08

      /* --- Skin -------------------------------------------------------------- */

      // I-frames strobe rather than fade: a half-transparent commander would
      // have to move to the transparent pass and start sorting against the
      // arena, and the strobe reads better anyway.
      const strobe =
        player.invulnerable > 0 && !reducedMotion ? 0.35 + Math.abs(Math.sin(elapsed * 26)) * 0.5 : 0
      const glow = Math.max(strobe, flinch * 0.8)
      for (const material of tintable) {
        material.emissive.copy(player.hurt > 0 ? TELL_LATE : HURT_GLOW)
        material.emissiveIntensity = glow
      }

      /* --- Contact shadow ------------------------------------------------------ */

      // The shadow stays on the ground and pulls in as the body leaves it —
      // the one cue that tells a phone-sized screen how high the jump is.
      const shadowSize =
        ACTOR_RADIUS * 5.4 * (1 - rollDip * 0.2) * (1 - fall * 0.4) * Math.max(0.45, 1 - player.y * 0.3)
      shadow.position.set(player.pos.x, 0.02, player.pos.z)
      shadow.scale.set(shadowSize, 1, shadowSize)
    },
  }
}

/* ------------------------------------------------------------------ *
 *  The enemies
 * ------------------------------------------------------------------ */

/**
 * What each of the four roles looks like.
 *
 * They have to be told apart in a glance, at range, in fog, so they differ in
 * SILHOUETTE first and colour second: the rusher is a low, bladed lope; the
 * gunner stands square behind a rifle; the heavy is a turtle-backed wall with
 * a tube on its shoulder; and the boss is the heavy's frame grown half again,
 * crowned, with a lit core in its chest. Palettes are terrain-agnostic — every
 * one of them has to pop against desert sand and forest shade alike.
 */
interface KindProfile {
  /** Body plate and accent colours. Identity lives in the accent. */
  readonly plate: number
  readonly accent: number
  /** Multiplier on ACTOR_HEIGHT. */
  readonly height: number
  /** Multiplier on ACTOR_RADIUS. */
  readonly girth: number
  /** Radians the torso is permanently hunched forward. */
  readonly hunch: number
  /** Stride phase per unit walked: high is a scurry, low is a stomp. */
  readonly stride: number
  /** Leg swing amplitude at full speed, in radians. */
  readonly legSwing: number
  /** Torso roll per step. The heavies wear their weight here. */
  readonly sway: number
  /** What the arms are doing: pumping blades, holding a rifle, or a mortar. */
  readonly arms: 'blades' | 'rifle' | 'mortar'
  /** Headgear: spikes for the rusher, a crown for the boss. */
  readonly crown: 'spikes' | 'antenna' | 'bolts' | 'crown'
  /** Whether the chest carries the emissive core. The boss's beacon. */
  readonly core: boolean
}

const KINDS: Record<ArenaViewEnemyKind, KindProfile> = {
  // Rust-red, lean, forward-hunched, all blades and knees. The fast one.
  rusher: {
    plate: 0x6b3226,
    accent: 0xe0512e,
    height: 0.95,
    girth: 0.72,
    hunch: 0.38,
    stride: 2.7,
    legSwing: 0.95,
    sway: 0.02,
    arms: 'blades',
    crown: 'spikes',
    core: false,
  },
  // Steel-blue and upright behind a rifle: dangerous while standing still.
  gunner: {
    plate: 0x365a75,
    accent: 0x6fb9e8,
    height: 1.0,
    girth: 0.95,
    hunch: 0.05,
    stride: 1.9,
    legSwing: 0.55,
    sway: 0.035,
    arms: 'rifle',
    crown: 'antenna',
    core: false,
  },
  // Gunmetal and bronze, twice a rusher's bulk, a mortar over one shoulder.
  heavy: {
    plate: 0x41454d,
    accent: 0xc98f3d,
    height: 1.02,
    girth: 1.45,
    hunch: 0.12,
    stride: 1.25,
    legSwing: 0.42,
    sway: 0.09,
    arms: 'mortar',
    crown: 'bolts',
    core: false,
  },
  // Squat, round and hazard-orange, hunched into a sprint, a fuse-antenna on
  // the skull and the payload glowing in the chest. Reads as "get away".
  bomber: {
    plate: 0x30241c,
    accent: 0xff9838,
    height: 0.82,
    girth: 1.15,
    hunch: 0.3,
    stride: 3.1,
    legSwing: 1.0,
    sway: 0.03,
    arms: 'blades',
    crown: 'antenna',
    core: true,
  },
  // Olive drab behind a rifle, bolts along the crown: the burst is the tell.
  volley: {
    plate: 0x4a5530,
    accent: 0xb7e34a,
    height: 0.98,
    girth: 0.9,
    hunch: 0.1,
    stride: 2.0,
    legSwing: 0.6,
    sway: 0.04,
    arms: 'rifle',
    crown: 'bolts',
    core: false,
  },
  // Tall, thin, pale violet, rifle raised: the silhouette says "somewhere far
  // away, something is already aiming".
  lancer: {
    plate: 0x5b4a6e,
    accent: 0xcfa9ff,
    height: 1.16,
    girth: 0.68,
    hunch: 0.02,
    stride: 1.6,
    legSwing: 0.5,
    sway: 0.05,
    arms: 'rifle',
    crown: 'antenna',
    core: false,
  },
  // Near-black and gold, half again as tall as the heavy, crowned and lit
  // from within. Unmistakable, which is the entire job.
  boss: {
    plate: 0x1a1620,
    accent: 0xf3c534,
    height: 1.5,
    girth: 1.6,
    hunch: 0.08,
    stride: 1.1,
    legSwing: 0.4,
    sway: 0.11,
    arms: 'mortar',
    crown: 'crown',
    core: true,
  },
}

/** The boss's chest light. Magenta, because nothing on any terrain is magenta. */
const CORE_COLOUR = new Color(0xff3df0)

/** One pooled body. Every field is written in place; none of it is reallocated. */
interface EnemySlot {
  readonly rig: Group
  readonly torso: Group
  readonly head: Group
  readonly hipL: Group
  readonly kneeL: Group
  readonly hipR: Group
  readonly kneeR: Group
  readonly shoulderL: Group
  readonly elbowL: Group
  readonly shoulderR: Group
  readonly elbowR: Group
  readonly weaponMount: Group
  readonly thighL: Mesh
  readonly shinL: Mesh
  readonly thighR: Mesh
  readonly shinR: Mesh
  readonly upperL: Mesh
  readonly foreL: Mesh
  readonly upperR: Mesh
  readonly foreR: Mesh
  readonly chest: Mesh
  readonly belly: Mesh
  readonly back: Mesh
  readonly pauldronL: Mesh
  readonly pauldronR: Mesh
  readonly skull: Mesh
  readonly helm: Mesh
  readonly crest: Mesh
  readonly hornL: Mesh
  readonly hornR: Mesh
  readonly weaponA: Mesh
  readonly weaponB: Mesh
  readonly core: Mesh
  readonly badge: Sprite
  readonly badgeMaterial: SpriteMaterial
  readonly pip: Group
  readonly pipFill: Mesh
  readonly pipFillMaterial: MeshBasicMaterial
  /** Per-slot so one enemy's hurt flash never lights up its whole kind. */
  readonly plate: MeshLambertMaterial
  readonly accent: MeshLambertMaterial
  readonly coreMaterial: MeshBasicMaterial
  /** The dress colours, kept so stagger tinting has something to lerp from. */
  readonly plateBase: Color
  readonly accentBase: Color
  /** Which enemy is currently living in this slot, or -1 for nobody. */
  id: number
  kind: ArenaViewEnemyKind | null
  emoji: string
  /** Seconds since this body stopped being alive. Drives the collapse. */
  deathTime: number
  /** Cached from the profile, so `apply` never touches the KINDS table. */
  height: number
  radius: number
  profile: KindProfile
  /** Finite-difference velocity state: the view gives position, not speed. */
  prevX: number
  prevZ: number
  speed: number
  /** Stride phase, seeded from the slot index so a squad never marches in step. */
  phase: number
}

export interface EnemyPool {
  readonly group: Group
  /**
   * @param cameraQuaternion orientation the health pips billboard themselves to.
   */
  apply(
    enemies: readonly EnemyView[],
    dt: number,
    cameraQuaternion: Quaternion,
    reducedMotion: boolean,
  ): void
  /**
   * Frees what the scene-graph walker cannot see: emoji textures that were
   * swapped off a billboard and are no longer hanging on any material.
   */
  dispose(): void
}

/** Half-width and height of the health pip, in world units. */
const PIP_WIDTH = 0.86
const PIP_HEIGHT = 0.1

export function createEnemyPool(): EnemyPool {
  const group = new Group()

  /*
   * One geometry per shape for the whole squad. Twelve articulated bodies
   * share eight BufferGeometries between them; every per-enemy and per-kind
   * difference is mesh scale, set once at dress time.
   */
  const box: BufferGeometry = new BoxGeometry(1, 1, 1)
  const sphere: BufferGeometry = new SphereGeometry(1, 12, 10)
  const cylY: BufferGeometry = new CylinderGeometry(0.5, 0.5, 1, 9)
  const cylZ: BufferGeometry = new CylinderGeometry(0.5, 0.5, 1, 9).rotateX(Math.PI / 2)
  const coneY: BufferGeometry = new ConeGeometry(0.5, 1, 8)
  const coneZ: BufferGeometry = new ConeGeometry(0.5, 1, 9).rotateX(Math.PI / 2)
  const quad: BufferGeometry = new PlaneGeometry(1, 1)
  const flatQuad: BufferGeometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  const ring: BufferGeometry = new RingGeometry(0.74, 1, 32).rotateX(-Math.PI / 2)

  const radial = radialTexture()

  /* --- Ground layers, instanced ---------------------------------- */

  // Shadows, tell pools and tell rings are three draw calls for the entire
  // squad rather than three per enemy. On a phone that is the whole margin.
  const shadows = new InstancedMesh(
    flatQuad,
    new MeshBasicMaterial({
      map: radial,
      color: 0x000000,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    }),
    ENEMY_POOL,
  )

  const tellPool = new InstancedMesh(
    flatQuad,
    new MeshBasicMaterial({
      map: radial,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      // The tell must not be dimmed by distance. It is the one thing on screen
      // that has to be as loud at thirty units as it is at five.
      fog: false,
    }),
    ENEMY_POOL,
  )

  const tellRing = new InstancedMesh(
    ring,
    new MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
    }),
    ENEMY_POOL,
  )

  for (const mesh of [shadows, tellPool, tellRing]) {
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    // Seeded black so `instanceColor` exists before the first frame asks for it,
    // and so an unused slot contributes nothing to an additive pass.
    for (let i = 0; i < ENEMY_POOL; i += 1) {
      mesh.setMatrixAt(i, scratchMatrix.makeScale(0, 0, 0))
      mesh.setColorAt(i, scratchColor.setRGB(0, 0, 0))
    }
    // Instances move every frame, so any bounding sphere computed here would be
    // stale by the next one. Twelve flat quads are not worth a per-frame bounds
    // rebuild, so the culler is simply told to leave them alone.
    mesh.frustumCulled = false
    group.add(mesh)
  }

  /* --- Shared body materials --------------------------------------- */

  // Every slot's boots, joints and weapons share one dark metal. It never
  // flashes or tints — which is fine, because it is trim, not identity — and
  // sharing it saves eleven materials.
  const darkMetal = new MeshLambertMaterial({ color: 0x22262e })

  const pipBack = new MeshBasicMaterial({
    color: 0x0b0f16,
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
    fog: false,
  })

  // Emoji are rasterised once per distinct glyph. A wave normally shares one,
  // so this is usually a single 128px texture for the entire fight.
  const emojiCache = new Map<string, Texture>()
  function emojiFor(emoji: string): Texture {
    const existing = emojiCache.get(emoji)
    if (existing) return existing
    const created = emojiTexture(emoji)
    emojiCache.set(emoji, created)
    return created
  }

  /* --- The pooled rigs ---------------------------------------------- */

  const slots: EnemySlot[] = []
  for (let i = 0; i < ENEMY_POOL; i += 1) {
    const rig = new Group()
    rig.rotation.order = 'YXZ'
    rig.visible = false
    group.add(rig)

    const plate = new MeshLambertMaterial({ color: 0xffffff })
    const accent = new MeshLambertMaterial({ color: 0xffffff })
    const coreMaterial = new MeshBasicMaterial({ color: CORE_COLOUR, fog: false })

    // Legs. The rig's origin is at the FEET — that is what the drop-in and the
    // sink-through-the-floor death both key off — so hips hang at dress height.
    const hipL = new Group()
    const hipR = new Group()
    const thighL = new Mesh(cylY, plate)
    const thighR = new Mesh(cylY, plate)
    const kneeL = new Group()
    const kneeR = new Group()
    const shinL = new Mesh(cylY, darkMetal)
    const shinR = new Mesh(cylY, darkMetal)
    hipL.add(thighL, kneeL)
    hipR.add(thighR, kneeR)
    kneeL.add(shinL)
    kneeR.add(shinR)
    rig.add(hipL, hipR)

    // Torso and everything it carries.
    const torso = new Group()
    rig.add(torso)
    const chest = new Mesh(box, plate)
    const belly = new Mesh(box, accent)
    const back = new Mesh(sphere, plate)
    const pauldronL = new Mesh(sphere, plate)
    const pauldronR = new Mesh(sphere, plate)
    const core = new Mesh(sphere, coreMaterial)
    torso.add(chest, belly, back, pauldronL, pauldronR, core)

    const head = new Group()
    torso.add(head)
    // The skull is the shared dark metal: at range it reads as a visor slit
    // under the helm, which is more menacing than a face and far cheaper.
    const skull = new Mesh(sphere, darkMetal)
    const helm = new Mesh(sphere, plate)
    const crest = new Mesh(coneY, accent)
    const hornL = new Mesh(coneY, accent)
    const hornR = new Mesh(coneY, accent)
    head.add(skull, helm, crest, hornL, hornR)

    const shoulderL = new Group()
    const shoulderR = new Group()
    const upperL = new Mesh(cylY, plate)
    const upperR = new Mesh(cylY, plate)
    const elbowL = new Group()
    const elbowR = new Group()
    const foreL = new Mesh(box, accent)
    const foreR = new Mesh(box, accent)
    shoulderL.add(upperL, elbowL)
    shoulderR.add(upperR, elbowR)
    elbowL.add(foreL)
    elbowR.add(foreR)
    torso.add(shoulderL, shoulderR)

    // The carried weapon: a rifle across the chest or a mortar on the
    // shoulder, depending on the dress. Blade kinds hide it and wear their
    // weapons as forearms instead.
    const weaponMount = new Group()
    const weaponA = new Mesh(cylZ, darkMetal)
    const weaponB = new Mesh(box, darkMetal)
    weaponMount.add(weaponA, weaponB)
    torso.add(weaponMount)

    const badgeMaterial = new SpriteMaterial({ transparent: true, depthWrite: false, fog: false })
    const badge = new Sprite(badgeMaterial)
    rig.add(badge)

    // The pip is a plain billboard group rather than sprites, so the fill can
    // be anchored to one edge in the group's own space.
    const pip = new Group()
    pip.visible = false
    rig.add(pip)

    const pipBackMesh = new Mesh(quad, pipBack)
    pipBackMesh.scale.set(PIP_WIDTH, PIP_HEIGHT, 1)
    pip.add(pipBackMesh)

    const pipFillMaterial = new MeshBasicMaterial({ transparent: true, depthWrite: false, fog: false })
    const pipFill = new Mesh(quad, pipFillMaterial)
    pipFill.position.z = 0.005
    pip.add(pipFill)

    slots.push({
      rig,
      torso,
      head,
      hipL,
      kneeL,
      hipR,
      kneeR,
      shoulderL,
      elbowL,
      shoulderR,
      elbowR,
      weaponMount,
      thighL,
      shinL,
      thighR,
      shinR,
      upperL,
      foreL,
      upperR,
      foreR,
      chest,
      belly,
      back,
      pauldronL,
      pauldronR,
      skull,
      helm,
      crest,
      hornL,
      hornR,
      weaponA,
      weaponB,
      core,
      badge,
      badgeMaterial,
      pip,
      pipFill,
      pipFillMaterial,
      plate,
      accent,
      coreMaterial,
      plateBase: new Color(0xffffff),
      accentBase: new Color(0xffffff),
      id: -1,
      kind: null,
      emoji: '',
      deathTime: 0,
      height: ACTOR_HEIGHT,
      radius: ACTOR_RADIUS,
      profile: KINDS.gunner,
      prevX: 0,
      prevZ: 0,
      speed: 0,
      // 2.399 radians is the golden angle: successive slots start their gait
      // as far out of phase as possible, so a fresh wave never goose-steps.
      phase: i * 2.399,
    })
  }

  /**
   * Reshapes a slot for a role. Only ever runs when a slot changes occupant.
   *
   * Dress owns everything STATIC — scales, joint positions, visibility,
   * colours — and touches no rotations: the per-frame pose writes every joint
   * every frame, so nothing dressed here can go stale between occupants.
   */
  function dress(slot: EnemySlot, kind: ArenaViewEnemyKind): void {
    const profile = KINDS[kind]
    slot.kind = kind
    slot.profile = profile
    slot.height = ACTOR_HEIGHT * profile.height
    slot.radius = ACTOR_RADIUS * profile.girth
    slot.plateBase.setHex(profile.plate)
    slot.accentBase.setHex(profile.accent)
    slot.plate.color.copy(slot.plateBase)
    slot.accent.color.copy(slot.accentBase)

    const h = slot.height
    const r = slot.radius

    /* --- Legs --- */

    const hipY = h * 0.46
    const thighLen = hipY * 0.52
    const shinLen = hipY * 0.48
    slot.hipL.position.set(-r * 0.55, hipY, 0)
    slot.hipR.position.set(r * 0.55, hipY, 0)
    slot.thighL.scale.set(r * 0.42, thighLen, r * 0.42)
    slot.thighR.scale.copy(slot.thighL.scale)
    slot.thighL.position.y = -thighLen / 2
    slot.thighR.position.y = -thighLen / 2
    slot.kneeL.position.y = -thighLen
    slot.kneeR.position.y = -thighLen
    slot.shinL.scale.set(r * 0.32, shinLen, r * 0.32)
    slot.shinR.scale.copy(slot.shinL.scale)
    slot.shinL.position.y = -shinLen / 2
    slot.shinR.position.y = -shinLen / 2

    /* --- Torso --- */

    slot.torso.position.set(0, hipY, 0)
    slot.chest.scale.set(r * 1.7, h * 0.2, r * 1.05)
    slot.chest.position.set(0, h * 0.25, 0)
    slot.belly.scale.set(r * 1.35, h * 0.13, r * 0.85)
    slot.belly.position.set(0, h * 0.1, 0)

    // The back prop is the side-on silhouette: a squared pack for the gunner,
    // a domed shell for the heavies, nothing on the rusher's whippy spine.
    slot.back.visible = profile.arms !== 'blades'
    if (profile.arms === 'rifle') {
      slot.back.scale.set(r * 0.8, h * 0.14, r * 0.5)
      slot.back.position.set(0, h * 0.22, r * 0.75)
    } else {
      slot.back.scale.set(r * 1.35, h * 0.16, r * 1.0)
      slot.back.position.set(0, h * 0.22, r * 0.45)
    }

    const showPauldrons = profile.girth >= 1 || profile.arms === 'blades'
    slot.pauldronL.visible = showPauldrons
    slot.pauldronR.visible = showPauldrons
    slot.pauldronL.scale.set(r * 0.55, r * 0.4, r * 0.55)
    slot.pauldronR.scale.copy(slot.pauldronL.scale)
    slot.pauldronL.position.set(-r * 1.0, h * 0.32, 0)
    slot.pauldronR.position.set(r * 1.0, h * 0.32, 0)

    // The boss's core sits proud of the chest plate, facing the player, and is
    // the one part of any enemy drawn unlit and unfogged.
    slot.core.visible = profile.core
    slot.core.scale.set(r * 0.42, r * 0.42, r * 0.3)
    slot.core.position.set(0, h * 0.24, -r * 0.55)

    /* --- Head --- */

    slot.head.position.set(0, h * 0.4, -r * 0.1)
    const skullR = r * 0.5
    slot.skull.scale.setScalar(skullR)
    slot.skull.position.set(0, skullR * 0.4, -r * 0.08)
    slot.helm.scale.set(skullR * 1.15, skullR * 1.05, skullR * 1.15)
    slot.helm.position.set(0, skullR * 0.62, 0)

    // Headgear is the last metre of identity: spikes, antenna, bolts, crown.
    switch (profile.crown) {
      case 'spikes': {
        slot.crest.visible = true
        slot.hornL.visible = true
        slot.hornR.visible = true
        slot.crest.scale.set(r * 0.18, r * 0.55, r * 0.18)
        slot.crest.position.set(0, skullR * 1.5, 0)
        slot.crest.rotation.set(-0.3, 0, 0)
        slot.hornL.scale.set(r * 0.14, r * 0.4, r * 0.14)
        slot.hornR.scale.copy(slot.hornL.scale)
        slot.hornL.position.set(-skullR * 0.7, skullR * 1.2, 0)
        slot.hornR.position.set(skullR * 0.7, skullR * 1.2, 0)
        slot.hornL.rotation.set(0, 0, 0.7)
        slot.hornR.rotation.set(0, 0, -0.7)
        break
      }
      case 'antenna': {
        slot.crest.visible = true
        slot.hornL.visible = false
        slot.hornR.visible = false
        slot.crest.scale.set(r * 0.06, r * 0.6, r * 0.06)
        slot.crest.position.set(skullR * 0.6, skullR * 1.3, skullR * 0.4)
        slot.crest.rotation.set(0.2, 0, -0.15)
        break
      }
      case 'bolts': {
        slot.crest.visible = false
        slot.hornL.visible = true
        slot.hornR.visible = true
        slot.hornL.scale.set(r * 0.2, r * 0.28, r * 0.2)
        slot.hornR.scale.copy(slot.hornL.scale)
        slot.hornL.position.set(-skullR * 1.05, skullR * 0.7, 0)
        slot.hornR.position.set(skullR * 1.05, skullR * 0.7, 0)
        slot.hornL.rotation.set(0, 0, 1.35)
        slot.hornR.rotation.set(0, 0, -1.35)
        break
      }
      case 'crown': {
        slot.crest.visible = true
        slot.hornL.visible = true
        slot.hornR.visible = true
        slot.crest.scale.set(r * 0.22, r * 0.75, r * 0.22)
        slot.crest.position.set(0, skullR * 1.7, 0)
        slot.crest.rotation.set(0, 0, 0)
        slot.hornL.scale.set(r * 0.16, r * 0.55, r * 0.16)
        slot.hornR.scale.copy(slot.hornL.scale)
        slot.hornL.position.set(-skullR * 0.75, skullR * 1.45, 0)
        slot.hornR.position.set(skullR * 0.75, skullR * 1.45, 0)
        slot.hornL.rotation.set(0, 0, 0.35)
        slot.hornR.rotation.set(0, 0, -0.35)
        break
      }
    }

    /* --- Arms --- */

    const shoulderY = h * 0.33
    const upperLen = h * 0.16
    const foreLen = h * 0.15
    slot.shoulderL.position.set(-r * 0.95, shoulderY, 0)
    slot.shoulderR.position.set(r * 0.95, shoulderY, 0)
    slot.upperL.scale.set(r * 0.3, upperLen, r * 0.3)
    slot.upperR.scale.copy(slot.upperL.scale)
    slot.upperL.position.y = -upperLen / 2
    slot.upperR.position.y = -upperLen / 2
    slot.elbowL.position.y = -upperLen
    slot.elbowR.position.y = -upperLen

    if (profile.arms === 'blades') {
      // The forearms ARE the weapons: long flat blades past where hands would
      // be. Accent-coloured, so they catch the hurt flash and the tell heat.
      slot.foreL.scale.set(r * 0.16, h * 0.3, r * 0.5)
      slot.foreR.scale.copy(slot.foreL.scale)
      slot.foreL.position.y = -h * 0.15
      slot.foreR.position.y = -h * 0.15
    } else {
      slot.foreL.scale.set(r * 0.26, foreLen, r * 0.26)
      slot.foreR.scale.copy(slot.foreL.scale)
      slot.foreL.position.y = -foreLen / 2
      slot.foreR.position.y = -foreLen / 2
    }

    /* --- Carried weapon --- */

    if (profile.arms === 'rifle') {
      // Held level across the chest, pointing -Z — straight at the player,
      // because the rig's yaw already faces them. The second mesh borrows the
      // box shape and becomes the stock.
      slot.weaponMount.visible = true
      slot.weaponMount.position.set(r * 0.15, h * 0.24, -r * 0.9)
      slot.weaponA.scale.set(r * 0.16, r * 0.16, r * 2.6)
      slot.weaponA.position.set(0, 0, -r * 0.3)
      slot.weaponB.geometry = box
      slot.weaponB.scale.set(r * 0.2, r * 0.3, r * 0.7)
      slot.weaponB.position.set(0, -r * 0.08, r * 0.9)
    } else if (profile.arms === 'mortar') {
      // The tube rides the right shoulder, muzzle forward and up a little; the
      // second mesh becomes the flared mouth that says "shells come out of me".
      // Swapping a shared geometry onto the mesh is free — dress only runs when
      // a slot changes occupant, and both shapes stay owned by the pool.
      slot.weaponMount.visible = true
      slot.weaponMount.position.set(r * 0.85, h * 0.4, 0)
      slot.weaponA.scale.set(r * 0.85, r * 0.85, h * 0.55)
      slot.weaponA.position.set(0, 0, 0)
      slot.weaponB.geometry = coneZ
      slot.weaponB.scale.set(r * 1.15, r * 1.15, h * 0.14)
      slot.weaponB.position.set(0, 0, -h * 0.32)
    } else {
      slot.weaponMount.visible = false
    }

    /* --- Billboards --- */

    const badgeSize = slot.radius * 1.9
    slot.badge.scale.set(badgeSize, badgeSize, 1)
    slot.badge.position.set(0, slot.height + badgeSize * 0.6, 0)
    slot.pip.position.set(0, slot.height + 0.16, 0)
  }

  /**
   * Takes a slot off the field.
   *
   * It deliberately leaves `slot.id` alone. Clearing it would make the next
   * frame see a fresh occupant, reset the collapse timer, and stand the corpse
   * back up to fall over again — forever, for as long as the simulation keeps
   * the body in its list.
   */
  function retire(slot: EnemySlot, index: number): void {
    slot.rig.visible = false
    shadows.setMatrixAt(index, scratchMatrix.makeScale(0, 0, 0))
    tellPool.setMatrixAt(index, scratchMatrix)
    tellRing.setMatrixAt(index, scratchMatrix)
    tellPool.setColorAt(index, scratchColor.setRGB(0, 0, 0))
    tellRing.setColorAt(index, scratchColor)
  }

  /** Local clock for idle breathing and the boss core; the view has no elapsed. */
  let time = 0

  return {
    group,

    apply(enemies, dt, cameraQuaternion, reducedMotion) {
      time += dt

      for (let index = 0; index < ENEMY_POOL; index += 1) {
        const slot = slots[index]
        if (!slot) continue

        // Anything past the pool simply is not drawn. See ENEMY_POOL.
        const enemy = index < enemies.length ? enemies[index] : undefined
        if (!enemy) {
          retire(slot, index)
          continue
        }

        // A slot changing occupant resets every animation timer it was holding,
        // or a fresh enemy inherits the collapse of the one it replaced.
        if (slot.id !== enemy.id) {
          slot.id = enemy.id
          slot.deathTime = 0
          slot.prevX = enemy.pos.x
          slot.prevZ = enemy.pos.z
          slot.speed = 0
        }
        if (slot.kind !== enemy.kind) dress(slot, enemy.kind)
        if (slot.emoji !== enemy.emoji) {
          slot.emoji = enemy.emoji
          slot.badgeMaterial.map = emojiFor(enemy.emoji)
          slot.badgeMaterial.needsUpdate = true
        }

        slot.deathTime = enemy.alive ? 0 : slot.deathTime + dt
        const fall = Math.min(1, slot.deathTime / DEATH_TIME)
        if (fall >= 1) {
          retire(slot, index)
          continue
        }

        const profile = slot.profile

        /* --- Ground speed, from positions ---------------------------- */

        // The view carries no enemy velocity, so it is recovered by finite
        // difference and smoothed — raw per-frame speed jitters at low frame
        // rates and would make the legs stutter.
        if (dt > 1e-4) {
          const rawSpeed = Math.hypot(enemy.pos.x - slot.prevX, enemy.pos.z - slot.prevZ) / dt
          slot.speed += (rawSpeed - slot.speed) * Math.min(1, dt * 10)
        }
        slot.prevX = enemy.pos.x
        slot.prevZ = enemy.pos.z
        const stride = clamp01(slot.speed / FULL_STRIDE_SPEED)
        if (enemy.alive) slot.phase += slot.speed * dt * profile.stride
        const gait = Math.sin(slot.phase)

        /* --- Drop-in, collapse, and where the body sits ------------ */

        const drop = Math.min(1, enemy.age / DROP_IN_TIME)
        const dropScale = enemy.alive ? backOut(drop) : 1
        // Falling in from above and landing with an overshoot: the arrival has
        // to be visible or a wave appears to teleport onto the player.
        const dropLift = (1 - drop) * (1 - drop) * DROP_IN_HEIGHT

        // Heavies bounce on the beat of their own steps; it is the stomp.
        const stomp =
          reducedMotion || !enemy.alive ? 0 : Math.abs(Math.sin(slot.phase)) * profile.sway * 0.5 * stride

        slot.rig.visible = true
        // Once the body is on its way down it also sinks, and the opaque floor
        // swallows it — which is why nothing here ever has to go transparent.
        slot.rig.position.set(enemy.pos.x, dropLift - fall * slot.height * 0.5 + stomp, enemy.pos.z)
        slot.rig.scale.setScalar(dropScale * (1 - fall * 0.15))

        /* --- The tell ---------------------------------------------- */

        // `stagger` cancels the read: a reeling enemy is not about to hit you,
        // and leaving the tell up would train the player to dodge nothing.
        const winding = enemy.windUp > 0 && enemy.stagger <= 0 && enemy.alive
        const charge = winding ? 1 - Math.min(1, enemy.windUp / TELL_WINDOW) : 0

        /* --- Pose --------------------------------------------------- */

        const hurt = enemy.hurt > 0 ? Math.min(1, enemy.hurt / 0.3) : 0
        const reel = enemy.stagger > 0 && !reducedMotion ? Math.sin(enemy.stagger * 30) * 0.18 : 0

        // The rig only yaws and dies; posture lives on the torso.
        scratchEuler.set(fall * (Math.PI / 2) * 0.92, enemy.yaw, 0)
        slot.rig.quaternion.setFromEuler(scratchEuler)

        // Coiling forward as the blow charges, thrown back when hit. The sway
        // rolls the shoulders with each step, scaled by how heavy the kind is.
        slot.torso.rotation.x = profile.hunch + charge * 0.3 - hurt * 0.35
        slot.torso.rotation.y = 0
        slot.torso.rotation.z = reel + gait * profile.sway * stride
        // Idle breath: alive, cheap, and desynchronised by each slot's phase
        // seed so a line of enemies never inhales in unison.
        slot.torso.position.y =
          slot.height * 0.46 + (reducedMotion ? 0 : Math.sin(time * 2.1 + slot.phase) * 0.012)

        // Head: a touch of the hunch back out, so the eyes stay on the player.
        slot.head.rotation.x = -profile.hunch * 0.6 - charge * 0.2
        slot.head.rotation.z = 0

        /* --- Legs ---------------------------------------------------- */

        // Rushers run in a permanent crouch — thighs pre-flexed forward, knees
        // pre-folded back, fast scissor — while heavies barely flex. Both fall
        // out of the profile. Signs as on the commander: positive hip rotation
        // is forward, and a knee only ever bends negative.
        const crouch = profile.arms === 'blades' ? 0.4 : 0.08
        const swing = gait * profile.legSwing * stride
        slot.hipL.rotation.x = crouch * 0.9 - swing
        slot.hipR.rotation.x = crouch * 0.9 + swing
        slot.kneeL.rotation.x = -(crouch * 1.4 + Math.max(0, gait) * profile.legSwing * 1.1 * stride)
        slot.kneeR.rotation.x = -(crouch * 1.4 + Math.max(0, -gait) * profile.legSwing * 1.1 * stride)

        /* --- Arms and the wind-up pose -------------------------------- */

        // THE SACRED PART, channel four: over the wind-up the striking limb
        // rears back, so even with the rings and the colour ramp filtered out
        // of a player's attention, the body itself says "now".
        switch (profile.arms) {
          case 'blades': {
            // Blades pump with the lope, carried low and forward.
            slot.shoulderL.rotation.set(0.55 - gait * 0.85 * stride, 0.15, 0)
            slot.shoulderR.rotation.set(0.55 + gait * 0.85 * stride - charge * 2.4, -0.15, 0)
            slot.elbowL.rotation.set(0.75, 0, 0)
            slot.elbowR.rotation.set(0.75 - charge * 0.6, 0, 0)
            break
          }
          case 'rifle': {
            // Both hands stay on the rifle; the wind-up is a brace — stock
            // pulled in, muzzle steadying on the player.
            slot.shoulderL.rotation.set(1.05 + gait * 0.06 * stride, 0.42, 0)
            slot.shoulderR.rotation.set(0.95 - gait * 0.06 * stride + charge * 0.25, -0.35, 0)
            slot.elbowL.rotation.set(0.45, 0, 0)
            slot.elbowR.rotation.set(0.5, 0, 0)
            slot.weaponMount.rotation.set(charge * 0.1, 0, 0)
            break
          }
          case 'mortar': {
            // The right arm is welded to the tube; the left swings with the
            // stomp and rears with the tube as the shot charges.
            slot.shoulderR.rotation.set(2.5, -0.3, 0)
            slot.elbowR.rotation.set(1.15, 0, 0)
            slot.shoulderL.rotation.set(0.25 - gait * 0.5 * stride - charge * 1.6, 0.2, 0)
            slot.elbowL.rotation.set(0.5, 0, 0)
            // The tube itself tips back over the wind-up, like a trebuchet arm
            // being winched, and snaps level as the shell leaves.
            slot.weaponMount.rotation.set(charge * 0.55, 0, 0)
            break
          }
        }

        /* --- The boss core ------------------------------------------- */

        if (profile.core) {
          // The heartbeat quickens toward the strike. Reduced motion holds it
          // at a steady glow instead of a pulse.
          const beat = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(time * (3 + charge * 6) + slot.phase)
          slot.coreMaterial.color.copy(CORE_COLOUR).multiplyScalar(0.6 + beat * 0.7 + charge * 0.5)
          const coreScale = 1 + beat * 0.12
          slot.core.scale.set(
            slot.radius * 0.42 * coreScale,
            slot.radius * 0.42 * coreScale,
            slot.radius * 0.3,
          )
        }

        /* --- Skin --------------------------------------------------- */

        if (enemy.stagger > 0) {
          slot.plate.color.lerpColors(slot.plateBase, COLD_TINT, 0.7)
          slot.accent.color.lerpColors(slot.accentBase, COLD_TINT, 0.7)
        } else {
          slot.plate.color.copy(slot.plateBase)
          slot.accent.color.copy(slot.accentBase)
        }

        // One emissive read, driven by whichever of the two is louder. The
        // wind-up wins ties, because a flinch is information the player already
        // has and an incoming blow is information they do not.
        if (charge > 0) {
          scratchColor.lerpColors(TELL_EARLY, TELL_LATE, charge)
          slot.plate.emissive.copy(scratchColor)
          slot.accent.emissive.copy(scratchColor)
          slot.plate.emissiveIntensity = 0.12 + charge * 0.85
          slot.accent.emissiveIntensity = 0.12 + charge * 0.85
        } else {
          slot.plate.emissive.copy(HURT_GLOW)
          slot.accent.emissive.copy(HURT_GLOW)
          slot.plate.emissiveIntensity = hurt * 0.9
          slot.accent.emissiveIntensity = hurt * 0.9
        }

        /* --- Billboards --------------------------------------------- */

        slot.badge.material.opacity = enemy.alive ? 1 : 1 - fall

        const fraction = Math.max(0, Math.min(1, enemy.health / Math.max(1, enemy.maxHealth)))
        // Hidden until it has been hurt: twelve full bars over a fresh wave is
        // noise, and the one that is nearly dead is the one worth marking.
        slot.pip.visible = enemy.alive && fraction < 0.999
        if (slot.pip.visible) {
          slot.pip.quaternion.copy(cameraQuaternion)
          // Drains right to left. The arena has no reading direction of its
          // own, but the game around it is Persian, and a bar that empties
          // toward the right would read backwards to the player holding it.
          slot.pipFill.scale.set(PIP_WIDTH * fraction, PIP_HEIGHT * 0.66, 1)
          slot.pipFill.position.x = (PIP_WIDTH * (1 - fraction)) / 2
          slot.pipFillMaterial.color.setRGB(
            1 - fraction * 0.75,
            0.24 + fraction * 0.66,
            0.28 * fraction,
          )
        }

        /* --- Ground layers ------------------------------------------ */

        const shadowSize = slot.radius * 5 * dropScale * (1 - fall * 0.6)
        scratchPosition.set(enemy.pos.x, 0.02, enemy.pos.z)
        scratchScale.set(shadowSize, 1, shadowSize)
        shadows.setMatrixAt(
          index,
          scratchMatrix.compose(scratchPosition, scratchQuaternion.identity(), scratchScale),
        )

        if (!winding) {
          tellPool.setMatrixAt(index, scratchMatrix.makeScale(0, 0, 0))
          tellRing.setMatrixAt(index, scratchMatrix)
          tellPool.setColorAt(index, scratchColor.setRGB(0, 0, 0))
          tellRing.setColorAt(index, scratchColor)
          continue
        }

        // The pool of light BLOOMS outward while the ring CONVERGES inward, and
        // the two meet on the enemy's feet exactly as the blow lands. Growth
        // alone is easy to miss in peripheral vision; the closing ring is what
        // turns it into a countdown.
        const poolSize = slot.radius * (3.4 + charge * 5.2)
        scratchPosition.set(enemy.pos.x, 0.05, enemy.pos.z)
        scratchScale.set(poolSize, 1, poolSize)
        tellPool.setMatrixAt(
          index,
          scratchMatrix.compose(scratchPosition, scratchQuaternion.identity(), scratchScale),
        )
        scratchColor.lerpColors(TELL_EARLY, TELL_LATE, charge).multiplyScalar(0.4 + charge * 0.95)
        tellPool.setColorAt(index, scratchColor)

        const ringSize = slot.radius * (7.6 - charge * 5.4)
        scratchPosition.y = 0.07
        scratchScale.set(ringSize, 1, ringSize)
        tellRing.setMatrixAt(
          index,
          scratchMatrix.compose(scratchPosition, scratchQuaternion.identity(), scratchScale),
        )
        scratchColor.lerpColors(TELL_EARLY, TELL_LATE, charge).multiplyScalar(0.7 + charge * 1.6)
        tellRing.setColorAt(index, scratchColor)
      }

      shadows.instanceMatrix.needsUpdate = true
      tellPool.instanceMatrix.needsUpdate = true
      tellRing.instanceMatrix.needsUpdate = true
      if (tellPool.instanceColor) tellPool.instanceColor.needsUpdate = true
      if (tellRing.instanceColor) tellRing.instanceColor.needsUpdate = true
    },

    dispose() {
      for (const texture of emojiCache.values()) texture.dispose()
      emojiCache.clear()
    },
  }
}
