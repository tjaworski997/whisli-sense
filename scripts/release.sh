#!/usr/bin/env bash
# Builds a public release and publishes it on GitHub Releases:
#   whisli-sense-<version>-full.bin  first flash over USB at 0x0 (bootloader + partitions + firmware)
#   whisli-sense-<version>.bin       update over Wi-Fi (panel or POST /api/v1/firmware)
# Release builds never include src/local_defaults.h (RELEASE_BUILD), and the result is checked for it.
# Needs PlatformIO, Node.js (ui/node_modules) and gh signed in. Usage: scripts/release.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.platformio/penv/bin:$PATH"

version="0.001.$(date +%Y%m%d%H%M)"
tag="v$version"
build=".pio/build/whisli-sense"
out=".pio/release"

if [ -n "$(git status --porcelain)" ]; then
  echo "Commit your changes first - a release is built from a committed state." >&2
  exit 1
fi
git push -q origin HEAD

WHISLI_SENSE_VERSION="$version" PLATFORMIO_BUILD_FLAGS="-DRELEASE_BUILD" pio run
rm -rf "$out"
mkdir -p "$out"
cp "$build/firmware.factory.bin" "$out/whisli-sense-$version-full.bin"
cp "$build/firmware.bin" "$out/whisli-sense-$version.bin"

# Safety net: the local Wi-Fi defaults must not be in a public file
if [ -f src/local_defaults.h ]; then
  ssid=$(sed -n 's/.*DEFAULT_WIFI_SSID "\(.*\)".*/\1/p' src/local_defaults.h)
  if [ -n "$ssid" ] && grep -qF -- "$ssid" "$out"/*.bin; then
    echo "The local Wi-Fi network is in the release build - stopping." >&2
    exit 1
  fi
fi

notes=$(cat <<EOF
**English** below · [Polski](#polski)

### Install
**First time, over USB:** connect the ESP32-C3-Zero, open [esptool-js](https://espressif.github.io/esptool-js/) in Chrome or Edge, *Connect*, choose \`whisli-sense-$version-full.bin\` at address \`0x0\`, *Program*. Or from a terminal: \`esptool.py --chip esp32c3 write_flash 0x0 whisli-sense-$version-full.bin\`. If the board does not connect, hold BOOT while plugging in the cable. The first flash clears saved settings.

Then join the Wi-Fi network **Whisli-Sense-XXXX** (password \`whisli_gogo\`) and open http://192.168.4.1/ – panel password \`whisli_gogo\`.

**Update over Wi-Fi:** System → Settings → Firmware → \`whisli-sense-$version.bin\`, or
\`curl -u whisli:<password> -H "Content-Type: application/octet-stream" --data-binary @whisli-sense-$version.bin http://<sensor>/api/v1/firmware\`. Settings stay.

---

### Polski
**Pierwsze wgranie, przez USB:** podłącz ESP32-C3-Zero, otwórz [esptool-js](https://espressif.github.io/esptool-js/) w Chrome albo Edge, *Connect*, wybierz \`whisli-sense-$version-full.bin\` pod adresem \`0x0\`, *Program*. Albo w terminalu: \`esptool.py --chip esp32c3 write_flash 0x0 whisli-sense-$version-full.bin\`. Jeśli płytka się nie łączy, przytrzymaj BOOT przy podłączaniu kabla. Pierwsze wgranie kasuje zapisane ustawienia.

Potem połącz się z siecią **Whisli-Sense-XXXX** (hasło \`whisli_gogo\`) i otwórz http://192.168.4.1/ – hasło panelu \`whisli_gogo\`.

**Aktualizacja przez Wi-Fi:** System → Ustawienia → Firmware → \`whisli-sense-$version.bin\` albo
\`curl -u whisli:<hasło> -H "Content-Type: application/octet-stream" --data-binary @whisli-sense-$version.bin http://<czujka>/api/v1/firmware\`. Ustawienia zostają.
EOF
)

gh release create "$tag" "$out"/*.bin --target "$(git rev-parse HEAD)" --title "whisli sense $version" --notes "$notes"
echo "Published $tag"
