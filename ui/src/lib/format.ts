import { GATE_CM } from "@/types"

export function meters(cm: number, locale: string) {
  return `${(cm / 100).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m`
}

/** "1,4–2,1 m" - the distance range of one radar gate */
export function gateRange(gate: number, locale: string) {
  const from = (gate * GATE_CM / 100).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  return `${from}–${meters((gate + 1) * GATE_CM, locale)}`
}

export function number(value: number | null | undefined, digits: number, locale: string) {
  return value == null ? "—" : value.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function duration(seconds: number) {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor(seconds % 86400 / 3600)
  const m = Math.floor(seconds % 3600 / 60)
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : m ? `${m} min ${seconds % 60} s` : `${seconds} s`
}

export function kb(bytes: number) {
  return `${Math.round(bytes / 1024)} KB`
}
