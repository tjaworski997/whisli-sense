import type { FleetMember } from "@/hooks/use-fleet"

// `npm run dev` only: http://localhost:5199/?demo=10#/sensors adds 10 made-up sensors to the
// sensors overview, to see how the views look with many of them. Production builds drop this code.
const rooms = ["Kuchnia", "Sypialnia", "Łazienka", "Przedpokój", "Gabinet", "Pokój dzieci", "Garaż", "Pralnia", "Strych", "Taras", "Jadalnia", "Garderoba"]

export function demoCount() {
  if (!import.meta.env.DEV) return 0
  return Math.min(Number(new URLSearchParams(window.location.search).get("demo")) || 0, rooms.length)
}

export function demoMembers(count: number): FleetMember[] {
  const now = Date.now()
  return Array.from({ length: count }, (_, i) => {
    const offline = i === 3
    const presence = Math.floor(now / 7000 + i) % 3 === 0 ? 1 : 0 // changes every few seconds
    const ip = `10.69.30.${100 + i}`
    return {
      self: false,
      name: rooms[i],
      host: `whisli-demo-${i + 1}`,
      ip,
      receivedAt: offline ? 0 : now,
      summary: offline ? null : {
        name: rooms[i], host: `whisli-demo-${i + 1}`, version: "demo",
        presence, distance: presence ? 80 + (i * 53) % 400 : -1,
        temperature: 19 + (i * 7) % 6 + 0.4, humidity: 38 + (i * 11) % 25, lux: (i * 137) % 900,
        problems: i === 6 ? 1 : 0,
        rssi: -45 - (i * 6) % 40, ip, mac: `90:E5:B1:00:00:${(16 + i).toString(16).toUpperCase()}`,
      },
    }
  })
}
