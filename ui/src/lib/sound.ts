// Sounds made with Web Audio (no files). Browsers allow sound only after a click, so an
// AudioContext is created in a click handler.

export type Cue = "back" | "still" | "done"

/** A sine tone with a soft attack and decay (no clicks); `toHz` glides the pitch. */
function tone(context: AudioContext, hz: number, startIn: number, seconds: number, volume = 0.22, toHz = hz) {
  const t0 = context.currentTime + startIn
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.frequency.setValueAtTime(hz, t0)
  oscillator.frequency.exponentialRampToValueAtTime(toHz, t0 + seconds)
  gain.gain.setValueAtTime(0, t0)
  gain.gain.linearRampToValueAtTime(volume, t0 + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + seconds)
  oscillator.connect(gain).connect(context.destination)
  oscillator.start(t0)
  oscillator.stop(t0 + seconds + 0.02)
}

/** Calibration wizard signals */
export function playCue(context: AudioContext, cue: Cue) {
  if (cue === "back") { // "you can come back": three rising tones
    tone(context, 196, 0, 0.25)
    tone(context, 247, 0.22, 0.25)
    tone(context, 294, 0.44, 0.45)
  } else if (cue === "still") { // measuring starts
    tone(context, 220, 0, 0.2)
  } else { // done
    tone(context, 294, 0, 0.2)
    tone(context, 392, 0.2, 0.5)
    tone(context, 196, 0.2, 0.6)
  }
}

/** One short beep of the distance signal */
export function playBeep(context: AudioContext) {
  tone(context, 880, 0, 0.09, 0.12)
}
