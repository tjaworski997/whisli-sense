import { ArrowDown, ArrowUp, Droplets, Settings, Sun, Thermometer, TriangleAlert, type LucideIcon } from "lucide-react"

import { IconTile, Muted, PageHeader } from "@/components/page"
import { RadarView } from "@/components/radar-view"
import { SoundButton } from "@/components/sound-button"
import { Sparkline } from "@/components/sparkline"
import { WifiSignal } from "@/components/wifi-signal"
import { useDevice, type Sample } from "@/hooks/use-device"
import { useRadarBeeps } from "@/hooks/use-radar-sound"
import { useI18n, type TranslationKey } from "@/i18n"
import { duration, kb, meters, number } from "@/lib/format"
import { pageHash } from "@/lib/route"
import { cn } from "@/lib/utils"
import type { DeviceState, ExtremesPeriod } from "@/types"

export function StartPage() {
  const { t, code, locale } = useI18n()
  const { state, history } = useDevice()
  useRadarBeeps(state?.presence === 1 ? state.distance : -1)
  if (!state) return <Muted>{t("app.connecting")}</Muted>

  const known = state.presence >= 0
  const present = state.presence === 1
  const series = (key: keyof Omit<Sample, "presence">) => history.map(sample => sample[key])

  return <>
    <PageHeader title={state.name} description={t("start.description")}
      actions={<WifiSignal rssi={state.rssi} ip={state.ip} className="whisli-card px-3 py-2" />} />

    {state.problems.length > 0 && <div role="alert" className="whisli-card mt-6 flex gap-3 p-4">
      <TriangleAlert className="whisli-status-error size-5 shrink-0" />
      <div>
        <p className="font-medium">{t("start.problems")}</p>
        <ul className="whisli-muted mt-1 list-disc pl-4">{state.problems.map(problem => <li key={problem}>{code("problem", problem)}</li>)}</ul>
      </div>
    </div>}

    <section className="whisli-card mt-6 grid gap-6 p-5 md:grid-cols-[minmax(0,340px)_1fr] md:items-center">
      <RadarView distanceCm={present ? state.distance : -1} zone={state.radar.loaded ? [state.radar.minGate, state.radar.maxGate] : undefined} label={t("start.radarView")} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="whisli-muted">{t("start.presence")}</p>
          {/* Icon-only buttons of one size; the label is in the tooltip and for screen readers */}
          <div className="-mr-2 ml-auto flex items-center gap-1">
            <SoundButton />
            <a href={pageHash("radarSettings")} aria-label={t("start.radarSettings")} title={t("start.radarSettings")}
              className="whisli-button whisli-button-ghost size-8 justify-center px-0">
              <Settings className="size-4" />
            </a>
          </div>
        </div>
        <p className={cn("mt-1 text-4xl font-semibold", present && "whisli-status-ok")}>
          {!known ? "—" : present ? t("start.present") : t("start.empty")}
        </p>
        <p className="whisli-muted mt-2">{t("start.distance")}: <b className="text-[var(--ink)]">{present && state.distance >= 0 ? meters(state.distance, locale) : "—"}</b></p>
        <div className="mt-5 flex h-4 gap-px" title={t("start.timeline")}>
          {history.map((sample, i) => <span key={i} className={cn("flex-1 rounded-[1px]", sample.presence === 1 ? "bg-[var(--status-ok)]" : "whisli-raised")} />)}
        </div>
        <p className="whisli-muted mt-1 text-xs">{t("start.timeline")}</p>
      </div>
    </section>

    <div className="mt-4 grid gap-4 md:grid-cols-3">
      <Metric icon={Thermometer} label={t("start.temperature")} value={number(state.temperature, 1, locale)} unit="°C" series={series("temperature")} />
      <Metric icon={Droplets} label={t("start.humidity")} value={number(state.humidity, 0, locale)} unit="%" series={series("humidity")} />
      <Metric icon={Sun} label={t("start.light")} value={number(state.lux, 0, locale)} unit="lx" series={series("lux")} />
    </div>

    {state.extremes && <div className="mt-4 grid gap-4 md:grid-cols-3">
      <ExtremesCard icon={Thermometer} label={t("start.temperature")} extremes={state.extremes} metric="temperature" digits={1} unit="°C" />
      <ExtremesCard icon={Droplets} label={t("start.humidity")} extremes={state.extremes} metric="humidity" digits={0} unit="%" />
      <ExtremesCard icon={Sun} label={t("start.light")} extremes={state.extremes} metric="lux" digits={0} unit="lx" />
    </div>}

    <DeviceCard state={state} />
  </>
}

function Metric({ icon, label, value, unit, series }: { icon: LucideIcon; label: string; value: string; unit: string; series: (number | null)[] }) {
  return <div className="whisli-card p-5">
    <div className="flex items-start gap-4">
      <IconTile icon={icon} />
      <div>
        <p className="whisli-muted">{label}</p>
        <p className="mt-1 text-3xl font-semibold">{value}<span className="whisli-muted ml-1 text-base font-normal">{unit}</span></p>
      </div>
    </div>
    <div className="mt-4"><Sparkline values={series} /></div>
  </div>
}

const PERIODS: ExtremesPeriod[] = ["day", "week", "month"]

function ExtremesCard({ icon: Icon, label, extremes, metric, digits, unit }: {
  icon: LucideIcon
  label: string
  extremes: NonNullable<DeviceState["extremes"]>
  metric: "temperature" | "humidity" | "lux"
  digits: number
  unit: string
}) {
  const { t, locale } = useI18n()
  const value = (v: number | null) => number(v, digits, locale)
  // Subgrid: the header row is shared by all cards, so it takes the height of the tallest header
  return <div className="whisli-card row-span-2 grid grid-rows-subgrid gap-4 p-5">
    <p className="whisli-muted flex items-start gap-2"><Icon className="mt-0.5 size-4 shrink-0" />{label} ({unit}) · {t("start.extremes").toLowerCase()}</p>
    <div className="grid grid-cols-3 gap-3">
      {PERIODS.map(period => <div key={period} className="min-w-0">
        <p className="whisli-muted text-xs">{t(`start.period.${period}`)}</p>
        <p className="mt-1 flex items-center gap-1 font-semibold tabular-nums" title={t("start.max")}>
          <ArrowUp className="whisli-muted size-3.5 shrink-0" aria-label={t("start.max")} />{value(extremes[period][`${metric}Max`])}
        </p>
        <p className="flex items-center gap-1 tabular-nums" title={t("start.min")}>
          <ArrowDown className="whisli-muted size-3.5 shrink-0" aria-label={t("start.min")} />{value(extremes[period][`${metric}Min`])}
        </p>
      </div>)}
    </div>
  </div>
}

function DeviceCard({ state }: { state: DeviceState }) {
  const { t, locale } = useI18n()
  const items: [string, string, string?][] = [
    [t("diagnostics.uptime"), duration(state.uptime)],
    [t("start.wifi"), state.rssi ? `${state.rssi} dBm` : "—", state.ip],
    ["MQTT", t(`mqtt.state.${state.mqtt}` as TranslationKey)],
    [t("start.clock"), state.clock ? new Date(state.clock * 1000).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : t("start.noClock")],
    [t("diagnostics.heap"), state.heap ? kb(state.heap) : "—"],
    [t("start.mac"), state.mac ?? "—"],
  ]
  return <section className="whisli-card mt-4 p-5">
    <p className="whisli-muted">{t("start.device")}</p>
    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
      {items.map(([label, value, detail]) => <div key={label} className="min-w-0">
        <dt className="whisli-muted text-xs">{label}</dt>
        <dd className="mt-0.5 break-all font-medium tabular-nums">{value}</dd>
        {detail && <dd className="whisli-muted truncate text-xs tabular-nums">{detail}</dd>}
      </div>)}
    </dl>
  </section>
}
