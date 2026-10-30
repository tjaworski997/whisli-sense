# Płytka whisli sense

Okrągła płytka nośna Ø72 mm do obudowy sufitowej (`../enclosure`). Gotowe moduły lutuje się
**na płasko, bez goldpinów**. Z płytki zamawia się sam laminat, bez montażu.

## Pliki

| Plik | Co to jest |
|---|---|
| `whisli_sense_pcb.py` | źródło płytki: skrypt buduje całość od zera, wymiary i połączenia na górze pliku |
| `whisli-sense.kicad_pcb`, `.kicad_pro` | wynik skryptu: do podglądu w KiCadzie i do eksportu Gerberów |

Płytka zmienia się **tylko w skrypcie**. Ręczne poprawki w KiCadzie znikną przy następnym
uruchomieniu skryptu. Uruchomienie (KiCad 10):

```sh
/Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/Current/bin/python3 \
    hardware/pcb/whisli_sense_pcb.py
```

Skrypt na końcu wywołuje `kicad-cli pcb drc --refill-zones`, który wylewa miedź i sprawdza płytkę.
Raport trafia do `drc.rpt`. Musi pokazywać 0 naruszeń i 0 niepołączonych padów.

## Układ (widok od strony pomieszczenia, +Y to tył, −Y to przód z logo)

**Przód (F, do pomieszczenia):**

| Ozn. | Moduł | Gdzie |
|---|---|---|
| U2 | radar HMMD 20 × 20 | środek, anteny w stronę pokrywy |
| U5 | BH1750 GY-302 | czujnik pod okienkiem światła (0; 18,5) |
| U4 | SCD41 (opcja) | komora czujników, z lewej |
| U3 | SHT3x | komora czujników, z prawej, czujnik w stronę kratki |

**Tył (B, do sufitu):**

| Ozn. | Moduł | Gdzie |
|---|---|---|
| U1 | ESP32-C3-Zero | półotwory przylutowane do padów, antena przy krawędzi, pod nią brak miedzi |
| U6 | Pololu D36V6F5 | przetwornica 5,2–50 V → 5 V |
| J1 | pady VIN / GND | przewody zasilania z otworu w podstawie |

**Pozostałe elementy:**

- Komora czujników ma ramkę drukowaną osobno i przyklejoną według obrysu na sitodruku.
- Szczelina pod komorą przerywa przepływ ciepła od ESP i przetwornicy.
- 3 otwory Ø2,8 na słupki M2,5 (r = 30 mm).
- Napis od strony sufitu: „whis.li sense” w Helvetica Neue (jak na pokrywie), wersja płytki
  (`VERSION` w skrypcie) oraz oznaczenie padów zasilania: + / − i 5–36 V.
  Przy nowej partii płytek podbij wersję. Font jest systemowy na macOS, więc Gerbery eksportuj na
  Macu, inaczej KiCad podstawi własny font.

## Połączenia

Piny ESP32 są te same co w `src/board.h`: I2C SDA 4 i SCL 5, radar RX 6 / TX 7 / OT2 3.

- Warstwa B to masa, warstwa F to +3V3.
- VIN i 5 V idą ścieżkami 0,6 mm, sygnały ścieżkami 0,3 mm.
- SHT3x (0x44), SCD41 (0x62) i BH1750 (0x23) siedzą na jednej magistrali I2C. Można wlutować
  SHT3x, SCD41 albo oba. Pull-upy są na modułach.

## Decyzje

- Moduły na płasko zamiast gotowych układów montowanych przez JLC: tanio, lutowanie lutownicą,
  firmware bez zmian.
- Bez diody między przetwornicą a USB: **nie podłączaj USB, gdy płytka jest zasilana z J1.**
  USB służy tylko do pierwszego wgrania, potem aktualizacje idą przez OTA.
- Bez zacisku śrubowego, który jest za wysoki na 6 mm od strony sufitu. Przewody lutuje się do J1.
- Przetwornica Pololu ma stałe wymiary i wejście do 50 V. Tanie MP1584 mają maks. ~28 V
  i różne rozmiary.

## Lutowanie na płasko

1. Z goldpinu zsuń plastikową listwę.
2. Wsuń piny przez moduł i płytkę, dociśnij moduł płasko i przylutuj z obu stron.
3. Utnij końcówki pinów.

C3-Zero przykłada się półotworami do padów i lutuje od boku.

## Do sprawdzenia przed zamówieniem

1. **Kolejność pinów kupionych modułów** z sitodrukiem płytki:
   - SHT3x: VIN, GND, SCL, SDA,
   - SCD41: VCC, GND, SCL, SDA,
   - BH1750: VCC, GND, SCL, SDA, ADDR.
2. Wymiary SHT3x i BH1750 wziąłem ze zdjęcia, a SCD41 to typowy moduł 13,4 × 21,6. Zmierzyć
   suwmiarką: chodzi o położenie rzędu pinów i czujnika.
3. Obudowa: zamiast drukowanej płytki montażowej wchodzi PCB 1,6 mm. Ramkę komory trzeba wydzielić
   jako osobną część, a w skrypcie obudowy przenieść `CHAMBER`, kratkę i makietę radaru (20 × 20).

## Zamówienie (JLCPCB)

Skrypt robi gotowy plik `fab/whisli-sense-<wersja>.zip` (Gerbery i wiercenia, poza gitem).
Wgraj go na https://cart.jlcpcb.com/quote. Parametry: 2 warstwy, 1,6 mm, HASL, dowolny kolor,
bez montażu (PCB Assembly wyłączone).
