import { useEffect, useState } from "react"

import { Field, Message, Section } from "@/components/page"
import { useFetch } from "@/hooks/use-fetch"
import { useI18n, type TranslationKey } from "@/i18n"
import { post, type ApiParams } from "@/lib/api"
import { cn } from "@/lib/utils"

type LedMode = "distance" | "presence" | "status" | "off"
type LedColor = "blue" | "green" | "white" | "purple" | "amber"
interface LedSettings { mode: LedMode; color: LedColor; brightness: number; alerts: boolean; darkOff: boolean }

const modes: LedMode[] = ["distance", "presence", "status", "off"]
// Shown as swatches; roughly what the LED gives at low brightness
const colors: Record<LedColor, string> = { blue: "#2f6bff", green: "#22c55e", white: "#e4e4e7", purple: "#a855f7", amber: "#f59e0b" }

/** The board's status LED. Every change is saved and shown on the LED at once. */
export function LedSection() {
  const { t, code } = useI18n()
  const { data } = useFetch<LedSettings>("/api/v1/led")
  const [led, setLed] = useState<LedSettings | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => { if (data) setLed(data) }, [data])
  if (!led) return null

  async function save(params: ApiParams) {
    const result = await post("/api/v1/led", params)
    if (result.ok) {
      setLed(result.data as unknown as LedSettings)
      setMessage(null)
    } else {
      setMessage({ ok: false, text: code("error", result.error) })
    }
  }
  const usesColor = led.mode === "distance" || led.mode === "presence"

  // Own page (System → Status LED); the page header carries the title and description
  return <Section title={t("led.mode")} className="mt-6">
    <div className="mt-4 grid max-w-3xl gap-5">
      <div className="grid gap-2 sm:grid-cols-2">
        {modes.map(mode => <button key={mode} type="button" aria-pressed={led.mode === mode} onClick={() => void save({ mode })}
          className={cn("whisli-card p-3 text-left", led.mode === mode ? "border-[var(--status-ok)]" : "hover:bg-[var(--raised)]")}>
          <p className={cn("font-medium", led.mode === mode && "whisli-status-ok")}>{t(`led.mode.${mode}` as TranslationKey)}</p>
          <p className="whisli-muted mt-0.5 text-xs">{t(`led.mode.${mode}Hint` as TranslationKey)}</p>
        </button>)}
      </div>

      <div className={cn("grid gap-5 sm:grid-cols-2", !usesColor && "opacity-50")}>
        <Field label={t("led.color")}>
          <div className="flex gap-2" role="radiogroup" aria-label={t("led.color")}>
            {(Object.keys(colors) as LedColor[]).map(color => <button key={color} type="button" role="radio" aria-checked={led.color === color}
              disabled={!usesColor} aria-label={t(`led.color.${color}` as TranslationKey)} title={t(`led.color.${color}` as TranslationKey)}
              onClick={() => void save({ color })}
              className={cn("size-8 rounded-full border-2", led.color === color ? "border-[var(--ink)]" : "border-transparent")}
              style={{ background: colors[color] }} />)}
          </div>
        </Field>
        <Field label={`${t("led.brightness")} · ${led.brightness} %`}>
          <input type="range" min={1} max={100} value={led.brightness} className="w-full accent-[var(--status-ok)]"
            onChange={e => setLed({ ...led, brightness: Number(e.target.value) })}
            onPointerUp={() => void save({ brightness: led.brightness })} onKeyUp={() => void save({ brightness: led.brightness })} />
        </Field>
      </div>

      <div className="grid gap-2">
        <label className="flex items-start gap-2">
          <input className="whisli-check mt-0.5" type="checkbox" checked={led.alerts} onChange={e => void save({ alerts: e.target.checked })} />
          <span>{t("led.alerts")}<span className="whisli-muted block text-xs">{t("led.alertsHint")}</span></span>
        </label>
        <label className="flex items-start gap-2">
          <input className="whisli-check mt-0.5" type="checkbox" checked={led.darkOff} onChange={e => void save({ darkOff: e.target.checked })} />
          <span>{t("led.darkOff")}<span className="whisli-muted block text-xs">{t("led.darkOffHint")}</span></span>
        </label>
      </div>
    </div>
    <Message message={message} />
  </Section>
}
