import { Activity, ArrowRight, Clock, Cpu, Download, MemoryStick, Radar, Send, Sun, Thermometer, TriangleAlert, Wifi, type LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "@/components/button"
import { IconTile, InfoList, Muted, PageHeader, Section, Status } from "@/components/page"
import { WifiSignal } from "@/components/wifi-signal"
import { useDevice } from "@/hooks/use-device"
import { useFetch } from "@/hooks/use-fetch"
import { useI18n, type TranslationKey } from "@/i18n"
import { getJson } from "@/lib/api"
import { duration, kb } from "@/lib/format"
import { pageHash } from "@/lib/route"
import { cn } from "@/lib/utils"
import { useLogText } from "@/pages/logs-page"
import type { Diagnostics, LogResponse, SensorDiagnostics } from "@/types"

const hex = (address: number) => `0x${address.toString(16).toUpperCase().padStart(2, "0")}`
const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`

/** Everything the sensor knows about itself, refreshed every 2 s, plus the latest events. */
export function DiagnosticsPage() {
  const { t, code } = useI18n()
  const { state } = useDevice()
  const { data } = useFetch<Diagnostics>("/api/v1/diagnostics", 2000)
  const { data: logs } = useFetch<LogResponse>("/api/v1/logs?limit=8", 5000)
  const text = useLogText()
  if (!data) return <Muted>{t("app.connecting")}</Muted>
  const { radar, system, network, mqtt } = data
  const problems = state?.problems ?? []

  return <>
    <PageHeader eyebrow={t("nav.system")} title={t("nav.diagnostics")} description={t("diagnostics.description")}
      actions={<Button variant="ghost" onClick={() => void downloadReport(state?.name ?? "sensor")}><Download className="size-4" />{t("diagnostics.report")}</Button>} />

    {system && <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Tile icon={Clock} label={t("diagnostics.uptime")} value={duration(system.uptime)} detail={code("resetReason", system.resetReason)} />
      <Tile icon={MemoryStick} label={t("diagnostics.heap")} value={kb(system.heap)} detail={t("diagnostics.heapDetail", { min: kb(system.minHeap), total: kb(system.heapTotal) })}
        bar={1 - system.heap / system.heapTotal} />
      <Tile icon={Wifi} label="Wi-Fi" value={network?.rssi ? `${network.rssi} dBm` : "—"} detail={network?.ssid ?? ""} />
      <Tile icon={TriangleAlert} label={t("diagnostics.problems")} value={String(problems.length)}
        detail={problems.length ? problems.map(p => code("problem", p)).join(" · ") : t("diagnostics.noProblems")} bad={problems.length > 0} />
    </div>}

    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      {system && <Card icon={Cpu} title={system.chip} subtitle={t("diagnostics.system")} ok status={t("diagnostics.ok")}>
        <InfoList rows={[
          [t("diagnostics.firmware"), system.version],
          [t("diagnostics.sdk"), system.sdk],
          [t("diagnostics.cpu"), `${system.cpuMhz} MHz · rev ${system.chipRevision}`],
          [t("diagnostics.flash"), `${kb(system.firmwareSize)} / ${kb(system.firmwareSpace)} · ${mb(system.flash)}`],
          [t("diagnostics.maxBlock"), kb(system.maxBlock)],
          [t("diagnostics.loop"), t("diagnostics.loopValue", { perSecond: system.loopPerSecond, average: system.loopAverageUs, max: (system.loopMaxUs / 1000).toFixed(1) })],
        ]} />
      </Card>}

      {network && <Card icon={Wifi} title="Wi-Fi" subtitle={network.ssid || t("network.noWifi")} ok={network.connected}
        status={t(network.connected ? "network.connected" : "network.notConnected")}>
        <InfoList rows={[
          [t("network.signal"), <WifiSignal key="s" rssi={network.rssi} />],
          [t("network.ip"), network.ip ?? "—"],
          [t("diagnostics.gateway"), network.gateway ? `${network.gateway} · ${network.subnet}` : "—"],
          ["DNS", network.dns ?? "—"],
          ["BSSID", network.bssid ? `${network.bssid} · ${t("network.channel")} ${network.channel}` : "—"],
          [t("network.address"), `${network.hostname}.local`],
          [t("start.mac"), network.mac],
          [t("diagnostics.connectedFor"), network.connectedFor !== undefined ? duration(network.connectedFor) : "—"],
          [t("diagnostics.disconnects"), String(network.disconnects)],
          [t("network.ap"), t(network.ap ? "network.apOn" : "network.apOff")],
        ]} />
      </Card>}

      <Card icon={Radar} title={t("diagnostics.radar")} subtitle="HMMD · UART" ok={radar.working} status={t(radar.working ? "diagnostics.ok" : "diagnostics.noData")}>
        <InfoList rows={[
          [t("diagnostics.radarFirmware"), radar.firmware || "—"],
          [t("diagnostics.framesPerSecond"), radar.framesPerSecond !== undefined ? String(radar.framesPerSecond) : "—"],
          [t("diagnostics.frames"), radar.frames.toLocaleString()],
          [t("diagnostics.lastFrame"), radar.lastFrameMs === undefined ? "—" : `${(radar.lastFrameMs / 1000).toFixed(1)} s`],
          [t("diagnostics.presenceChanges"), radar.presenceChanges !== undefined ? String(radar.presenceChanges) : "—"],
          [t("diagnostics.acks"), `${radar.acks} / ${radar.badFrames}`],
          [t("diagnostics.bytes"), radar.bytes.toLocaleString()],
          [t("diagnostics.outPin"), radar.outPin ? "HIGH" : "LOW"],
          [t("diagnostics.settings"), t(radar.settingsLoaded ? "diagnostics.settingsRead" : "diagnostics.settingsNotRead")],
          ...(radar.error ? [[t("diagnostics.lastError"), code("error", radar.error)] as [string, string]] : []),
        ]} />
      </Card>

      {mqtt && <Card icon={Send} title="MQTT" subtitle={mqtt.host ? `${mqtt.host}:${mqtt.port}` : t("mqtt.state.disabled")}
        ok={mqtt.state === "connected" || mqtt.state === "disabled"} status={t(`mqtt.state.${mqtt.state}` as TranslationKey)}>
        <InfoList rows={[
          [t("mqtt.baseTopic"), mqtt.base],
          [t("diagnostics.published"), mqtt.published.toLocaleString()],
          [t("diagnostics.connects"), String(mqtt.connects)],
          ...(mqtt.error ? [[t("diagnostics.lastError"), code("mqttError", mqtt.error)] as [string, string]] : []),
        ]} />
      </Card>}

      <SensorCard icon={Thermometer} title="SHT30" subtitle={t("diagnostics.sht30")} sensor={data.sht30} />
      <SensorCard icon={Sun} title="BH1750" subtitle={t("diagnostics.bh1750")} sensor={data.bh1750} />
    </div>

    <Section title={t("diagnostics.recentEvents")} actions={<a href={pageHash("logs")} className="whisli-link inline-flex items-center gap-1 text-xs">{t("diagnostics.allEvents")}<ArrowRight className="size-3.5" /></a>}>
      {!logs?.entries.length ? <Muted className="mt-3">{t("logs.empty")}</Muted> : <ol className="mt-3 grid gap-1.5">
        {[...logs.entries].reverse().map(entry => <li key={entry.id} className="flex items-baseline gap-3">
          <Activity className={cn("size-3.5 shrink-0 self-center", entry.level === "error" ? "whisli-status-error" : entry.level === "warning" ? "text-[#d97706]" : "whisli-muted")} />
          <span className="min-w-0 flex-1 truncate">{text(entry)}</span>
          <span className="whisli-muted shrink-0 text-xs">{t(`logs.category.${entry.category}` as TranslationKey)}</span>
        </li>)}
      </ol>}
    </Section>
  </>
}

/** Diagnostics, live state, system info and the whole event log as one JSON file, e.g. for a bug report. */
async function downloadReport(name: string) {
  const [diagnostics, state, logs] = await Promise.all([
    getJson("/api/v1/diagnostics").catch(() => null),
    getJson("/api/v1/state").catch(() => null),
    getJson("/api/v1/logs?limit=120").catch(() => null),
  ])
  const report = { created: new Date().toISOString(), diagnostics, state, logs }
  const link = document.createElement("a")
  link.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }))
  link.download = `whisli-sense-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`
  link.click()
  URL.revokeObjectURL(link.href)
}

function Tile({ icon, label, value, detail, bar, bad = false }: { icon: LucideIcon; label: string; value: string; detail: string; bar?: number; bad?: boolean }) {
  return <div className="whisli-card flex items-start gap-4 p-5">
    <IconTile icon={icon} className={cn(bad && "whisli-status-error")} />
    <div className="min-w-0 flex-1">
      <p className="whisli-muted">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold", bad && "whisli-status-error")}>{value}</p>
      <p className="whisli-muted truncate text-xs" title={detail}>{detail}</p>
      {bar !== undefined && <div className="whisli-raised mt-2 h-1.5 overflow-hidden rounded-full">
        <div className="h-full rounded-full bg-[var(--status-ok)]" style={{ width: `${Math.min(Math.max(bar, 0), 1) * 100}%` }} />
      </div>}
    </div>
  </div>
}

function SensorCard({ icon, title, subtitle, sensor }: { icon: LucideIcon; title: string; subtitle: string; sensor: SensorDiagnostics }) {
  const { t, code } = useI18n()
  return <Card icon={icon} title={title} subtitle={subtitle} ok={sensor.valid} status={t(sensor.valid ? "diagnostics.ok" : sensor.found ? "diagnostics.error" : "diagnostics.missing")}>
    <InfoList rows={[
      [t("diagnostics.address"), sensor.found ? hex(sensor.address) : "—"],
      [t("diagnostics.readsErrors"), `${sensor.reads} / ${sensor.errors}`],
      ...(sensor.lastError ? [[t("diagnostics.lastError"), code("sensorError", sensor.lastError)] as [string, string]] : []),
    ]} />
  </Card>
}

function Card({ icon, title, subtitle, ok, status, children }: { icon: LucideIcon; title: string; subtitle: string; ok: boolean; status: string; children: ReactNode }) {
  return <div className="whisli-card p-5">
    <div className="flex items-start gap-3">
      <IconTile icon={icon} />
      <div className="min-w-0 flex-1"><p className="font-medium">{title}</p><p className="whisli-muted truncate">{subtitle}</p></div>
      <Status ok={ok}>{status}</Status>
    </div>
    <div className="mt-4">{children}</div>
  </div>
}
