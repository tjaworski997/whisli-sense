import { useEffect, useState } from "react"

import { GATE_CM, GATES } from "@/types"

// Top view of the radar with a ring every metre: the ±60° cone, or (round) a full radar screen.
// The radar gives distance only (no direction), so the target is drawn as an arc or ring at that
// distance, as wide as the radar's accuracy.
//
// Animation: a wave leaves the radar every cycle at a constant speed. When it reaches the target,
// the target lights up and a reflected wave travels back; the echo arrives later for farther targets.
const maxCm = GATES * GATE_CM
const accuracyCm = 35
const halfAngle = Math.PI / 3 // ±60°
const cycleMs = 3000
const travelMs = 1600 // wave from the radar to the edge of the cone (11.2 m); echoes from up to ~10 m fit in a cycle
const flashMs = 600

export function RadarView({ distanceCm, zone, label, round = false }: {
  distanceCm: number // -1 = nobody
  zone?: [number, number] // gates the radar uses (from, to); the rest is dimmed
  label: string
  round?: boolean
}) {
  const width = round ? 240 : 300, height = round ? 240 : 170
  const cx = round ? 120 : 140, cy = round ? 120 : height - 8, radius = round ? 110 : height - 18
  const px = (cm: number) => Math.min(Math.max(cm, 0), maxCm) / maxCm * radius
  const point = (r: number, a: number) => `${(cx + r * Math.sin(a)).toFixed(1)},${(cy - r * Math.cos(a)).toFixed(1)}`
  const circle = (r: number) => `M${cx - r},${cy} A${r},${r} 0 1 0 ${cx + r},${cy} A${r},${r} 0 1 0 ${cx - r},${cy} Z`
  // A line at distance r (cone arc or full circle) and the area between r1 and r2 (sector or ring)
  const arc = (r: number) => round ? circle(r) : `M${point(r, -halfAngle)} A${r},${r} 0 0 1 ${point(r, halfAngle)}`
  const sector = (r1: number, r2: number) => round
    ? `${circle(r2)} ${r1 > 0 ? circle(r1) : ""}`
    : `M${point(r1, -halfAngle)} A${r1},${r1} 0 0 1 ${point(r1, halfAngle)} L${point(r2, halfAngle)} A${r2},${r2} 0 0 0 ${point(r2, -halfAngle)} Z`
  const labelAngle = round ? Math.PI / 4 : halfAngle
  const rings = Array.from({ length: Math.floor(maxCm / 100) }, (_, i) => i + 1) // every metre, labelled every 2 m

  const t = useCycle() // ms into the current cycle; null when the system asks for reduced motion
  const present = distanceCm >= 0
  const hitMs = present ? Math.min(distanceCm, maxCm) / maxCm * travelMs : -1

  const wave = t !== null && t < travelMs ? t / travelMs * radius : -1
  const sinceHit = t !== null && present ? t - hitMs : -1
  const reflected = sinceHit >= 0 && sinceHit <= hitMs ? px(distanceCm) * (1 - sinceHit / Math.max(hitMs, 1)) : -1
  const flash = t === null ? 1 : sinceHit >= 0 ? Math.max(0, 1 - sinceHit / flashMs) : 0
  const target = (extraCm: number) => sector(px(distanceCm - accuracyCm - extraCm), px(distanceCm + accuracyCm + extraCm))

  return <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} fillRule="evenodd" className={round ? "h-auto w-full max-w-[300px]" : "h-auto w-full max-w-[340px]"}>
    <path className="radar-cone" d={sector(0, radius)} />
    {zone && <path className="radar-zone" d={sector(px(zone[0] * GATE_CM), px((zone[1] + 1) * GATE_CM))} />}
    {rings.map(m => <path key={m} className="radar-ring" d={arc(px(m * 100))} />)}
    {wave > 0 && <>
      <path className="radar-wave-glow" d={arc(wave)} style={{ opacity: 0.25 * (1 - wave / radius) }} />
      <path className="radar-wave" d={arc(wave)} style={{ opacity: 0.9 * (1 - wave / radius) + 0.1 }} />
    </>}
    {present && <>
      {flash > 0 && <path className="radar-target" d={target(30 * (1 - flash))} style={{ opacity: 0.35 * flash }} />}
      <path className="radar-target" d={target(0)} style={{ opacity: 0.45 + 0.55 * flash }} />
    </>}
    {reflected > 0 && <path className="radar-echo" d={arc(reflected)} style={{ opacity: 0.25 + 0.5 * reflected / Math.max(px(distanceCm), 1) }} />}
    <circle className="radar-dot" cx={cx} cy={cy} r={4} />
    {/* Labels last, so waves and the target never cover them */}
    {rings.filter(m => m % 2 === 0).map(m => <text key={m} className="radar-label" x={cx + px(m * 100) * Math.sin(labelAngle) + (round ? 3 : 4)} y={cy - px(m * 100) * Math.cos(labelAngle) + (round ? -2 : 3)}>{m} m</text>)}
  </svg>
}

/** Animation clock: ms into the current cycle, updated every frame. */
function useCycle() {
  const [t, setT] = useState<number | null>(null)
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    let frame = 0
    const tick = (now: number) => {
      setT(now % cycleMs)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])
  return t
}
