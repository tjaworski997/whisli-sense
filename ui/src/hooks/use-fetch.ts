import { useCallback, useEffect, useState } from "react"

import { getJson } from "@/lib/api"

/** GET a JSON endpoint once (and every `everyMs`, if given). `reload` fetches again now. */
export function useFetch<T>(path: string, everyMs?: number) {
  const [data, setData] = useState<T | null>(null)
  const [failed, setFailed] = useState(false)

  const reload = useCallback(async () => {
    try {
      setData(await getJson<T>(path))
      setFailed(false)
    } catch {
      setFailed(true) // keep the last data
    }
  }, [path])

  useEffect(() => {
    void reload()
    if (!everyMs) return
    const timer = window.setInterval(() => void reload(), everyMs)
    return () => window.clearInterval(timer)
  }, [reload, everyMs])

  return { data, failed, reload }
}
