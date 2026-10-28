import { Volume2, VolumeX } from "lucide-react"

import { Button } from "@/components/button"
import { toggleRadarSound, useRadarSoundEnabled } from "@/hooks/use-radar-sound"
import { useI18n } from "@/i18n"
import { cn } from "@/lib/utils"

/** Distance beeps on/off - the same switch wherever the icon appears. */
export function SoundButton() {
  const { t } = useI18n()
  const on = useRadarSoundEnabled()
  return <Button variant="ghost" aria-pressed={on} aria-label={t(on ? "start.soundOn" : "start.soundOff")}
    title={t("start.soundHint")} onClick={toggleRadarSound}
    className={cn("size-8 justify-center px-0", on && "whisli-status-ok")}>
    {on ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
  </Button>
}
