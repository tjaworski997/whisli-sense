// Shapes of the sensor's API answers (firmware: src/state.cpp, src/web.cpp).

export const GATES = 16
export const GATE_CM = 70

export type CalibrationPhase = "idle" | "leave" | "empty" | "back" | "still" | "done" | "failed"

export interface Calibration {
  phase: CalibrationPhase
  left: number // seconds left in the current phase
  emptyS: number
  margin: number // % above noise
  personMask: number // bit g: breathing stood out from noise in gate g
  hasPrevious: boolean // thresholds from before the calibration can be restored
  error: string
  noise: number[]
  person: number[]
  previousTrigger: number[]
  previousHold: number[]
}

export interface RadarState {
  working: boolean // report frames arrive
  loaded: boolean // settings read from the radar
  busy: boolean // writing / reading settings
  minGate: number
  maxGate: number
  delay: number // s
  trigger: number[]
  hold: number[]
  energy: number[] // per gate, max over the last second
}

export type ExtremesPeriod = "day" | "week" | "month"

/** Lowest and highest values over a period; null until the sensor has a reading in it */
export interface Extremes {
  temperatureMin: number | null
  temperatureMax: number | null
  humidityMin: number | null
  humidityMax: number | null
  luxMin: number | null
  luxMax: number | null
}

/** ws://<ip>/api/v1/ws and GET /api/v1/state */
export interface DeviceState {
  name: string
  hostname: string
  version: string
  uptime: number
  presence: number // 1 / 0 / -1 unknown
  distance: number // cm, -1 unknown
  temperature: number | null
  humidity: number | null
  lux: number | null
  extremes?: Record<ExtremesPeriod, Extremes> // missing on firmware before it was added
  problems: string[]
  radar: RadarState
  calibration: Calibration
  mqtt: MqttState
  rssi: number // dBm, 0 offline
  ip: string
  mac?: string // missing on older firmware
  heap: number // free bytes
  clock: number | null // unix time, null until SNTP answers
}

/** ws://<ip>/api/v1/live - the sensors overview */
export interface Summary {
  name: string
  host: string
  version: string
  presence: number
  distance: number
  temperature: number | null
  humidity: number | null
  lux: number | null
  problems: number
  rssi?: number // dBm, 0 offline; missing on older firmware
  ip?: string
  mac?: string
}

export interface Peer {
  self: boolean
  name: string
  host: string
  ip: string
  seenAgo?: number
}

export type MqttState = "disabled" | "connecting" | "connected" | "error"

export interface MqttSettings {
  enabled: boolean
  host: string
  port: number
  user: string
  hasPassword: boolean
  baseTopic: string
  defaultBaseTopic: string
  discovery: boolean
  discoveryPrefix: string
  state: MqttState
  error: string
}

export interface WifiStatus {
  wifi: { ssid: string; connected: boolean; ip?: string; rssi?: number; channel?: number; hostname: string }
  ap: { ssid: string; active: boolean; ip?: string; clients?: number; defaultPassword: boolean }
}

export interface WifiScan {
  scanning: boolean
  networks: { ssid: string; rssi: number; secure: boolean }[]
}

export interface SystemInfo {
  version: string
  id: string
  mac: string
  chip: string
  uptime: number
  resetReason: string
  heap: number
  minHeap: number
  firmwareSize: number
  firmwareSpace: number // size of the update partition, i.e. the largest firmware that fits
}

export interface SensorDiagnostics {
  found: boolean
  address: number
  valid: boolean
  reads: number
  errors: number
  lastError: string
}

export interface Diagnostics {
  sht30: SensorDiagnostics
  bh1750: SensorDiagnostics
  radar: {
    working: boolean
    firmware: string
    bytes: number
    frames: number
    acks: number
    badFrames: number
    lastFrameMs?: number
    outPin: number
    settingsLoaded: boolean
    error: string
    framesPerSecond?: number
    presenceChanges?: number
  }
  system?: {
    version: string; uptime: number; resetReason: string
    chip: string; chipRevision: number; cpuMhz: number; sdk: string
    heap: number; heapTotal: number; minHeap: number; maxBlock: number
    flash: number; firmwareSize: number; firmwareSpace: number
    loopPerSecond: number; loopAverageUs: number; loopMaxUs: number
  }
  network?: {
    ssid: string; connected: boolean; hostname: string; mac: string; disconnects: number; ap: boolean
    bssid?: string; channel?: number; rssi?: number; ip?: string; gateway?: string; subnet?: string; dns?: string; connectedFor?: number
  }
  mqtt?: { state: MqttState; error: string; host: string; port: number; base: string; published: number; connects: number }
}

export type LogLevel = "info" | "warning" | "error"
export interface LogEntry { id: number; uptimeMs: number; level: LogLevel; category: string; code: string; detail: string }
/** GET /api/v1/logs */
export interface LogResponse { sessionId: number; capacity: number; hasMore: boolean; entries: LogEntry[] }
