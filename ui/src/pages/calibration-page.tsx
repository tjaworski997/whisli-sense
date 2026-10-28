import { Check } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/button"
import { Message, Muted, PageHeader, Section } from "@/components/page"
import { RadarView } from "@/components/radar-view"
import { useDevice } from "@/hooks/use-device"
import { useI18n, type TranslationKey } from "@/i18n"
import { post } from "@/lib/api"
import { gateRange, meters } from "@/lib/format"
import { playCue, type Cue } from "@/lib/sound"
import { cn } from "@/lib/utils"
import { GATES, type CalibrationPhase, type DeviceState } from "@/types"

// The sensor times the steps and writes the thresholds itself; this page guides with text, a live
// radar picture and sound.
const plan = { leave: 10, empty: 40, back: 20, still: 20 } // s; about 50 s out of the room
type Step = "leave" | "empty" | "back" | "still"
const steps: Step[] = ["leave", "empty", "back", "still"]
const cues: Partial<Record<CalibrationPhase, Cue>> = { back: "back", still: "still", done: "done" }
const remindBackMs = 8000

export function CalibrationPage() {
  const { t, code } = useI18n()
  const { state } = useDevice()
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const audio = useRef<AudioContext | null>(null)
  const phase = state?.calibration.phase ?? "idle"
  const lastPhase = useRef(phase)

  // A sound at each step (only after Start was clicked here: browsers need a click first)
  useEffect(() => {
    if (lastPhase.current === phase) return
    lastPhase.current = phase
    const cue = cues[phase]
    if (cue && audio.current) playCue(audio.current, cue)
  }, [phase])

  useEffect(() => {
    if (phase !== "back") return
    const timer = window.setInterval(() => audio.current && playCue(audio.current, "back"), remindBackMs)
    return () => window.clearInterval(timer)
  }, [phase])

  if (!state) return <Muted>{t("app.connecting")}</Muted>
  const calibration = state.calibration
  const active = (steps as CalibrationPhase[]).includes(phase)

  async function send(params: Record<string, string | number>, okText?: string) {
    audio.current ??= new AudioContext()
    void audio.current.resume()
    setMessage(null)
    const result = await post("/api/v1/calibration", params)
    if (!result.ok) setMessage({ ok: false, text: code("error", result.error) })
    else if (okText) setMessage({ ok: true, text: okText })
  }

  return <>
    <PageHeader eyebrow={t("nav.radar")} title={t("nav.calibration")} description={t("calibration.description")} />
    {active
      ? <Running state={state} step={phase as Step} onSeated={() => void send({ action: "seated" })} onCancel={() => void send({ action: "cancel" })} />
      : <>
        <Section title={t("calibration.beforeTitle")} className="mt-6">
          <ul className="mt-3 max-w-3xl list-disc space-y-1.5 pl-5">
            {(["calibration.tip1", "calibration.tip2", "calibration.tip3", "calibration.tip4"] as TranslationKey[]).map(key => <li key={key}>{t(key)}</li>)}
          </ul>
        </Section>
        <Section title={t("calibration.stepsTitle")} description={t("calibration.total")}>
          <Steps current={null} />
          <div className="mt-5">
            <Button disabled={!state.radar.loaded || state.radar.busy} onClick={() => void send({ action: "start", ...plan })}>{t("calibration.start")}</Button>
          </div>
        </Section>
      </>}
    {phase === "failed" && <p className="whisli-status-error mt-4">{code("calibrationError", calibration.error)}</p>}
    <Message message={message} />
    {(phase === "done" || (phase === "failed" && calibration.hasPrevious)) && <Result state={state}
      onUndo={() => void send({ action: "undo" }, t("calibration.undone"))} />}
  </>
}

/** The step in progress: live radar, step list, countdown with a progress bar and what to do now. */
function Running({ state, step, onSeated, onCancel }: { state: DeviceState; step: Step; onSeated: () => void; onCancel: () => void }) {
  const { t, locale } = useI18n()
  const calibration = state.calibration
  const total = step === "empty" ? calibration.emptyS : plan[step]
  const done = total ? 1 - calibration.left / total : 1
  const present = state.presence === 1 && state.distance >= 0
  const distance = present ? meters(state.distance, locale) : ""

  // What the radar sees right now, worded for the step
  let seen: { ok: boolean; text: string } | null = null
  if (step === "empty" && present) seen = { ok: false, text: t("calibration.seesSomething", { distance }) }
  if (step === "still") seen = present ? { ok: true, text: t("calibration.seesYou", { distance }) } : { ok: false, text: t("calibration.notSeen") }

  return <section className="whisli-card mt-6 grid gap-6 p-5 md:grid-cols-[minmax(0,300px)_1fr] md:items-start">
    <div className="justify-self-center">
      <RadarView round distanceCm={present ? state.distance : -1} zone={[state.radar.minGate, state.radar.maxGate]} label={t("start.radarView")} />
    </div>
    <div className="min-w-0">
      <div className="flex items-start justify-between gap-3">
        <p className="whisli-muted">{t("calibration.running")}</p>
        <Button variant="ghost" className="-mr-2 h-8 px-2.5 text-xs" onClick={onCancel}>{t("calibration.cancel")}</Button>
      </div>
      <p className="mt-1 text-2xl font-semibold">{t(`calibration.now.${step}` as TranslationKey)}</p>
      <p className="whisli-muted mt-1">{t(`calibration.now.${step}Text` as TranslationKey)}</p>

      <div className="mt-5 flex items-baseline gap-2">
        <span className="text-4xl font-semibold tabular-nums">{calibration.left}</span>
        <span className="whisli-muted">s</span>
      </div>
      <div className="whisli-raised mt-2 h-1.5 overflow-hidden rounded-full">
        <div className="h-full rounded-full bg-[var(--status-ok)] transition-[width] duration-1000 ease-linear" style={{ width: `${Math.min(Math.max(done, 0), 1) * 100}%` }} />
      </div>

      {seen && <p className={cn("mt-4 text-sm", seen.ok ? "whisli-status-ok" : "whisli-status-error")}>{seen.text}</p>}
      {step === "back" && <div className="mt-4"><Button onClick={onSeated}>{t("calibration.seated")}</Button></div>}

      <Steps current={step} />
    </div>
  </section>
}

/** The four steps with their times; the current one highlighted, finished ones ticked. */
function Steps({ current }: { current: Step | null }) {
  const { t } = useI18n()
  const at = current ? steps.indexOf(current) : -1
  return <ol className="mt-5 grid max-w-3xl gap-3">
    {steps.map((step, i) => {
      const finished = i < at
      const now = i === at
      return <li key={step} className={cn("flex gap-3", current && !now && "opacity-60")}>
        <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-xs",
          now ? "bg-[var(--status-ok)] text-[var(--page)]" : "whisli-raised")}>
          {finished ? <Check className="size-3.5" /> : i + 1}
        </span>
        <div className="min-w-0">
          <p className="font-medium">{t(`calibration.step.${step}` as TranslationKey)} <span className="whisli-muted font-normal">· {plan[step]} s</span></p>
          {(!current || now) && <p className="whisli-muted">{t(`calibration.step.${step}Text` as TranslationKey)}</p>}
        </div>
      </li>
    })}
  </ol>
}

function Result({ state, onUndo }: { state: DeviceState; onUndo: () => void }) {
  const { t, locale } = useI18n()
  const { radar, calibration } = state
  const gates = Array.from({ length: GATES }, (_, g) => g)
  const person = gates.filter(g => calibration.personMask & (1 << g))
  const outside = person.filter(g => g < radar.minGate || g > radar.maxGate)

  return <Section title={t(calibration.phase === "done" ? "calibration.doneTitle" : "calibration.previousTitle")}
    actions={calibration.hasPrevious && <Button variant="ghost" disabled={radar.busy} onClick={onUndo}>{t("calibration.undo")}</Button>}>
    {calibration.phase === "done" && (person.length
      ? <p className="mt-3">{t("calibration.foundYou", { gates: person.map(g => gateRange(g, locale)).join(", ") })}</p>
      : <p className="whisli-status-error mt-3">{t("calibration.notFound")}</p>)}
    {outside.length > 0 && <p className="whisli-status-error mt-2">{t("calibration.outside", { gates: outside.map(g => gateRange(g, locale)).join(", ") })}</p>}
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[520px] text-right text-xs">
        <thead className="whisli-muted">
          <tr><th className="py-1 text-left font-normal">{t("sensitivity.gate")}</th><th className="font-normal">{t("calibration.noise")}</th><th className="font-normal">{t("calibration.you")}</th><th className="font-normal">{t("sensitivity.threshold")}</th></tr>
        </thead>
        <tbody className="font-mono">
          {gates.map(g => <tr key={g} className={cn("whisli-line border-t", (g < radar.minGate || g > radar.maxGate) && "opacity-40", calibration.personMask & (1 << g) && "whisli-status-ok")}>
            <td className="py-1 text-left font-sans">{gateRange(g, locale)}</td>
            <td>{calibration.noise[g]}</td>
            <td>{calibration.person[g]}</td>
            <td><s className="whisli-muted mr-2">{calibration.previousHold[g]}</s>{radar.hold[g]}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <p className="whisli-muted mt-3 text-xs">{t("calibration.tableHint")}</p>
  </Section>
}
