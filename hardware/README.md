# Sprzęt whisli sense: gdzie jesteśmy

Stan na **2026-10-30**. Szczegóły są w README poszczególnych części:
[obudowa](enclosure/README.md) i [płytka](pcb/README.md).

## Stan

| Część | Stan | Co dalej |
|---|---|---|
| Firmware | działa na prototypie z płytką stykową (`biuro`, `salon`) | dopisać obsługę SCD41 |
| Obudowa sufitowa | skrypt Fusion i pliki STL gotowe, **nic jeszcze nie wydrukowane** | dostosować do PCB, wydrukować i sprawdzić |
| Płytka PCB v1 | skrypt KiCad, DRC czysty, zip pod JLCPCB gotowy, **jeszcze nie zamówiona** | sprawdzić piny modułów, potem zamówić |

## Najważniejsze decyzje

- **Gotowe moduły lutowane na płasko na okrągłej płytce Ø72**, bez goldpinów i bez montażu
  w fabryce. Wychodzi tanio, lutuje się lutownicą, a firmware zostaje bez zmian, bo piny
  są te same co w `src/board.h`.
- **Strona pomieszczenia:**
  - radar HMMD na środku,
  - BH1750 pod okienkiem światła,
  - komora czujników przy kratce z miejscem na SHT3x i SCD41 (można wlutować jeden z nich albo oba).
- **Strona sufitu:**
  - ESP32-C3-Zero, antena przy krawędzi,
  - przetwornica Pololu D36V6F5 (wejście 5,2–50 V),
  - pady na przewody zasilania.
- **Zasilanie 5–36 V**: krótki przewód z czujki łączy się z zasilaniem w puszce przez WAGO
  i przechodzi przez otwory odciążające przy J1. Przetwornica ma wejście do 50 V, ale na płytce jest
  opisane 5–36 V. Bez diody i bez zacisku: **USB tylko do pierwszego wgrania, nigdy razem
  z zasilaniem z J1.**
- **Obie części są generowane skryptami w repo**, a ręczne zmiany w Fusion i KiCadzie znikają przy
  następnym uruchomieniu skryptu.

## Do kupienia

| Moduł | Uwagi |
|---|---|
| ESP32-C3-Zero, HMMD, SHT3x (fiolet, 4 piny), BH1750 GY-302 | to samo co w prototypie |
| Pololu D36V6F5 | np. Kamami; 13 × 10 × 3 mm |
| SCD41, moduł 4-pin ~13,4 × 21,6 mm | opcja; kolejność pinów VCC, GND, SCL, SDA |
| wkładki M2,5, śruby M2,5 | mocowanie płytki do słupków podstawy |
| przewód silikonowy 0,25–0,5 mm², goldpiny (zsuwa się z nich plastik) | lutowanie modułów, przewód zasilania ~15 cm |
| złączka WAGO 221 (2×) | połączenie przewodu czujki z zasilaniem w puszce |

## Następne kroki (w tej kolejności)

1. **Sprawdzić moduły** suwmiarką:
   - kolejność pinów,
   - położenie rzędu pinów i samego czujnika (SHT3x, BH1750, SCD41),
   - wysokość SCD41 i C3-Zero z USB.

   W razie różnic poprawić `SHT3X`, `BH1750` i `SCD41` w `pcb/whisli_sense_pcb.py` i uruchomić skrypt.
2. **Zamówić PCB:** wgrać `pcb/fab/whisli-sense-v1-2026-10.zip` na https://cart.jlcpcb.com/quote
   (2 warstwy, 1,6 mm, HASL, bez montażu).
3. **Dostosować obudowę do PCB** (`enclosure/fusion/whisli_sense_enclosure.py`):
   - zamiast drukowanej płytki montażowej wchodzi PCB 1,6 mm (`PLATE_T`);
   - ramka komory jako osobna część do przyklejenia na PCB;
   - `CHAMBER` → `(-17.3, -29.0, 17.3, -13.0)`, kratka przesunie się sama;
   - makiety modułów na pozycje z płytki, radar 20 × 20;
   - sprawdzić kolizje, zwłaszcza łby śrub do puszki pod przetwornicą (zapas ~0,5 mm)
     i SCD41 pod pokrywą (~1 mm).
4. **Wydrukować komplet** i sprawdzić bagnet, logo i okienko światła (lista w README obudowy).
5. **Firmware: SCD41.**
   - Wykrywanie na I2C (0x62) i odczyt CO₂.
   - Gdy są oba czujniki, temperatura i wilgotność z SHT30.
   - Nowa encja CO₂ w MQTT; istniejące `unique_id` bez zmian.
6. **Złożyć i przetestować:**
   - temperatura w komorze (czy ESP i przetwornica jej nie zawyżają),
   - zasięg radaru przez pokrywę,
   - współczynnik światła przez ściankę 0,5 mm.

## Otwarte sprawy

- Logo na pokrywie: zostaje obecne albo wariant A lub B. Decyzja po zobaczeniu na suficie.
- Wariant na 230 V z zasilaczem w środku: podstawa ~10 mm wyższa, przegroda, filament V-0.
- Przy kolejnej partii płytek podbić `VERSION` w skrypcie płytki.
