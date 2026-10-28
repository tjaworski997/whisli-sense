/** Small line chart of the last readings; gaps (null) are skipped. */
export function Sparkline({ values }: { values: (number | null)[] }) {
  const points = values.flatMap((v, i) => v === null ? [] : [[i, v] as const])
  if (points.length < 2) return <div className="h-10" />

  const width = 200, height = 40
  let min = Math.min(...points.map(p => p[1]))
  let max = Math.max(...points.map(p => p[1]))
  if (max - min < 1e-6) { min -= 1; max += 1 }
  const x = (i: number) => i / Math.max(values.length - 1, 1) * width
  const y = (v: number) => height - 3 - (v - min) / (max - min) * (height - 6)
  const line = points.map(([i, v], k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")

  return <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-10 w-full" aria-hidden>
    <path d={line} fill="none" stroke="var(--status-ok)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
  </svg>
}
