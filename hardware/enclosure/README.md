# Obudowa sufitowa whisli sense

Okrągła czujka na sufit w stylu „jak Apple”: gładka, jednokolorowa, z jak najmniejszą liczbą otworów.
Podstawę przykręca się do sufitu (puszka podtynkowa), pokrywę zakłada się na bagnet.

## Pliki

| Plik | Co to jest |
|---|---|
| `fusion/whisli_sense_enclosure.py` | źródło modelu: skrypt Fusion, który buduje całość od zera; wymiary na górze pliku |
| `print/pokrywa.stl`, `print/podstawa.stl`, `print/plytka.stl` | części do druku |
| `print/whisli-sense-obudowa.step` | cały złożony model (z makietą elektroniki) |

Model zmienia się **tylko w skrypcie** – po zmianie uruchom go ponownie i wyeksportuj STL.

## Jak pracujemy z Fusionem (MCP)

- Fusion Personal, wersja 2706+. *Preferencje → Ogólne → API → Serwer Fusion MCP* (port 27182).
- Claude Code: `claude mcp add --transport http -s user fusion http://127.0.0.1:27182/mcp`
  (koniecznie `127.0.0.1` – na `localhost` Fusion odpowiada „Invalid Host header”).
- Fusion musi być uruchomiony. Skrypt odpala się narzędziem `fusion_mcp_execute`
  (`featureType: "script"`) albo ręcznie z *Narzędzia → Skrypty i dodatki*.
- Każde uruchomienie tworzy nowy, niezapisany dokument.

## Układ (model: Z = 0 to sufit, +Z w dół do pomieszczenia, −Y to przód z logo)

- **Pokrywa** Ø85 × 20,5 mm, ścianka i dno 2 mm, krawędź od dołu R4.
  - Od sufitu odsunięta o **1,5 mm** – ukryta szczelina, którą wchodzi powietrze; z boku wygląda jak cień.
  - Dno: **grawer fal** (0,6 mm) nad radarem, **jedna kratka 7 × Ø1,6** pod komorą czujników,
    **okienko światła** – bez otworu, ścianka pocieniona do 0,5 mm (Ø4).
  - Bok: **wtopione logo** „whis.li” 7 mm + „sense” 4,5 mm, głębokość 0,5 mm, Helvetica Neue,
    czytelne po zawieszeniu (góra liter w stronę sufitu).
- **Bagnet**: 3 zaczepy w pokrywie, wycięcia L w pierścieniu podstawy, obrót **25° w prawo patrząc
  od dołu**, zatrzask (klik). Przedni zaczep szerszy (20° zamiast 12°) – logo zawsze ląduje z przodu.
  Zaczepy i wycięcia mają skos 45°, więc wszystko drukuje się bez podpór. Luz 0,3 mm (`CLEAR`),
  wcisk zatrzasku 0,3 mm (`DETENT`).
- **Podstawa** Ø79: wycięcia w łuk na śruby (rozstaw 60 mm, ±12°, żeby dało się obrócić logo po
  przykręceniu), otwór Ø16 na przewód, 3 słupki na wkładki M2,5, wygrawerowana strzałka „przód”.
- **Płytka montażowa** Ø72 na słupkach:
  - od strony pomieszczenia: radar HMMD na środku, **komora SCD41 + SHT30** przy kratce
    (ścianki prawie do dna pokrywy, szczelina w płytce odcina ciepło), BH1750 pod okienkiem;
  - od strony sufitu: ESP32-C3-Zero, przetwornica 5 V, zacisk zasilania.
- Przepływ powietrza: kratka → komora czujników → szczelina 1,5 mm przy suficie.

## Decyzje

- **Zasilanie 5–24 V** z przetwornicą w środku. 230 V lepiej trzymać w puszce (zasilacz w suficie);
  jeśli kiedyś w środku – podstawa ~10 mm wyższa, przegroda, filament V-0.
- **CO₂: SCD41** (dyfuzja, wystarczy wspólna kratka z SHT30). SHT30 zostaje, bo dokładniejszy.
- **Bagnet zamiast gwintu**: szybciej (¼ obrotu), logo zawsze w tym samym miejscu, łatwy druk.
- **Grawer jednokolorowy** zamiast druku dwukolorowego.
- Narzędzie: Fusion + skrypt w repo (wersjonowany, parametryczny) zamiast klikania.

## Druk (Bambu Lab P2S)

- Prototypy: **SUNLU PLA Matte White**. Docelowo: **SUNLU High-Speed Matte PETG White**
  (PLA mięknie ~55 °C; ASA byłby najlepszy, ale SUNLU nie ma białego). Po zmianie materiału
  sprawdzić luz bagnetu jeszcze raz (±0,1 mm).
- **Pokrywę obrócić dnem do stołu** (*Lay on face*, F) – STL jest w pozycji jak na suficie.
  Podstawa i płytka leżą dobrze.
- Teksturowana płyta PEI, bez podpór, 3 ścianki, 15% wypełnienia. Pokrywa ładniej na 0,12 mm
  i wolniej na ściance zewnętrznej; PETG wysuszyć (65 °C, 6–8 h).
- Zużycie: ~50 g na komplet (pokrywa ~22 g, podstawa ~19 g, płytka ~10 g), ~1,5–2 h przy 0,2 mm.
  4 komplety: stół 1 – 4 pokrywy, stół 2 – 4 podstawy + 3 płytki, ~200 g i 8–9 h.

## Do zrobienia

1. Wydrukować **jeden komplet** i sprawdzić:
   - bagnet: wchodzi, obraca się 25°, klika, nie odkręca się sam (`CLEAR`, `DETENT`),
   - czy „sense” nie jest zalane, czy fale i logo są czytelne,
   - czy okienko światła prześwituje, wkładki M2,5 w słupkach.
2. Zmierzyć suwmiarką moduły (radar HMMD, płytka SCD41, przetwornica, zacisk) – w modelu są
   przybliżenia (`build_electronics`).
3. Logo: po zobaczeniu na suficie zdecydować – zostaje, wariant A (whis.li 5,5 mm + sense 4,5 mm)
   albo B (jedna linia „whis.li sense” 4,5–5 mm). „sense” nie mniej niż 4,5 mm.
4. Światło: współczynnik w firmware (ścianka 0,5 mm tłumi); jeśli za słabo – otwór Ø2
   z przezroczystym pręcikiem.
5. Ewentualnie wariant podstawy pod 230 V.
