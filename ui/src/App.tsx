import { CircleX, House, LayoutGrid, LogOut, Moon, Radar, Settings, Sun, type LucideIcon } from "lucide-react"
import { Fragment, useEffect, type ReactNode } from "react"

import { Button } from "@/components/button"
import { DeviceProvider, useDevice } from "@/hooks/use-device"
import { useTheme } from "@/hooks/use-theme"
import { localeLabels, useI18n, type Locale, type TranslationKey } from "@/i18n"
import { post } from "@/lib/api"
import { checkAuth, signedOut, useAuth } from "@/lib/auth"
import { pageHash, useRoute, type Page } from "@/lib/route"
import { cn } from "@/lib/utils"
import { CalibrationPage } from "@/pages/calibration-page"
import { DiagnosticsPage } from "@/pages/diagnostics-page"
import { LedPage } from "@/pages/led-page"
import { LogsPage } from "@/pages/logs-page"
import { LoginPage } from "@/pages/login-page"
import { MqttPage } from "@/pages/mqtt-page"
import { NetworkPage } from "@/pages/network-page"
import { RadarSettingsPage } from "@/pages/radar-settings-page"
import { SensorsPage } from "@/pages/sensors-page"
import { SettingsPage } from "@/pages/settings-page"
import { StartPage } from "@/pages/start-page"

// A section's sub-pages show under it while one of them is open.
type NavigationItem = { page: Page; label: TranslationKey; icon: LucideIcon; children?: { page: Page; label: TranslationKey }[] }
const navigation: NavigationItem[] = [
  { page: "start", label: "nav.start", icon: House },
  { page: "radarSettings", label: "nav.radar", icon: Radar, children: [
    { page: "radarSettings", label: "nav.radarSettings" },
    { page: "calibration", label: "nav.calibration" },
  ] },
  { page: "sensors", label: "nav.sensors", icon: LayoutGrid },
  { page: "settings", label: "nav.system", icon: Settings, children: [
    { page: "settings", label: "nav.settings" },
    { page: "network", label: "nav.network" },
    { page: "mqtt", label: "nav.mqtt" },
    { page: "led", label: "nav.led" },
    { page: "diagnostics", label: "nav.diagnostics" },
    { page: "logs", label: "nav.logs" },
  ] },
]

const pages: Record<Page, () => ReactNode> = {
  start: () => <StartPage />,
  sensors: () => <SensorsPage />,
  radarSettings: () => <RadarSettingsPage />,
  calibration: () => <CalibrationPage />,
  settings: () => <SettingsPage />,
  network: () => <NetworkPage />,
  mqtt: () => <MqttPage />,
  diagnostics: () => <DiagnosticsPage />,
  logs: () => <LogsPage />,
  led: () => <LedPage />,
}

export default function App() {
  const auth = useAuth()
  useEffect(() => { void checkAuth() }, [])
  if (auth === "unknown") return <div className="whisli-page min-h-screen" />
  if (auth === "signedOut") return <LoginPage />
  return <DeviceProvider><Panel /></DeviceProvider>
}

async function logout() {
  await post("/api/v1/auth/logout")
  signedOut()
}

function Panel() {
  const { t, locale, setLocale } = useI18n()
  const { theme, toggleTheme } = useTheme()
  const { page, navigate } = useRoute()
  const { state, connected } = useDevice()

  useEffect(() => { document.title = state ? `${state.name} · whisli sense` : "whisli sense" }, [state?.name])

  return <div className="whisli-page min-h-screen text-sm">
    <header className="whisli-line flex h-14 items-center gap-2 border-b px-4 md:px-6">
      <b className="text-base">whisli sense</b>
      {state && <span className="whisli-muted ml-2 hidden truncate sm:inline">{state.name}</span>}
      {state && !connected && <span role="status" className="whisli-status-error ml-2 inline-flex min-w-0 items-center gap-1.5 text-xs">
        <CircleX className="size-4 shrink-0" /><span className="truncate">{t("app.disconnected")}</span>
      </span>}
      <select className="whisli-select ml-auto h-8 text-xs" aria-label={t("app.language")} value={locale} onChange={event => setLocale(event.target.value as Locale)}>
        {Object.entries(localeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <Button variant="ghost" className="w-9 justify-center px-0" aria-label={t("app.theme")} title={t("app.theme")} onClick={toggleTheme}>
        {theme === "light" ? <Moon className="size-4" /> : <Sun className="size-4" />}
      </Button>
      <Button variant="ghost" className="w-9 justify-center px-0" aria-label={t("app.logout")} title={t("app.logout")} onClick={() => void logout()}>
        <LogOut className="size-4" />
      </Button>
    </header>

    <div className="md:grid md:min-h-[calc(100vh-56px)] md:grid-cols-[220px_1fr]">
      {/* Phone: a horizontal, scrollable bar. Desktop: a sidebar with the firmware version at the bottom. */}
      <aside className="whisli-line border-b md:flex md:flex-col md:border-r md:border-b-0 md:px-4 md:py-5">
        <nav className="flex gap-1 overflow-x-auto px-2 py-2 [scrollbar-width:none] md:block md:space-y-1 md:overflow-visible md:p-0">
          {navigation.map(({ page: target, label, icon: Icon, children }) => {
            const inSection = page === target || Boolean(children?.some(child => child.page === page))
            return <Fragment key={target}>
              <NavLink page={target} current={!children && inSection} onNavigate={navigate}
                className={cn("flex shrink-0 items-center gap-2 rounded-md px-3 py-2 md:w-full md:gap-3", inSection && !children ? "whisli-nav-active" : inSection ? "font-medium" : "whisli-nav")}>
                <Icon className="size-4" />{t(label)}
              </NavLink>
              {inSection && children?.map(child => <NavLink key={child.page} page={child.page} current={page === child.page} onNavigate={navigate}
                className={cn("flex shrink-0 items-center rounded-md px-3 py-1.5 md:ml-7 md:w-[calc(100%-1.75rem)]", page === child.page ? "whisli-nav-active" : "whisli-nav")}>
                {t(child.label)}
              </NavLink>)}
            </Fragment>
          })}
        </nav>
        <footer className="whisli-line whisli-muted mt-auto hidden border-t pt-4 text-xs md:block">
          <p>{t("app.firmware")}</p>
          <p className="mt-1 font-mono">{state?.version ?? __VERSION__}</p>
        </footer>
      </aside>
      <main className="min-w-0 px-4 py-6 md:px-8 md:py-7 lg:px-10">{pages[page]()}</main>
    </div>
  </div>
}

/** A real link: middle click and Ctrl/Cmd+click open a new tab; a plain click stays in the app. */
function NavLink({ page, current, className, onNavigate, children }: { page: Page; current: boolean; className: string; onNavigate: (page: Page) => void; children: ReactNode }) {
  return <a href={pageHash(page)} aria-current={current ? "page" : undefined} className={className}
    onClick={event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      onNavigate(page)
    }}>{children}</a>
}
