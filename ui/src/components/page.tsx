import { CircleCheck, CircleX, Eye, EyeOff, type LucideIcon } from "lucide-react"
import { useState, type InputHTMLAttributes, type ReactNode } from "react"

import { useI18n } from "@/i18n"
import { cn } from "@/lib/utils"

export function PageHeader({ eyebrow, title, description, actions }: {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
}) {
  return <header className="flex flex-wrap items-start gap-x-4 gap-y-3">
    <div className="min-w-0 flex-1">
      {eyebrow && <p className="whisli-muted mb-1">{eyebrow}</p>}
      <h1 className="text-xl font-semibold">{title}</h1>
      {description && <p className="whisli-muted mt-1 max-w-3xl">{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </header>
}

export function Section({ title, description, actions, className, children }: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  className?: string
  children?: ReactNode
}) {
  return <section className={cn("whisli-line mt-8 border-t pt-6", className)}>
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0 max-w-3xl">
        <h2 className="font-medium">{title}</h2>
        {description && <p className="whisli-muted mt-1">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
    {children}
  </section>
}

export function Field({ label, hint, className, children }: { label: string; hint?: ReactNode; className?: string; children: ReactNode }) {
  return <label className={cn("grid content-start gap-1.5", className)}>
    <span className="whisli-muted text-xs">{label}</span>
    {children}
    {hint && <span className="whisli-muted text-xs">{hint}</span>}
  </label>
}

/** A password field with an eye button that shows what was typed. */
export function PasswordInput({ className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const { t } = useI18n()
  const [shown, setShown] = useState(false)
  return <span className={cn("relative grid", className)}>
    <input className="whisli-input pr-9" type={shown ? "text" : "password"} {...props} />
    <button type="button" className="whisli-link absolute inset-y-0 right-0 grid w-9 place-items-center disabled:opacity-50" disabled={props.disabled}
      aria-label={t(shown ? "common.hidePassword" : "common.showPassword")} title={t(shown ? "common.hidePassword" : "common.showPassword")}
      aria-pressed={shown} onClick={() => setShown(!shown)}>
      {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
    </button>
  </span>
}

/** Saves on blur when the trimmed value changed. Re-mounts when `value` changes on the sensor. */
export function AutoSaveInput({ value, onSave, className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onBlur"> & {
  value: string | number
  onSave: (value: string) => void
}) {
  return <input
    key={String(value)}
    className={cn("whisli-input", className)}
    defaultValue={value}
    onBlur={event => {
      const next = event.currentTarget.value.trim()
      if (next !== String(value)) onSave(next)
    }}
    onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur() }}
    {...props}
  />
}

export function IconTile({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return <span className={cn("whisli-raised flex size-9 shrink-0 items-center justify-center rounded-md", className)}><Icon className="size-4" /></span>
}

/** Small "OK / Problem" label with an icon */
export function Status({ ok, children }: { ok: boolean; children: ReactNode }) {
  const Icon = ok ? CircleCheck : CircleX
  return <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs", ok ? "whisli-status-ok" : "whisli-status-error")}>
    <Icon className="size-4" />{children}
  </span>
}

/** Result of a save: blue when it worked, red otherwise */
export function Message({ message }: { message: { ok: boolean; text: string } | null }) {
  if (!message) return null
  return <p role={message.ok ? "status" : "alert"} className={cn("mt-3 text-xs", message.ok ? "whisli-status-ok" : "whisli-status-error")}>{message.text}</p>
}

export function Muted({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cn("whisli-muted", className)}>{children}</p>
}

/** Label - value rows */
export function InfoList({ rows }: { rows: [string, ReactNode][] }) {
  return <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5">
    {rows.map(([label, value]) => <div key={label} className="contents">
      <dt className="whisli-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right font-mono text-xs leading-5">{value}</dd>
    </div>)}
  </dl>
}
