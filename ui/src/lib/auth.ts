import { useSyncExternalStore } from "react"

export type AuthState = "unknown" | "signedIn" | "signedOut"

let state: AuthState = "unknown"
let defaultPassword = false
/** Which sensor answers - for the login screen (the API tells it without signing in) */
export type SensorIdentity = { name: string; hostname: string; ip: string }
let identity: SensorIdentity | null = null
const listeners = new Set<() => void>()

function set(next: AuthState) {
  state = next
  listeners.forEach(listener => listener())
}

export function signedOut() { set("signedOut") }
export function signedIn() { set("signedIn") }
/** The panel password is still the factory default (whisli_gogo). */
export function usesDefaultPassword() { return defaultPassword }
export function sensorIdentity() { return identity }

export async function checkAuth() {
  try {
    const response = await fetch("/api/v1/auth", { cache: "no-store" })
    const data = await response.json() as { signedIn: boolean; defaultPassword: boolean } & Partial<SensorIdentity>
    defaultPassword = data.defaultPassword
    identity = data.name ? { name: data.name, hostname: data.hostname ?? "", ip: data.ip ?? "" } : null
    set(data.signedIn ? "signedIn" : "signedOut")
  } catch {
    set("signedOut")
  }
}

export function useAuth() {
  return useSyncExternalStore(listener => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, () => state)
}
