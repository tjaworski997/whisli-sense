import { RotateCw, Upload } from "lucide-react"
import { useState, type FormEvent } from "react"

import { Button } from "@/components/button"
import { MessageBox } from "@/components/message-box"
import { AutoSaveInput, Field, InfoList, Message, Muted, PageHeader, PasswordInput, Section } from "@/components/page"
import { useDevice } from "@/hooks/use-device"
import { useFetch } from "@/hooks/use-fetch"
import { useI18n } from "@/i18n"
import { apiFetch, getJson, post } from "@/lib/api"
import { usesDefaultPassword } from "@/lib/auth"
import { duration, kb } from "@/lib/format"
import type { SystemInfo } from "@/types"

type Note = { ok: boolean; text: string } | null

export function SettingsPage() {
  const { t } = useI18n()
  const { state } = useDevice()
  if (!state) return <Muted>{t("app.connecting")}</Muted>
  return <>
    <PageHeader eyebrow={t("nav.system")} title={t("nav.settings")} description={t("settings.description")} />
    <NameSection name={state.name} hostname={state.hostname} />
    <PasswordSection />
    <FirmwareSection />
  </>
}

function NameSection({ name, hostname }: { name: string; hostname: string }) {
  const { t, code } = useI18n()
  const [message, setMessage] = useState<Note>(null)
  async function save(value: string) {
    const result = await post("/api/v1/device", { name: value })
    setMessage(result.ok ? { ok: true, text: t("settings.nameSaved", { host: `${result.data.hostname}.local` }) } : { ok: false, text: code("error", result.error) })
  }
  return <Section title={t("settings.name")} description={t("settings.nameHint")} className="mt-6">
    <div className="mt-4 grid max-w-xl gap-4 sm:grid-cols-2">
      <Field label={t("settings.name")}><AutoSaveInput value={name} maxLength={32} onSave={value => void save(value)} /></Field>
      <Field label={t("settings.address")}><span className="whisli-input flex items-center font-mono text-xs">{hostname}.local</span></Field>
    </div>
    <Message message={message} />
  </Section>
}

function PasswordSection() {
  const { t, code } = useI18n()
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [repeat, setRepeat] = useState("")
  const [message, setMessage] = useState<Note>(null)
  const mismatch = repeat !== "" && next !== repeat

  async function change(event: FormEvent) {
    event.preventDefault()
    const result = await post("/api/v1/auth/password", { current, password: next })
    setMessage(result.ok ? { ok: true, text: t("settings.passwordChanged") } : { ok: false, text: code("error", result.error) })
    if (result.ok) { setCurrent(""); setNext(""); setRepeat("") }
  }

  return <Section title={t("settings.password")} description={t("settings.passwordHint")}>
    {usesDefaultPassword() && <p className="whisli-status-error mt-3">{t("settings.defaultPassword")}</p>}
    <form onSubmit={change} className="mt-4 grid max-w-3xl gap-4 sm:grid-cols-3">
      <Field label={t("settings.currentPassword")}><PasswordInput autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} /></Field>
      <Field label={t("settings.newPassword")}><PasswordInput autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} /></Field>
      <Field label={t("settings.repeatPassword")} hint={mismatch ? <span className="whisli-status-error">{t("settings.passwordMismatch")}</span> : undefined}>
        <PasswordInput autoComplete="new-password" value={repeat} onChange={e => setRepeat(e.target.value)} />
      </Field>
      <div><Button type="submit" disabled={!current || next.length < 8 || next !== repeat}>{t("settings.changePassword")}</Button></div>
    </form>
    <Message message={message} />
  </Section>
}

const sleep = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms))

async function running(): Promise<SystemInfo | null> {
  try { return await getJson<SystemInfo>(`/api/v1/system?check=${Date.now()}`) } catch { return null }
}

/** The build writes its version as plain text into firmware.bin (src/generated/version.h). */
async function versionInFile(file: File) {
  const text = new TextDecoder("latin1").decode(await file.arrayBuffer())
  return /0\.\d{3}\.\d{12}/.exec(text)?.[0] ?? ""
}

function FirmwareSection() {
  const { t, code } = useI18n()
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<Note[]>([])
  const [confirmRestart, setConfirmRestart] = useState(false)
  const { data: info } = useFetch<SystemInfo>("/api/v1/system")
  const add = (ok: boolean, text: string) => setLog(list => [...list, { ok, text }])

  // A dropped connection is no proof: an aborted upload leaves the old firmware running.
  // Success = the sensor answers with the version from the file (or any new one after a restart).
  async function waitForRestart(before: SystemInfo | null, expected: string) {
    add(true, t("firmware.waiting"))
    const started = Date.now()
    while (Date.now() - started < 60000) {
      await sleep(1000)
      const now = await running()
      if (!now) continue
      const restarted = !before || now.uptime < before.uptime
      if (restarted && (expected ? now.version === expected : now.version !== before?.version)) {
        add(true, t("firmware.back", { version: now.version }))
        window.setTimeout(() => window.location.reload(), 1000)
        return
      }
    }
    add(false, t("firmware.notBack"))
  }

  async function upload() {
    if (!file) return
    setBusy(true)
    setLog([])
    const expected = await versionInFile(file)
    const before = await running()
    add(true, t("firmware.uploading", { name: file.name, size: kb(file.size) }))
    try {
      const response = await apiFetch("/api/v1/firmware", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file })
      const data = await response.json().catch(() => ({})) as { error?: string; detail?: string }
      if (!response.ok) {
        add(false, `${code("error", data.error ?? "failed")}${data.detail ? ` (${data.detail})` : ""}`)
        return
      }
      add(true, t("firmware.uploaded"))
      await waitForRestart(before, expected)
    } catch {
      add(false, code("error", "offline"))
    } finally {
      setBusy(false)
    }
  }

  async function restart() {
    setConfirmRestart(false)
    setBusy(true)
    setLog([])
    const before = await running()
    await post("/api/v1/system/restart")
    add(true, t("firmware.restarting"))
    await waitForRestart(before, before?.version ?? "")
    setBusy(false)
  }

  return <Section title={t("firmware.title")} description={t("firmware.hint")}>
    {info && <div className="mt-4 max-w-xl"><InfoList rows={[
      [t("firmware.version"), info.version],
      [t("firmware.uptime"), duration(info.uptime)],
      [t("firmware.size"), `${kb(info.firmwareSize)} / ${kb(info.firmwareSpace)}`],
    ]} /></div>}
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <input className="whisli-muted text-xs file:mr-3 file:rounded-md file:border-0 file:bg-[var(--raised)] file:px-3 file:py-2 file:text-[var(--ink)]"
        type="file" accept=".bin" disabled={busy} onChange={event => setFile(event.target.files?.[0] ?? null)} />
      <Button disabled={!file || busy} onClick={() => void upload()}><Upload className="size-4" />{t("firmware.upload")}</Button>
      <Button variant="ghost" disabled={busy} onClick={() => setConfirmRestart(true)}><RotateCw className="size-4" />{t("firmware.restart")}</Button>
    </div>
    {log.length > 0 && <ul className="mt-3 space-y-1 text-xs">{log.map((line, i) => <li key={i} className={line!.ok ? "whisli-muted" : "whisli-status-error"}>{line!.text}</li>)}</ul>}
    <MessageBox open={confirmRestart} title={t("firmware.restartTitle")} message={t("firmware.restartMessage")}
      confirmLabel={t("firmware.restart")} cancelLabel={t("common.cancel")} onClose={() => setConfirmRestart(false)} onConfirm={() => void restart()} />
  </Section>
}
