import { ExternalLink, Network, Table2, Thermometer, TriangleAlert, Users, Wifi, type LucideIcon } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"

import { IconTile, Muted, PageHeader, Status } from "@/components/page"
import { WifiSignal } from "@/components/wifi-signal"
import { useFetch } from "@/hooks/use-fetch"
import { useFleet, type FleetMember } from "@/hooks/use-fleet"
import { useI18n } from "@/i18n"
import { meters, number } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Summary, WifiStatus } from "@/types"

const staleMs = 25000 // summaries arrive every 10 s
const viewKey = "whisli-sense.sensorsView"
type View = "graph" | "table"

/** A member with its summary only while it is fresh; null = offline or no data yet */
type Sensor = FleetMember & { live: Summary | null }

export function SensorsPage() {
  const { t, locale } = useI18n()
  const members = useFleet()
  const now = useNow()
  const [view, setView] = useView()
  const sensors: Sensor[] = members.map(m => ({ ...m, live: m.summary && now - m.receivedAt < staleMs ? m.summary : null }))
  const online = sensors.filter(s => s.live)
  const present = online.filter(s => s.live!.presence === 1)
  const temperatures = online.flatMap(s => s.live!.temperature ?? [])
  const average = temperatures.length ? temperatures.reduce((a, b) => a + b, 0) / temperatures.length : null

  return <>
    <PageHeader title={t("sensors.title")} description={t("sensors.description")} />
    {members.length === 0
      ? <Muted className="mt-6">{t("sensors.searching")}</Muted>
      : <>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <Stat icon={Wifi} label={t("sensors.online")} value={`${online.length}`} of={`/ ${members.length}`} />
          <Stat icon={Users} label={t("sensors.presentIn")} value={`${present.length}`}
            detail={present.map(s => s.name).join(", ") || t("sensors.nobody")} />
          <Stat icon={Thermometer} label={t("sensors.averageTemperature")} value={number(average, 1, locale)} of="°C" />
        </div>
        <div className="whisli-card mt-6 inline-flex p-0.5" role="group" aria-label={t("sensors.view")}>
          {([["graph", Network, "sensors.graph"], ["table", Table2, "sensors.table"]] as const).map(([value, Icon, label]) =>
            <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)}
              className={cn("inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs", view === value ? "whisli-nav-active" : "whisli-nav")}>
              <Icon className="size-4" />{t(label)}
            </button>)}
        </div>
        {view === "graph" ? <Graph sensors={sensors} /> : <Table sensors={sensors} />}
      </>}
  </>
}

function useView(): [View, (view: View) => void] {
  const [view, setView] = useState<View>(() => {
    try { return localStorage.getItem(viewKey) === "table" ? "table" : "graph" } catch { return "graph" }
  })
  return [view, next => {
    setView(next)
    try { localStorage.setItem(viewKey, next) } catch { /* not remembered */ }
  }]
}

function Stat({ icon, label, value, of, detail }: { icon: LucideIcon; label: string; value: string; of?: string; detail?: string }) {
  return <div className="whisli-card flex items-start gap-4 p-5">
    <IconTile icon={icon} />
    <div className="min-w-0">
      <p className="whisli-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}{of && <span className="whisli-muted ml-1 text-sm font-normal">{of}</span>}</p>
      {detail && <p className="whisli-muted truncate text-xs">{detail}</p>}
    </div>
  </div>
}

/** Link strength from dBm: 0 = offline / unknown … 1 = excellent */
const strength = (rssi?: number) => !rssi ? 0 : Math.min(Math.max((rssi + 90) / 40, 0.1), 1)

type Segment = [number, number, number, number] // x1, y1, x2, y2: always horizontal or vertical
/** Shared wiring (trunk, row buses) and one drop per sensor card */
type Wiring = { shared: Segment[]; drops: { ip: string; segment: Segment; k: number }[] }

/**
 * Lays the wires like an org chart, through the gaps only: from the hub down to a bus above the
 * first row, a trunk down the gap between two columns, a bus above every row, a short drop to each card.
 * Each wire is drawn from the hub outwards, so the flowing dashes move towards the sensors.
 */
function wire(box: DOMRect, hub: DOMRect, cards: { ip: string; rect: DOMRect; k: number }[]): Wiring {
  const local = cards.map(c => ({ ...c, x: c.rect.left + c.rect.width / 2 - box.left, top: c.rect.top - box.top, left: c.rect.left - box.left, right: c.rect.right - box.left }))
  const rows = [...new Set(local.map(c => Math.round(c.top)))].sort((a, b) => a - b)
  if (!rows.length) return { shared: [], drops: [] }
  const hx = hub.left + hub.width / 2 - box.left, hy = hub.bottom - box.top
  const busY = (row: number, i: number) => i === 0 ? (hy + row) / 2 : row - 8 // rows are 16 px apart

  // The trunk runs in the gap of the first row closest to the hub; with one column, left of the cards
  const first = local.filter(c => Math.round(c.top) === rows[0]).sort((a, b) => a.left - b.left)
  const gaps = first.slice(1).map((c, i) => (first[i].right + c.left) / 2)
  const trunkX = gaps.length ? gaps.reduce((best, g) => Math.abs(g - hx) < Math.abs(best - hx) ? g : best) : first[0].left - 10

  // One column (phone): a trunk on the left and a short branch into each card, like a file tree
  if (!gaps.length) {
    const branchY = (c: typeof local[number]) => c.top + 20 // level with the sensor name
    const last = local.reduce((a, c) => c.top > a.top ? c : a)
    return {
      shared: [[hx, hy, hx, busY(rows[0], 0)], [hx, busY(rows[0], 0), trunkX, busY(rows[0], 0)], [trunkX, busY(rows[0], 0), trunkX, branchY(last)]],
      drops: local.map(c => ({ ip: c.ip, segment: [trunkX, branchY(c), c.left, branchY(c)], k: c.k })),
    }
  }

  const shared: Segment[] = [[hx, hy, hx, busY(rows[0], 0)]]
  if (rows.length > 1) shared.push([trunkX, busY(rows[0], 0), trunkX, busY(rows[rows.length - 1], rows.length - 1)])
  const drops: Wiring["drops"] = []
  rows.forEach((row, i) => {
    const y = busY(row, i)
    const xs = local.filter(c => Math.round(c.top) === row).map(c => c.x)
    const junction = i === 0 ? hx : trunkX
    const needs = i === 0 && rows.length > 1 ? [...xs, trunkX] : xs
    const left = Math.min(...needs), right = Math.max(...needs)
    if (left < junction) shared.push([junction, y, left, y])
    if (right > junction) shared.push([junction, y, right, y])
    for (const c of local.filter(c => Math.round(c.top) === row)) drops.push({ ip: c.ip, segment: [c.x, y, c.x, c.top], k: c.k })
  })
  return { shared, drops }
}

const path = ([x1, y1, x2, y2]: Segment) => `M${x1},${y1} L${x2},${y2}`

/** The Wi-Fi network on top and the sensors as cards in a responsive grid below, wired like an org chart. */
function Graph({ sensors }: { sensors: Sensor[] }) {
  const { t } = useI18n()
  const { data: wifi } = useFetch<WifiStatus>("/api/v1/wifi")
  const box = useRef<HTMLDivElement>(null)
  const hub = useRef<HTMLDivElement>(null)
  const cards = useRef<Record<string, HTMLElement | null>>({})
  const [wiring, setWiring] = useState<Wiring>({ shared: [], drops: [] })
  const signature = sensors.map(s => `${s.ip}:${s.live?.rssi ?? 0}`).join()

  useLayoutEffect(() => {
    const measure = () => {
      if (!box.current || !hub.current) return
      const laidOut = sensors.flatMap(s => {
        const rect = cards.current[s.ip]?.getBoundingClientRect()
        return rect ? [{ ip: s.ip, rect, k: strength(s.live?.rssi) }] : []
      })
      setWiring(wire(box.current.getBoundingClientRect(), hub.current.getBoundingClientRect(), laidOut))
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (box.current) observer.observe(box.current)
    return () => observer.disconnect()
  }, [signature])

  return <section ref={box} className="relative mt-4">
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
      {/* Thin tracks with flowing dashes; on a drop the dashes are faster and stronger with a better signal */}
      {wiring.shared.map((segment, i) => <g key={i}>
        <path d={path(segment)} className="graph-link" />
        <path d={path(segment)} className="graph-flow" style={{ opacity: 0.5 }} />
      </g>)}
      {wiring.drops.map(({ ip, segment, k }) => <g key={ip}>
        <path d={path(segment)} className={k ? "graph-link" : "graph-link graph-link-off"} />
        {k > 0 && <path d={path(segment)} className="graph-flow" style={{ opacity: 0.4 + 0.6 * k, animationDuration: `${(1.6 - k).toFixed(2)}s` }} />}
      </g>)}
    </svg>

    <div className="relative flex justify-center">
      <div ref={hub} className="whisli-card flex items-center gap-3 rounded-full px-4 py-2">
        <Wifi className="size-4" />
        <span className="font-medium">Wi-Fi</span>
        <span className="whisli-muted text-xs">{wifi?.wifi.ssid ?? ""}</span>
      </div>
    </div>

    <div className="relative mt-16 grid gap-4 max-sm:pl-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {sensors.map(s => <NodeCard key={s.ip} sensor={s} innerRef={el => { cards.current[s.ip] = el }} />)}
    </div>
    <p className="whisli-muted relative mt-3 text-xs">{t("sensors.graphHint")}</p>
  </section>
}

/** Presence: a pulsing blue dot (steady when the system asks for reduced motion); grey when empty */
function PresenceDot({ on }: { on: boolean }) {
  return <span className="relative flex size-2 shrink-0">
    {on && <span className="absolute inline-flex size-full rounded-full bg-[var(--status-ok)] opacity-75 motion-safe:animate-ping" />}
    <span className={cn("relative inline-flex size-2 rounded-full", on ? "bg-[var(--status-ok)]" : "bg-[var(--line)]")} />
  </span>
}

function NodeCard({ sensor: s, innerRef }: { sensor: Sensor; innerRef: (el: HTMLElement | null) => void }) {
  const { t, locale } = useI18n()
  const presence = s.live?.presence ?? -1
  const body = <>
    <div className="flex items-center gap-2">
      <PresenceDot on={presence === 1} />
      <span className="min-w-0 flex-1 truncate font-medium">{s.name}{s.self && <span className="whisli-muted font-normal"> · {t("sensors.thisOne")}</span>}</span>
      {s.live?.problems ? <TriangleAlert className="whisli-status-error size-4 shrink-0" /> : null}
    </div>
    <p className={cn("mt-1 text-xs", presence === 1 ? "whisli-status-ok" : "whisli-muted")}>
      {!s.live ? t("sensors.offline") : presence === 1
        ? `${t("start.present")}${s.live.distance >= 0 ? ` · ${meters(s.live.distance, locale)}` : ""}`
        : presence === 0 ? t("start.empty") : t("sensors.unknown")}
    </p>
    {s.live && <p className="mt-1 text-xs tabular-nums">
      {number(s.live.temperature, 1, locale)} °C · {number(s.live.humidity, 0, locale)} % · {number(s.live.lux, 0, locale)} lx
    </p>}
    <div className="whisli-line mt-2 border-t pt-2">
      <WifiSignal rssi={s.live?.rssi} ip={s.live?.ip || s.ip} />
      {s.live?.mac && <p className="whisli-muted mt-0.5 font-mono text-[11px]">{s.live.mac}</p>}
    </div>
  </>
  // Blue frame = the sensor whose panel this is; red = it reports a problem
  const className = cn("whisli-card block p-3", !s.live && "opacity-60", s.self && "border-[var(--status-ok)]",
    s.live?.problems && "border-[var(--status-error)]")
  return s.self
    ? <div ref={innerRef} className={className}>{body}</div>
    : <a ref={innerRef} href={`http://${s.ip}/`} target="_blank" rel="noreferrer" className={cn(className, "hover:bg-[var(--raised)]")}>{body}</a>
}

function Table({ sensors }: { sensors: Sensor[] }) {
  const { t, locale } = useI18n()
  const head = ["sensors.name", "start.presence", "start.temperature", "start.humidity", "start.light", "Wi-Fi", "start.mac", "sensors.status"] as const
  return <section className="whisli-card mt-4 overflow-x-auto">
    <table className="w-full min-w-[860px] whitespace-nowrap text-left">
      <thead className="whisli-muted text-xs">
        <tr>{head.map(key => <th key={key} className="px-4 py-3 font-normal">{key === "Wi-Fi" ? key : t(key)}</th>)}<th /></tr>
      </thead>
      <tbody>
        {sensors.map(s => {
          const presence = s.live?.presence ?? -1
          return <tr key={s.ip} className={cn("whisli-line border-t", !s.live && "opacity-60")}>
            <td className="px-4 py-3">
              <p className="font-medium">{s.name}{s.self && <span className="whisli-muted font-normal"> · {t("sensors.thisOne")}</span>}</p>
              <p className="whisli-muted font-mono text-xs">{s.host ? `${s.host}.local` : ""}</p>
            </td>
            <td className={cn("px-4 py-3", presence === 1 && "whisli-status-ok font-medium")}>
              {presence === 1 ? `${t("start.present")}${s.live!.distance >= 0 ? ` · ${meters(s.live!.distance, locale)}` : ""}` : presence === 0 ? t("start.empty") : "—"}
            </td>
            <td className="px-4 py-3 tabular-nums">{number(s.live?.temperature, 1, locale)} °C</td>
            <td className="px-4 py-3 tabular-nums">{number(s.live?.humidity, 0, locale)} %</td>
            <td className="px-4 py-3 tabular-nums">{number(s.live?.lux, 0, locale)} lx</td>
            <td className="px-4 py-3"><WifiSignal rssi={s.live?.rssi} ip={s.live?.ip || s.ip} /></td>
            <td className="whisli-muted px-4 py-3 font-mono text-xs">{s.live?.mac ?? "—"}</td>
            <td className="px-4 py-3">{!s.live ? <Status ok={false}>{t("sensors.offline")}</Status>
              : s.live.problems ? <Status ok={false}>{t("sensors.problems", { count: s.live.problems })}</Status> : <Status ok>OK</Status>}</td>
            <td className="px-4 py-3 text-right">
              {!s.self && <a className="whisli-link inline-flex items-center gap-1 text-xs" href={`http://${s.ip}/`} target="_blank" rel="noreferrer">{t("sensors.open")}<ExternalLink className="size-3" /></a>}
            </td>
          </tr>
        })}
      </tbody>
    </table>
  </section>
}

function useNow() {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}
