import { Lightbulb } from "lucide-react"
import { useState, type FormEvent } from "react"

import { Button } from "@/components/button"
import { Field, Message, PasswordInput } from "@/components/page"
import { useI18n } from "@/i18n"
import { post } from "@/lib/api"
import { sensorIdentity, signedIn } from "@/lib/auth"

const defaultPassword = "whisli_gogo" // firmware: DEFAULT_PASSWORD in src/board.h

export function LoginPage() {
  const { t, code } = useI18n()
  const [password, setPassword] = useState("")
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const sensor = sensorIdentity()

  async function login(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    const result = await post("/api/v1/auth/login", { password, remember: remember ? 1 : 0 })
    setBusy(false)
    if (result.ok) signedIn()
    else setError(code("error", result.error))
  }

  return <div className="whisli-page grid min-h-screen place-items-center p-4 text-sm">
    <form onSubmit={login} className="whisli-card grid w-full max-w-sm gap-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">whisli sense</h1>
        <p className="whisli-muted mt-1">{t("login.description")}</p>
      </div>
      <Field label={t("login.password")}>
        <PasswordInput autoFocus autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} />
      </Field>
      <label className="flex items-center gap-2"><input className="whisli-check" type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} />{t("login.remember")}</label>
      <Button type="submit" disabled={busy || !password} className="justify-center">{t("login.submit")}</Button>
      <Message message={error ? { ok: false, text: error } : null} />
    </form>
    {/* Which sensor this is and the password hint, as quiet info at the bottom of the screen */}
    <footer className="whisli-muted fixed inset-x-0 bottom-0 grid gap-1 p-4 text-center text-xs">
      {sensor && <p>
        {t("login.sensor")}: <span className="text-[var(--ink)]">{sensor.name}</span>
        <span className="font-mono"> · {sensor.ip}{sensor.hostname && ` · ${sensor.hostname}.local`}</span>
      </p>}
      <p>{t("login.defaultPassword")} <span className="font-mono text-[var(--ink)]">{defaultPassword}</span></p>
      <p className="inline-flex items-center justify-center gap-1.5"><Lightbulb className="size-3.5 shrink-0" />{t("login.resetHint")}</p>
    </footer>
  </div>
}
