import { Lock, RadioTower, Search, Wifi, WifiOff } from "lucide-react"
import { useState, type FormEvent } from "react"

import { Button } from "@/components/button"
import { MessageBox } from "@/components/message-box"
import { Field, IconTile, InfoList, Message, Muted, PageHeader, PasswordInput, Section, Status } from "@/components/page"
import { useFetch } from "@/hooks/use-fetch"
import { useI18n } from "@/i18n"
import { getJson, post } from "@/lib/api"
import type { WifiScan, WifiStatus } from "@/types"

type Note = { ok: boolean; text: string } | null
const sleep = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms))

export function NetworkPage() {
  const { t } = useI18n()
  const { data, reload } = useFetch<WifiStatus>("/api/v1/wifi", 5000)
  return <>
    <PageHeader eyebrow={t("nav.system")} title={t("nav.network")} description={t("network.description")} />
    {!data ? <Muted className="mt-6">{t("app.connecting")}</Muted> : <>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="whisli-card p-5">
          <div className="flex items-start gap-3">
            <IconTile icon={data.wifi.connected ? Wifi : WifiOff} />
            <div className="min-w-0 flex-1"><p className="font-medium">Wi-Fi</p><p className="whisli-muted truncate">{data.wifi.ssid || t("network.noWifi")}</p></div>
            <Status ok={data.wifi.connected}>{t(data.wifi.connected ? "network.connected" : "network.notConnected")}</Status>
          </div>
          {data.wifi.connected && <div className="mt-4"><InfoList rows={[
            [t("network.ip"), data.wifi.ip],
            [t("network.address"), `${data.wifi.hostname}.local`],
            [t("network.signal"), `${data.wifi.rssi} dBm`],
            [t("network.channel"), data.wifi.channel],
          ]} /></div>}
        </div>
        <div className="whisli-card p-5">
          <div className="flex items-start gap-3">
            <IconTile icon={RadioTower} />
            <div className="min-w-0 flex-1"><p className="font-medium">{t("network.ap")}</p><p className="whisli-muted truncate">{data.ap.ssid}</p></div>
            <span className="whisli-muted text-xs">{t(data.ap.active ? "network.apOn" : "network.apOff")}</span>
          </div>
          <p className="whisli-muted mt-4 text-xs">{t("network.apHint")}</p>
          {data.ap.active && <div className="mt-3"><InfoList rows={[[t("network.ip"), data.ap.ip], [t("network.apClients"), data.ap.clients]]} /></div>}
        </div>
      </div>
      <WifiSection status={data} onChanged={reload} />
      <AccessPointSection status={data} onChanged={reload} />
    </>}
  </>
}

function WifiSection({ status, onChanged }: { status: WifiStatus; onChanged: () => void }) {
  const { t, code } = useI18n()
  const [ssid, setSsid] = useState("")
  const [password, setPassword] = useState("")
  const [scan, setScan] = useState<WifiScan | null>(null)
  const [scanning, setScanning] = useState(false)
  const [forgetting, setForgetting] = useState(false)
  const [message, setMessage] = useState<Note>(null)

  async function startScan() {
    setScanning(true)
    await post("/api/v1/wifi/scan")
    for (let i = 0; i < 20; i++) {
      await sleep(1000)
      const result = await getJson<WifiScan>("/api/v1/wifi/scan").catch(() => null)
      if (result && !result.scanning) { setScan(result); break }
    }
    setScanning(false)
  }

  async function connect(event: FormEvent) {
    event.preventDefault()
    const result = await post("/api/v1/wifi", { ssid, password })
    setMessage(result.ok ? { ok: true, text: t("network.connecting", { ssid }) } : { ok: false, text: code("error", result.error) })
    if (result.ok) { setPassword(""); window.setTimeout(onChanged, 3000) }
  }

  async function forget() {
    setForgetting(false)
    const result = await post("/api/v1/wifi/forget")
    setMessage(result.ok ? { ok: true, text: t("network.forgotten") } : { ok: false, text: code("error", result.error) })
    onChanged()
  }

  return <Section title="Wi-Fi" description={t("network.wifiHint")}
    actions={<>
      <Button variant="ghost" disabled={scanning} onClick={() => void startScan()}><Search className="size-4" />{t(scanning ? "network.scanning" : "network.scan")}</Button>
      {status.wifi.ssid && <Button variant="ghost" onClick={() => setForgetting(true)}>{t("network.forget")}</Button>}
    </>}>
    {scan && <ul className="whisli-line mt-4 max-w-xl divide-y divide-[var(--line)] rounded-md border">
      {scan.networks.length === 0 && <li className="whisli-muted px-3 py-2">{t("network.noNetworks")}</li>}
      {scan.networks.map(n => <li key={n.ssid}>
        <button type="button" className="whisli-nav flex w-full items-center gap-3 px-3 py-2 text-left" onClick={() => setSsid(n.ssid)}>
          <span className="min-w-0 flex-1 truncate">{n.ssid}</span>
          {n.secure && <Lock className="size-3.5" />}
          <span className="font-mono text-xs">{n.rssi} dBm</span>
        </button>
      </li>)}
    </ul>}
    <form onSubmit={connect} className="mt-4 grid max-w-xl gap-4 sm:grid-cols-2">
      <Field label={t("network.ssid")}><input className="whisli-input" value={ssid} placeholder={status.wifi.ssid} onChange={e => setSsid(e.target.value)} /></Field>
      <Field label={t("network.password")}><PasswordInput autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></Field>
      <div><Button type="submit" disabled={!ssid.trim()}>{t("network.connect")}</Button></div>
    </form>
    <p className="whisli-muted mt-3 text-xs">{t("network.connectHint")}</p>
    <Message message={message} />
    <MessageBox open={forgetting} danger title={t("network.forgetTitle")} message={t("network.forgetMessage", { ssid: status.wifi.ssid, ap: status.ap.ssid })}
      confirmLabel={t("network.forget")} cancelLabel={t("common.cancel")} onClose={() => setForgetting(false)} onConfirm={() => void forget()} />
  </Section>
}

function AccessPointSection({ status, onChanged }: { status: WifiStatus; onChanged: () => void }) {
  const { t, code } = useI18n()
  const [password, setPassword] = useState("")
  const [message, setMessage] = useState<Note>(null)

  async function save(event: FormEvent) {
    event.preventDefault()
    const result = await post("/api/v1/wifi/ap", { password })
    setMessage(result.ok ? { ok: true, text: t("common.saved") } : { ok: false, text: code("error", result.error) })
    if (result.ok) { setPassword(""); onChanged() }
  }

  return <Section title={t("network.apPassword")} description={t("network.apPasswordHint", { ssid: status.ap.ssid })}>
    {status.ap.defaultPassword && <p className="whisli-status-error mt-3">{t("network.apDefaultPassword")}</p>}
    <form onSubmit={save} className="mt-4 flex max-w-xl flex-wrap items-end gap-3">
      <Field label={t("network.newApPassword")} className="min-w-0 flex-1"><PasswordInput autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></Field>
      <Button type="submit" disabled={password.length < 8}>{t("common.save")}</Button>
    </form>
    <Message message={message} />
  </Section>
}
