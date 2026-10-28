import { useEffect, useRef, useState } from "react"

import { socketUrl } from "@/hooks/use-device"
import { getJson } from "@/lib/api"
import { demoCount, demoMembers } from "@/lib/demo"
import type { Peer, Summary } from "@/types"

export interface FleetMember extends Peer {
  summary: Summary | null
  receivedAt: number
}

const peersEveryMs = 30000

// The list comes from this sensor (/api/v1/peers); the data straight from each sensor's
// ws://<ip>/api/v1/live, which needs no sign-in. A sensor that drops off the list stays as offline.
export function useFleet() {
  const [members, setMembers] = useState<Record<string, FleetMember>>({})
  const sockets = useRef<Record<string, { socket: WebSocket; timer?: number; retry: number }>>({})

  useEffect(() => {
    let disposed = false

    function update(ip: string, patch: Partial<FleetMember>) {
      setMembers(all => all[ip] ? { ...all, [ip]: { ...all[ip], ...patch } } : all)
    }

    function connect(ip: string, self: boolean) {
      const entry = sockets.current[ip] ?? { retry: 0 } as { socket: WebSocket; timer?: number; retry: number }
      // In `npm run dev` this sensor is reached through the proxy, the others directly.
      const socket = new WebSocket(self ? socketUrl("/api/v1/live") : socketUrl("/api/v1/live", ip))
      entry.socket = socket
      sockets.current[ip] = entry
      socket.onopen = () => { entry.retry = 0 }
      socket.onmessage = event => {
        try {
          const summary = JSON.parse(event.data) as Summary
          update(ip, { summary, name: summary.name, host: summary.host, receivedAt: Date.now() })
        } catch { /* skip a broken message */ }
      }
      socket.onclose = () => {
        if (disposed) return
        entry.timer = window.setTimeout(() => connect(ip, self), Math.min(2000 * 2 ** entry.retry++, 30000))
      }
    }

    async function loadPeers() {
      let peers: Peer[]
      try { peers = await getJson<Peer[]>("/api/v1/peers") } catch { return }
      if (disposed) return
      setMembers(all => {
        const next = { ...all }
        for (const peer of peers) {
          const known = all[peer.ip]
          next[peer.ip] = known ? { ...known, self: peer.self } : { ...peer, summary: null, receivedAt: 0 }
        }
        return next
      })
      for (const peer of peers) if (!sockets.current[peer.ip]) connect(peer.ip, peer.self)
    }

    void loadPeers()
    const timer = window.setInterval(() => void loadPeers(), peersEveryMs)
    return () => {
      disposed = true
      window.clearInterval(timer)
      for (const entry of Object.values(sockets.current)) {
        window.clearTimeout(entry.timer)
        entry.socket.close()
      }
      sockets.current = {}
    }
  }, [])

  return [...Object.values(members), ...demoMembers(demoCount())]
    .sort((a, b) => Number(b.self) - Number(a.self) || a.name.localeCompare(b.name))
}
