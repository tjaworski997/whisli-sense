import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

import { checkAuth } from "@/lib/auth"
import type { DeviceState } from "@/types"

/** One reading per second for the charts and the presence timeline */
export interface Sample {
  presence: number
  temperature: number | null
  humidity: number | null
  lux: number | null
}

const historyLength = 120 // ~2 minutes
const staleMs = 4000 // the sensor sends every second

type Device = {
  state: DeviceState | null
  history: Sample[]
  /** WebSocket open and data arrives */
  connected: boolean
}

const DeviceContext = createContext<Device>({ state: null, history: [], connected: false })

export function socketUrl(path: string, host = window.location.host) {
  return `${window.location.protocol === "https:" ? "wss" : "ws"}://${host}${path}`
}

/** Live state from ws://<sensor>/api/v1/ws; reconnects by itself. */
export function DeviceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DeviceState | null>(null)
  const [history, setHistory] = useState<Sample[]>([])
  const [receivedAt, setReceivedAt] = useState(0)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    let socket: WebSocket | null = null
    let timer = 0
    let retry = 0
    let disposed = false

    function connect() {
      socket = new WebSocket(socketUrl("/api/v1/ws"))
      socket.onopen = () => { retry = 0 }
      socket.onmessage = event => {
        let message: DeviceState
        try { message = JSON.parse(event.data) } catch { return }
        setState(message)
        setReceivedAt(Date.now())
        const sample = { presence: message.presence, temperature: message.temperature, humidity: message.humidity, lux: message.lux }
        setHistory(list => [...list, sample].slice(-historyLength))
      }
      socket.onclose = () => {
        if (disposed) return
        if (retry === 0) void checkAuth() // a refused handshake usually means the session expired
        timer = window.setTimeout(connect, Math.min(1000 * 2 ** retry++, 8000))
      }
    }

    connect()
    const clock = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      disposed = true
      window.clearTimeout(timer)
      window.clearInterval(clock)
      socket?.close()
    }
  }, [])

  const connected = receivedAt > 0 && now - receivedAt < staleMs
  return <DeviceContext.Provider value={{ state, history, connected }}>{children}</DeviceContext.Provider>
}

export function useDevice() {
  return useContext(DeviceContext)
}
