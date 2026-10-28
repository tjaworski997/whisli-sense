import { useEffect, useRef, useSyncExternalStore } from "react"

import { playBeep } from "@/lib/sound"

const storageKey = "whisli-sense.radarSound"
// Like a parking sensor: almost continuous up close, slowest far away
const nearCm = 40
const farCm = 600
const fastestMs = 90
const slowestMs = 1400

// One switch and one AudioContext for the whole panel, so every sound icon shows the same state.
let enabled = (() => { try { return localStorage.getItem(storageKey) === "on" } catch { return false } })()
let context: AudioContext | null = null
const listeners = new Set<() => void>()

function startAudio() {
  context ??= new AudioContext()
  void context.resume()
}

// When the sound was left on, browsers still need a click before playing anything.
if (enabled) window.addEventListener("pointerdown", startAudio, { once: true })

export function toggleRadarSound() {
  enabled = !enabled
  if (enabled) startAudio()
  try { localStorage.setItem(storageKey, enabled ? "on" : "off") } catch { /* not remembered */ }
  listeners.forEach(listener => listener())
}

export function useRadarSoundEnabled() {
  return useSyncExternalStore(listener => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, () => enabled)
}

function intervalFor(cm: number) {
  const share = Math.min(Math.max((cm - nearCm) / (farCm - nearCm), 0), 1)
  return fastestMs + share * (slowestMs - fastestMs)
}

/** Beeps faster the closer the person is; silent when nobody is there or the sound is off. */
export function useRadarBeeps(distanceCm: number) {
  const on = useRadarSoundEnabled()
  const distance = useRef(distanceCm)
  distance.current = distanceCm

  // The next beep's delay is taken from the latest distance, so the pace follows the person.
  useEffect(() => {
    if (!on) return
    let timer = 0
    const tick = () => {
      const cm = distance.current
      if (cm >= 0 && context?.state === "running") playBeep(context)
      timer = window.setTimeout(tick, cm >= 0 ? intervalFor(cm) : 200)
    }
    tick()
    return () => window.clearTimeout(timer)
  }, [on])
}
