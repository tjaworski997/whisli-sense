import { RefreshCw } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/button"
import { Muted, PageHeader } from "@/components/page"
import { useDevice } from "@/hooks/use-device"
import { useI18n, type TranslationKey } from "@/i18n"
import { getJson } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { LogEntry, LogLevel, LogResponse } from "@/types"

const levels: LogLevel[] = ["info", "warning", "error"]
const categories = ["system", "network", "radar", "sensors", "mqtt"]
const levelClass: Record<LogLevel, string> = { info: "whisli-muted", warning: "text-[#d97706]", error: "whisli-status-error" }
const pageSize = 60

/** Text of an entry: the translated code with its detail, or the raw code for one the panel does not know */
export function useLogText() {
  const { t, code } = useI18n()
  return (entry: LogEntry) => {
    const key = `log.${entry.code}` as TranslationKey
    // "boot" carries "<version> · <reset reason code>"; the reason reads better translated
    const [version, reason] = entry.detail.split(" · ")
    const detail = entry.code === "boot" && reason ? `${version} · ${code("resetReason", reason)}` : entry.detail
    const text = t(key, { detail })
    return text === key ? `${entry.code}${entry.detail ? ` · ${entry.detail}` : ""}` : text
  }
}

/** The sensor's event log: polls for new entries every 2 s; a restart (new session) reloads it. */
export function LogsPage() {
  const { t, locale } = useI18n()
  const { state } = useDevice()
  const text = useLogText()
  const [level, setLevel] = useState("")
  const [category, setCategory] = useState("")
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [hasOlder, setHasOlder] = useState(false)
  const [capacity, setCapacity] = useState(0)
  const [failed, setFailed] = useState(false)
  const [reload, setReload] = useState(0)
  const latest = useRef<LogEntry[]>([])
  const session = useRef<number | null>(null)

  const fetchLogs = (extra: Record<string, string> = {}) =>
    getJson<LogResponse>(`/api/v1/logs?${new URLSearchParams({ level, category, limit: String(pageSize), ...extra })}`)

  function show(list: LogEntry[]) {
    latest.current = list
    setEntries(list)
  }

  useEffect(() => {
    let active = true
    session.current = null
    show([])
    async function poll() {
      if (document.hidden) return
      try {
        const newest = latest.current.at(-1)?.id ?? 0
        let result = await fetchLogs(session.current === null ? {} : { after: String(newest) })
        if (session.current !== null && result.sessionId !== session.current) result = await fetchLogs() // restarted
        if (!active) return
        if (result.sessionId !== session.current) {
          session.current = result.sessionId
          show(result.entries)
          setHasOlder(result.hasMore)
        } else if (result.entries.length) {
          show([...latest.current, ...result.entries])
        }
        setCapacity(result.capacity)
        setFailed(false)
      } catch {
        if (active) setFailed(true)
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 2000)
    return () => { active = false; window.clearInterval(timer) }
  }, [level, category, reload])

  async function loadOlder() {
    const oldest = latest.current[0]
    if (!oldest) return
    const result = await fetchLogs({ before: String(oldest.id) }).catch(() => null)
    if (!result) return setFailed(true)
    show([...result.entries, ...latest.current])
    setHasOlder(result.hasMore)
  }

  // Entries carry the sensor's uptime; with its clock (SNTP) we can show the time of day
  const when = (entry: LogEntry) => {
    if (!state) return ""
    const agoS = Math.max(0, state.uptime - Math.floor(entry.uptimeMs / 1000))
    if (state.clock) return new Date((state.clock - agoS) * 1000).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    return agoS < 60 ? t("logs.secondsAgo", { n: agoS }) : agoS < 3600 ? t("logs.minutesAgo", { n: Math.floor(agoS / 60) }) : t("logs.hoursAgo", { n: Math.floor(agoS / 3600) })
  }

  return <>
    <PageHeader eyebrow={t("nav.system")} title={t("nav.logs")} description={t("logs.description", { capacity })}
      actions={<Button variant="ghost" onClick={() => setReload(n => n + 1)}><RefreshCw className="size-4" />{t("logs.refresh")}</Button>} />
    <div className="mt-6 flex flex-wrap gap-2">
      <select className="whisli-select" value={level} aria-label={t("logs.level")} onChange={e => setLevel(e.target.value)}>
        <option value="">{t("logs.allLevels")}</option>
        {levels.map(l => <option key={l} value={l}>{t(`logs.level.${l}` as TranslationKey)}</option>)}
      </select>
      <select className="whisli-select" value={category} aria-label={t("logs.category")} onChange={e => setCategory(e.target.value)}>
        <option value="">{t("logs.allCategories")}</option>
        {categories.map(c => <option key={c} value={c}>{t(`logs.category.${c}` as TranslationKey)}</option>)}
      </select>
    </div>
    {failed && <p role="alert" className="whisli-status-error mt-4">{t("logs.loadError")}</p>}
    <section className="whisli-card mt-4 overflow-hidden" aria-live="polite">
      {!entries.length ? <Muted className="p-4">{t("logs.empty")}</Muted> : <ol className="divide-y divide-[var(--line)]">
        {[...entries].reverse().map(entry => <li key={entry.id} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[6rem_6rem_7rem_minmax(0,1fr)] sm:items-baseline sm:gap-3">
          <time className="whisli-muted font-mono text-xs" title={`${entry.uptimeMs} ms`}>{when(entry)}</time>
          <span className={cn("text-xs font-medium", levelClass[entry.level])}>{t(`logs.level.${entry.level}` as TranslationKey)}</span>
          <span className="whisli-muted text-xs">{t(`logs.category.${entry.category}` as TranslationKey)}</span>
          <span className="min-w-0 break-words">{text(entry)}</span>
        </li>)}
      </ol>}
      {hasOlder && <div className="whisli-line border-t p-2"><Button variant="ghost" onClick={() => void loadOlder()}>{t("logs.older")}</Button></div>}
    </section>
  </>
}
