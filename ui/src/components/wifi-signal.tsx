import { useI18n } from "@/i18n"
import { cn } from "@/lib/utils"

/** 0–4 bars from dBm, like a phone: -55 and better is full. 0 dBm means offline. */
function bars(rssi: number) {
  if (!rssi) return 0
  return rssi >= -55 ? 4 : rssi >= -65 ? 3 : rssi >= -75 ? 2 : 1
}

/** Signal bars with dBm and, optionally, the IP address. `undefined` = not known (older firmware). */
export function WifiSignal({ rssi, ip, className }: { rssi: number | undefined; ip?: string; className?: string }) {
  const { t } = useI18n()
  const level = bars(rssi ?? 0)
  const quality = level >= 3 ? "wifi.good" : level === 2 ? "wifi.fair" : level === 1 ? "wifi.weak" : "wifi.none"
  return <span className={cn("inline-flex items-center gap-2 text-xs tabular-nums", className)} title={`Wi-Fi: ${t(quality)}`}>
    <span className="flex h-3.5 items-end gap-[2px]" aria-hidden>
      {[1, 2, 3, 4].map(bar => <span key={bar} className={cn("w-[3px] rounded-[1px]", bar <= level ? "bg-[var(--status-ok)]" : "bg-[var(--line)]")}
        style={{ height: `${bar * 25}%` }} />)}
    </span>
    <span>{rssi === undefined ? "—" : rssi ? `${rssi} dBm` : t("wifi.none")}</span>
    {ip && <span className="whisli-muted font-mono">{ip}</span>}
  </span>
}
