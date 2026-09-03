/**
 * Tiny synthesised sound effects.
 *
 * No audio files, no network, no autoplay: the AudioContext is only created
 * after the player's first tap, and everything is a short envelope on an
 * oscillator or on a burst of noise. The game is fully playable with sound off.
 *
 * Noise matters more than it sounds. A gunshot built from an oscillator is a
 * beep — the crack of a rifle is broadband, and the only way to get it out of
 * the Web Audio API without shipping a sample is to filter white noise. So
 * every impulsive sound here (shots, reloads, explosions) is a noise burst
 * swept through a low-pass, and only the pitched ones stay oscillators.
 */

type Cue =
  | 'tap'
  | 'buy'
  | 'battle'
  | 'victory'
  | 'defeat'
  | 'hit'
  | 'hurt'
  | 'perfect'
  /* The arena. */
  | 'shot'
  | 'shotBig'
  | 'shotEnergy'
  | 'swing'
  | 'reload'
  | 'dryFire'
  | 'blast'
  | 'heal'

interface Tone {
  /** Oscillator pitch, or the low-pass cutoff for a noise burst. */
  freq: number
  duration: number
  /** `noise` swaps the oscillator for filtered white noise. */
  type: OscillatorType | 'noise'
  gain: number
  /** Delay before this tone starts, in seconds. */
  at: number
  /**
   * Where `freq` ends up by the end of the tone.
   *
   * A downward sweep is what separates a shot from a beep: real impulses lose
   * their high end almost immediately, and a static filter sounds like a hiss.
   */
  sweepTo?: number
}

const CUES: Record<Cue, Tone[]> = {
  tap: [{ freq: 520, duration: 0.06, type: 'triangle', gain: 0.05, at: 0 }],
  buy: [
    { freq: 660, duration: 0.08, type: 'triangle', gain: 0.06, at: 0 },
    { freq: 990, duration: 0.12, type: 'triangle', gain: 0.06, at: 0.07 },
  ],
  battle: [
    { freq: 180, duration: 0.14, type: 'sawtooth', gain: 0.05, at: 0 },
    { freq: 120, duration: 0.2, type: 'sawtooth', gain: 0.05, at: 0.1 },
  ],
  victory: [
    { freq: 523, duration: 0.12, type: 'triangle', gain: 0.07, at: 0 },
    { freq: 659, duration: 0.12, type: 'triangle', gain: 0.07, at: 0.11 },
    { freq: 784, duration: 0.26, type: 'triangle', gain: 0.07, at: 0.22 },
  ],
  defeat: [
    { freq: 330, duration: 0.16, type: 'sine', gain: 0.06, at: 0 },
    { freq: 220, duration: 0.3, type: 'sine', gain: 0.06, at: 0.14 },
  ],

  /* Combat. Short and quiet: these fire several times a second. */
  hit: [{ freq: 320, duration: 0.05, type: 'square', gain: 0.04, at: 0 }],
  hurt: [{ freq: 140, duration: 0.11, type: 'sawtooth', gain: 0.055, at: 0 }],
  perfect: [
    { freq: 880, duration: 0.07, type: 'triangle', gain: 0.06, at: 0 },
    { freq: 1320, duration: 0.15, type: 'triangle', gain: 0.05, at: 0.06 },
  ],

  /*
   * Gunfire. The crack is the noise burst; the short low oscillator under it is
   * the body of the report, which is what stops it sounding like static.
   * Deliberately quiet — an automatic weapon fires ten of these a second.
   */
  shot: [
    { freq: 2600, duration: 0.07, type: 'noise', gain: 0.055, at: 0, sweepTo: 380 },
    { freq: 160, duration: 0.05, type: 'square', gain: 0.035, at: 0, sweepTo: 70 },
  ],
  /** A sniper round or a catapult shell: slower, lower, and it hangs longer. */
  shotBig: [
    { freq: 1400, duration: 0.26, type: 'noise', gain: 0.075, at: 0, sweepTo: 130 },
    { freq: 90, duration: 0.2, type: 'sine', gain: 0.06, at: 0, sweepTo: 45 },
  ],
  /** No powder, so no crack — a pitched bolt falling away instead. */
  shotEnergy: [
    { freq: 1500, duration: 0.09, type: 'sawtooth', gain: 0.045, at: 0, sweepTo: 420 },
    { freq: 3000, duration: 0.05, type: 'noise', gain: 0.02, at: 0, sweepTo: 1200 },
  ],
  /** A swung weapon displaces air; it does not bang. */
  swing: [{ freq: 3200, duration: 0.15, type: 'noise', gain: 0.05, at: 0, sweepTo: 700 }],

  /**
   * Two clicks, because that is what a reload is: the magazine seating, then
   * the action closing. One click reads as a UI blip rather than as a weapon.
   */
  reload: [
    { freq: 2400, duration: 0.045, type: 'noise', gain: 0.05, at: 0, sweepTo: 900 },
    { freq: 1800, duration: 0.06, type: 'noise', gain: 0.055, at: 0.15, sweepTo: 500 },
  ],
  /** The trigger on an empty chamber. Thin, bright and unsatisfying, by design. */
  dryFire: [{ freq: 5000, duration: 0.03, type: 'noise', gain: 0.05, at: 0, sweepTo: 2200 }],
  /* Two soft rising notes: relief, not fanfare. It fires mid-firefight. */
  heal: [
    { freq: 620, duration: 0.09, type: 'sine', gain: 0.06, at: 0 },
    { freq: 930, duration: 0.14, type: 'sine', gain: 0.055, at: 0.07 },
  ],
  blast: [
    { freq: 900, duration: 0.45, type: 'noise', gain: 0.09, at: 0, sweepTo: 90 },
    { freq: 70, duration: 0.32, type: 'sine', gain: 0.07, at: 0, sweepTo: 38 },
  ],
}

/**
 * The shortest gap allowed between two firings of the same cue, in ms.
 *
 * Only for the handful that can be triggered several times in a single frame —
 * a shotgun lands six pellets at once, and six overlapping copies of one
 * envelope clip into a click instead of sounding six times as satisfying.
 */
const THROTTLE_MS: Partial<Record<Cue, number>> = {
  hit: 45,
  shot: 25,
  shotEnergy: 25,
}

const lastPlayed = new Map<Cue, number>()

let context: AudioContext | null = null
let muted = false

/**
 * One second of white noise, built once and looped.
 *
 * `Math.random` is fine here: this is the audio engine, not the simulation, and
 * nothing about a replayed fight depends on which noise samples it hears.
 */
let noise: AudioBuffer | null = null

export function setMuted(next: boolean): void {
  muted = next
}

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (context) return context
  const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  try {
    context = new Ctor()
    return context
  } catch {
    return null
  }
}

function getNoise(ctx: AudioContext): AudioBuffer {
  if (noise && noise.sampleRate === ctx.sampleRate) return noise
  const length = Math.floor(ctx.sampleRate)
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const channel = buffer.getChannelData(0)
  for (let i = 0; i < length; i += 1) channel[i] = Math.random() * 2 - 1
  noise = buffer
  return buffer
}

export function playCue(cue: Cue): void {
  if (muted) return

  const floor = THROTTLE_MS[cue]
  if (floor !== undefined) {
    const now = performance.now()
    const previous = lastPlayed.get(cue)
    if (previous !== undefined && now - previous < floor) return
    lastPlayed.set(cue, now)
  }

  const ctx = getContext()
  if (!ctx) return
  if (ctx.state === 'suspended') void ctx.resume()

  const start = ctx.currentTime
  for (const tone of CUES[cue]) {
    const from = start + tone.at
    const to = from + tone.duration

    const envelope = ctx.createGain()
    envelope.gain.setValueAtTime(0.0001, from)
    // A faster attack than the UI cues use: an impulsive sound with a slow
    // ramp on the front reads as a swell rather than as a hit.
    envelope.gain.exponentialRampToValueAtTime(tone.gain, from + 0.008)
    envelope.gain.exponentialRampToValueAtTime(0.0001, to)
    envelope.connect(ctx.destination)

    if (tone.type === 'noise') {
      const source = ctx.createBufferSource()
      source.buffer = getNoise(ctx)
      source.loop = true
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.setValueAtTime(tone.freq, from)
      // exponentialRampToValueAtTime cannot reach or cross zero, hence the floor.
      if (tone.sweepTo !== undefined) {
        filter.frequency.exponentialRampToValueAtTime(Math.max(40, tone.sweepTo), to)
      }
      source.connect(filter).connect(envelope)
      source.start(from)
      source.stop(to + 0.02)
      continue
    }

    const oscillator = ctx.createOscillator()
    oscillator.type = tone.type
    oscillator.frequency.setValueAtTime(tone.freq, from)
    if (tone.sweepTo !== undefined) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, tone.sweepTo), to)
    }
    oscillator.connect(envelope)
    oscillator.start(from)
    oscillator.stop(to + 0.02)
  }
}
