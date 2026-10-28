import { LedSection } from "@/components/led-section"
import { PageHeader } from "@/components/page"
import { useI18n } from "@/i18n"

export function LedPage() {
  const { t } = useI18n()
  return <>
    <PageHeader eyebrow={t("nav.system")} title={t("nav.led")} description={t("led.description")} />
    <LedSection />
  </>
}
