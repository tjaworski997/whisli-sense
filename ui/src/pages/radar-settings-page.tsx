import { Crosshair } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/button"
import { MessageBox } from "@/components/message-box"
import { AutoSaveInput, Field, Message, Muted, PageHeader, Section } from "@/components/page"
import { RadarView } from "@/components/radar-view"
import { SoundButton } from "@/components/sound-button"
import { useDevice } from "@/hooks/use-device"
import { useRadarBeeps } from "@/hooks/use-radar-sound"
import { useI18n } from "@/i18n"
import { post, type ApiParams } from "@/lib/api"
import { gateRange, meters } from "@/lib/format"
import { pageHash } from "@/lib/route"
import { cn } from "@/lib/utils"
import { GATE_CM, GATES, type DeviceState } from "@/types"

const gates = Array.from({ length: GATES }, (_, g) => g)
const maxThreshold = 65535
// Log scale 10…65535: near gates have energy in the thousands, far ones in the tens
const scale = (v: number) => `${Math.min(Math.max((Math.log10(Math.max(v, 10)) - 1) / (Math.log10(maxThreshold) - 1), 0), 1) * 100}%`

/** Saves radar settings (written in the background; "busy" in the live state until done). */
function useRadarSave() {
  const { t, code } = useI18n()
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  async function save(params: ApiParams, okText = t("radar.sent")) {
    setMessage(null)
    const result = await post("/api/v1/radar", params)
    setMessage(result.ok ? { ok: true, text: okText } : { ok: false, text: code("error", result.error) })
  }
  return { save, message }
}

/** Range and sensitivity on one page: the zone limits decide which gates the thresholds apply to. */
export function RadarSettingsPage() {
  const { t } = useI18n()
  const { state } = useDevice()
  if (!state) return <Muted>{t("app.connecting")}</Muted>

  return <>
    <PageHeader eyebrow={t("nav.radar")} title={t("nav.radarSettings")} description={t("radarSettings.description")} />
    {!state.radar.loaded
      ? <Muted className="mt-6">{t("radar.reading")}</Muted>
      : <>
        <RangeSection state={state} />
        <SensitivitySection state={state} />
        <Section title={t("nav.calibration")} description={t("radarSettings.calibrationHint")}>
          <a href={pageHash("calibration")} className="whisli-button mt-4"><Crosshair className="size-4" />{t("radarSettings.calibrate")}</a>
        </Section>
      </>}
  </>
}

function RangeSection({ state }: { state: DeviceState }) {
  const { t, locale } = useI18n()
  const { save, message } = useRadarSave()
  const radar = state.radar
  useRadarBeeps(state.presence === 1 ? state.distance : -1)

  return <Section title={t("range.zone")} description={t("range.zoneHint")} className="mt-6">
    <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="grid max-w-xl content-start gap-4 sm:grid-cols-2">
        <Field label={t("range.from")}>
          <select className="whisli-select" value={radar.minGate} disabled={radar.busy} onChange={event => void save({ minGate: event.target.value })}>
            {gates.filter(g => g <= radar.maxGate).map(g => <option key={g} value={g}>{meters(g * GATE_CM, locale)}</option>)}
          </select>
        </Field>
        <Field label={t("range.to")}>
          <select className="whisli-select" value={radar.maxGate} disabled={radar.busy} onChange={event => void save({ maxGate: event.target.value })}>
            {gates.filter(g => g >= radar.minGate).map(g => <option key={g} value={g}>{meters((g + 1) * GATE_CM, locale)}</option>)}
          </select>
        </Field>
        <Field label={t("range.delay")} hint={t("range.delayHint")} className="sm:col-span-2">
          <AutoSaveInput type="number" min={0} max={600} value={radar.delay} disabled={radar.busy} className="w-32"
            onSave={value => void save({ delay: value })} />
        </Field>
        <div className="sm:col-span-2">
          {radar.busy && <p className="whisli-muted text-xs">{t("radar.writing")}</p>}
          <Message message={message} />
        </div>
      </div>
      <div className="relative justify-self-center">
        <div className="absolute top-0 right-0"><SoundButton /></div>
        <RadarView round distanceCm={state.presence === 1 ? state.distance : -1} zone={[radar.minGate, radar.maxGate]} label={t("start.radarView")} />
      </div>
    </div>
  </Section>
}

// Each gate's line is a slider on the same log scale as the bar: position 0…1000 ↔ threshold 10…65535
const sliderSteps = 1000
const logSpan = Math.log10(maxThreshold) - 1
const toSlider = (v: number) => Math.round((Math.log10(Math.max(v, 10)) - 1) / logSpan * sliderSteps)
const fromSlider = (position: number) => Math.min(Math.round(10 ** (1 + position / sliderSteps * logSpan)), maxThreshold)

/**
 * One line per gate: the presence threshold (the radar's "hold"; firmware keeps "trigger" 1.5× above).
 * Only gates inside the detection range are listed. Dragging a line previews it; Save sends the changes.
 */
function SensitivitySection({ state }: { state: DeviceState }) {
  const { t, locale } = useI18n()
  const { save, message } = useRadarSave()
  // gate → threshold being dragged or written; kept until the radar reports it, so the line never jumps back
  const [draft, setDraft] = useState<Record<number, number>>({})
  const [confirmFactory, setConfirmFactory] = useState(false)
  const radar = state.radar
  const noise = state.calibration.noise
  const hasNoise = noise.some(v => v > 0)
  const target = state.presence === 1 && state.distance >= 0 ? Math.floor(state.distance / GATE_CM) : -1
  const inRange = gates.filter(g => g >= radar.minGate && g <= radar.maxGate)

  const threshold = (g: number) => draft[g] ?? radar.hold[g]

  useEffect(() => {
    const written = Object.keys(draft).map(Number).filter(g => radar.hold[g] === draft[g])
    if (written.length) setDraft(all => Object.fromEntries(Object.entries(all).filter(([g]) => !written.includes(Number(g)))))
  }, [radar.hold.join(), draft])

  // Saved when the line is let go (mouse, touch or keyboard), not on every step of the drag
  function commit(g: number) {
    if (draft[g] !== undefined && draft[g] !== radar.hold[g]) void save({ [`p${g}`]: draft[g] }, t("sensitivity.saved"))
  }

  return <>
    <Section title={t("sensitivity.title")} description={t("sensitivity.description")}
      actions={<Button variant="ghost" disabled={radar.busy} onClick={() => setConfirmFactory(true)}>{t("sensitivity.factory")}</Button>}>
      {!radar.working && <p className="whisli-status-error mt-3 text-xs">{t("sensitivity.noEnergy")}</p>}

      {/* py-2 leaves room for the threshold handles, which stick out of the bars; no vertical scrollbar */}
      <div className="mt-3 overflow-x-auto overflow-y-hidden py-2">
        <div className="grid min-w-[440px] grid-cols-[7rem_minmax(8rem,1fr)_4rem_4rem] items-center gap-x-3 gap-y-3">
          <span className="whisli-muted text-xs">{t("sensitivity.gate")}</span>
          <span className="whisli-muted flex justify-between text-xs"><span>{t("sensitivity.more")}</span><span>{t("sensitivity.less")}</span></span>
          <span className="whisli-muted text-right text-xs">{t("sensitivity.energy")}</span>
          <span className="whisli-muted text-right text-xs">{t("sensitivity.threshold")}</span>
          {inRange.map(g => {
            const energy = radar.energy[g]
            const line = threshold(g)
            return <div key={g} className="contents">
              <span className={cn("text-xs tabular-nums", g === target && "whisli-status-ok font-medium")}>{gateRange(g, locale)}</span>
              <span className="relative">
                <span className="gate-track block">
                  <span className={cn("gate-bar", energy >= line && "gate-bar-on")} style={{ width: scale(energy) }} />
                  {hasNoise && <span className="gate-mark gate-mark-noise" style={{ left: scale(noise[g]) }} />}
                </span>
                <input type="range" className="gate-slider" min={0} max={sliderSteps} value={toSlider(line)}
                  aria-label={`${t("sensitivity.threshold")} ${gateRange(g, locale)}`}
                  onChange={event => setDraft({ ...draft, [g]: fromSlider(Number(event.target.value)) })}
                  onPointerUp={() => commit(g)} onKeyUp={() => commit(g)} />
              </span>
              <span className="text-right font-mono text-xs">{energy}</span>
              <span className={cn("text-right font-mono text-xs", line !== radar.hold[g] && "whisli-status-ok")}>{line}</span>
            </div>
          })}
        </div>
      </div>

      <p className="whisli-muted mt-4 text-xs">{t("sensitivity.footnote")}{hasNoise && ` ${t("sensitivity.noiseLine")}`}</p>
      {radar.busy && <p className="whisli-muted mt-3 text-xs">{t("radar.writing")}</p>}
      <Message message={message} />
    </Section>

    <MessageBox open={confirmFactory} title={t("sensitivity.factoryTitle")} message={t("sensitivity.factoryMessage")}
      confirmLabel={t("sensitivity.factory")} cancelLabel={t("common.cancel")}
      onClose={() => setConfirmFactory(false)}
      onConfirm={() => { setConfirmFactory(false); setDraft({}); void save({ factory: 1 }, t("sensitivity.factoryDone")) }} />
  </>
}
