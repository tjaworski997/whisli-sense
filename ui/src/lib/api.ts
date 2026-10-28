import { signedOut } from "@/lib/auth"

export type ApiParams = Record<string, string | number | boolean>
/** `error` is a code from the firmware; the panel translates it (i18n key "error.<code>"). */
export type ApiResult = { ok: boolean; status: number; error: string; data: Record<string, unknown> }

/** fetch() to the sensor. A 401 shows the login screen. */
export async function apiFetch(path: string, init: RequestInit = {}) {
  const response = await fetch(path, init)
  if (response.status === 401) signedOut()
  return response
}

export async function getJson<T>(path: string): Promise<T> {
  const response = await apiFetch(path, { cache: "no-store" })
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
  return await response.json() as T
}

/** Form-encoded POST. Never throws: network errors resolve to `ok: false`. */
export async function post(path: string, params: ApiParams = {}): Promise<ApiResult> {
  const body = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]))
  try {
    const response = await apiFetch(path, { method: "POST", body })
    const data = await response.json().catch(() => ({})) as Record<string, unknown>
    const error = response.ok ? "" : typeof data.error === "string" ? data.error : "failed"
    return { ok: response.ok, status: response.status, error, data }
  } catch {
    return { ok: false, status: 0, error: "offline", data: {} }
  }
}
