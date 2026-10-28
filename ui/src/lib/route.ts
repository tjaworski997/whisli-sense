import { useEffect, useState } from "react"

// Hash routing: every page has its own #/… address, so links can open in a new tab.
const hashes = {
  start: "#/start",
  sensors: "#/sensors",
  radarSettings: "#/radar",
  calibration: "#/radar/calibration",
  settings: "#/system",
  network: "#/system/network",
  led: "#/system/led",
  mqtt: "#/system/mqtt",
  diagnostics: "#/system/diagnostics",
  logs: "#/system/logs",
} as const

export type Page = keyof typeof hashes

export function pageHash(page: Page) {
  return hashes[page]
}

// Addresses of pages that were merged into another one, so old links and bookmarks still work
const moved: Record<string, Page> = { "#/radar/sensitivity": "radarSettings" }

function parse(hash = window.location.hash): Page {
  if (moved[hash]) return moved[hash]
  const found = (Object.keys(hashes) as Page[]).find(page => hashes[page] === hash)
  return found ?? "start"
}

export function useRoute() {
  const [page, setPage] = useState<Page>(() => parse())

  useEffect(() => {
    const sync = () => setPage(parse())
    window.addEventListener("hashchange", sync)
    if (window.location.hash !== hashes[parse()]) window.history.replaceState(null, "", hashes[parse()])
    return () => window.removeEventListener("hashchange", sync)
  }, [])

  function navigate(next: Page) {
    if (next === page) return
    window.history.pushState(null, "", hashes[next])
    setPage(next)
  }

  return { page, navigate }
}
