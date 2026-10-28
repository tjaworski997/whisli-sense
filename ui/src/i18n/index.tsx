import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

import en from "./en.json"
import pl from "./pl.json"

// Every text lives in pl.json and en.json under the same key; TypeScript checks en.json has them all.
export type TranslationKey = keyof typeof pl
export type TranslationParams = Record<string, string | number>
export type Locale = "pl" | "en"

const dictionaries: Record<Locale, Record<TranslationKey, string>> = { pl, en }
export const localeLabels: Record<Locale, string> = { pl: "Polski", en: "English" }
const storageKey = "whisli-sense.locale"

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved === "pl" || saved === "en") return saved
  } catch { /* no storage: use the browser language */ }
  return navigator.language.toLowerCase().startsWith("pl") ? "pl" : "en"
}

type I18n = {
  locale: Locale
  setLocale: (locale: Locale) => void
  /** "Hello {name}" + { name: "Ann" } */
  t: (key: TranslationKey, params?: TranslationParams) => string
  /** Text for an error or problem code from the firmware, e.g. ("error", "invalidName") */
  code: (group: "error" | "problem" | "sensorError" | "mqttError" | "calibrationError" | "resetReason", code: string) => string
}

const I18nContext = createContext<I18n | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale)
  const dictionary = dictionaries[locale]

  useEffect(() => { document.documentElement.lang = locale }, [locale])

  function setLocale(next: Locale) {
    setLocaleState(next)
    try { localStorage.setItem(storageKey, next) } catch { /* not remembered */ }
  }

  function t(key: TranslationKey, params?: TranslationParams) {
    let text = dictionary[key] ?? key
    for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
    return text
  }

  function code(group: string, value: string) {
    const key = `${group}.${value}` as TranslationKey
    return key in dictionary ? dictionary[key] : `${dictionary["error.failed"]} (${value})`
  }

  return <I18nContext.Provider value={{ locale, setLocale, t, code }}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) throw new Error("useI18n outside I18nProvider")
  return context
}
