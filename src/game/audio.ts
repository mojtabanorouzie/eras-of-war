/**
 * Tiny synthesised sound effects.
 *
 * No audio files, no network, no autoplay: the AudioContext is only created
 * after the player's first tap, and everything is a short envelope on an
 * oscillator. The game is fully playable with sound off.
 */

type Cue = 'tap' | 'buy' | 'battle' | 'victory' | 'defeat' | 'hit' | 'hurt' | 'perfect'

interface Tone {
  freq: number
  duration: number
  type: OscillatorType
  gain: number
  /** Delay before this tone starts, in seconds. */
  at: number
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
}

let context: AudioContext | null = null
let muted = false

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

export function playCue(cue: Cue): void {
  if (muted) return
  const ctx = getContext()
  if (!ctx) return
  if (ctx.state === 'suspended') void ctx.resume()

  const start = ctx.currentTime
  for (const tone of CUES[cue]) {
    const oscillator = ctx.createOscillator()
    const envelope = ctx.createGain()
    oscillator.type = tone.type
    oscillator.frequency.value = tone.freq

    const from = start + tone.at
    const to = from + tone.duration
    envelope.gain.setValueAtTime(0.0001, from)
    envelope.gain.exponentialRampToValueAtTime(tone.gain, from + 0.015)
    envelope.gain.exponentialRampToValueAtTime(0.0001, to)

    oscillator.connect(envelope).connect(ctx.destination)
    oscillator.start(from)
    oscillator.stop(to + 0.02)
  }
}
