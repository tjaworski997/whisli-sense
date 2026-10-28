import { useEffect, useState } from "react"

export type Theme = "light" | "dark"
const storageKey = "whisli-sense.theme"

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved === "light" || saved === "dark") return saved
  } catch { /* no storage: follow the system */ }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initialTheme)

  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light"
    setTheme(next)
    try { localStorage.setItem(storageKey, next) } catch { /* not remembered */ }
  }

  return { theme, toggleTheme }
}
