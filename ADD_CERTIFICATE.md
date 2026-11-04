# Nieuwe certificaten toevoegen

Deze handleiding beschrijft hoe je een nieuwe set vragen van een ander certificaat
(bijvoorbeeld AZ-500 of SC-900) toevoegt aan de app. Je hoeft de app zelf niet aan te passen.

## Wat je nodig hebt

- De PDF met vragen **en antwoorden** van het certificaat (ExamTopics-opmaak).
  De PDF met alleen de vragen is optioneel; die gebruikt de importer alleen om het aantal te controleren.
- Python 3.9 of nieuwer.
- poppler (`pdftotext` en `pdftoppm`):
  - macOS: `brew install poppler`
  - Ubuntu/Debian: `sudo apt install poppler-utils`
  - Windows: installeer poppler via https://github.com/oschwartz10612/poppler-windows/releases en zet de map `bin` in je PATH.
- Optioneel, voor het scheiden van vraag en antwoord bij afbeeldingsvragen:
  `pip install pillow numpy`

## Stap voor stap

### 1. Kies een id voor het certificaat

Het id is een korte, kleine naam zonder spaties. Het wordt de mapnaam in `bank/`.

| Certificaat | id        |
|-------------|-----------|
| AZ-104      | `az-104`  |
| AZ-500      | `az-500`  |
| SC-900      | `sc-900`  |

### 2. Draai de importer

Vanuit de hoofdmap van de repository:

```bash
python3 tools/import_exam.py --id az-500 --name "AZ-500" \
    --pdf "/pad/naar/AZ-500_Exam_-_Answers.pdf" \
    --questions-pdf "/pad/naar/AZ-500_Exam_-_Questions.pdf"
```

Op Windows (PowerShell):

```powershell
python tools/import_exam.py --id az-500 --name "AZ-500" `
    --pdf "C:\pad\AZ-500_Exam_-_Answers.pdf" `
    --questions-pdf "C:\pad\AZ-500_Exam_-_Questions.pdf"
```

Het duurt ongeveer een minuut voor een bank van ruim 600 vragen.

### 3. Controleer de uitvoer

De importer schrijft iets zoals:

```
Vragen gevonden: 606
Controle: vragen-PDF heeft evenveel vragen (606).
Typen: {'single': 372, 'drag_drop': 22, 'multi': 24, 'hotspot': 188}
Afbeeldingen: 566 in .../bank/az-500/img
```

Let op deze signalen:

| Melding | Betekenis | Actie |
|---------|-----------|-------|
| `Vragen gevonden: 0` | De opmaak wordt niet herkend. | Zie "Andere opmaak" hieronder. |
| `WAARSCHUWING: vragen-PDF heeft X vragen, antwoorden-PDF Y` | De twee PDF's komen niet overeen. | Controleer of je de juiste PDF's gebruikt. |
| `Kopjes in PDF (X) komen niet overeen met vragen (Y)` | De afbeeldingen konden niet aan vragen worden gekoppeld. | Meestal een afwijkende PDF; zie hieronder. |
| Veel vragen van het type `answer_area` | Het antwoord staat alleen in een afbeelding. | Normaal voor sommige certificaten; de app toont het antwoord na "Toon antwoord". |

### 4. Test de app lokaal

```bash
python3 -m http.server 8000
```

Open daarna http://localhost:8000 in je browser. Het nieuwe certificaat staat in de lijst bovenaan
(bij meer dan één certificaat verschijnt een keuzemenu). Controleer:

- Oefenen met een willekeurige vraag: staan de opties en afbeeldingen goed?
- Een afbeeldingsvraag: verschijnt het antwoord pas na "Toon antwoord"?
- Examenmodus: start een kort examen (bijvoorbeeld 5 vragen).

Let op: service workers werken niet via `file://`. Gebruik dus altijd een lokale server of een
echte URL.

### 5. Zet het op de repository

```bash
git add bank tools
git commit -m "Add AZ-500 question bank"
git push
```

Als je deployt op Vercel of GitHub Pages wordt de nieuwe bank automatisch meegenomen.

## Hoe de bank is opgebouwd

```
bank/
  index.json            Lijst van certificaten die de app toont
  az-104/
    questions.json      Alle vragen van dit certificaat
    img/                Uitsneden van vragen met afbeeldingen
  az-500/
    ...
```

`bank/index.json` wordt door de importer bijgewerkt. Een certificaat met hetzelfde id wordt
vervangen als je de importer opnieuw draait. Een andere id voegt een nieuw certificaat toe.

## Andere opmaak

De importer is gebouwd voor de ExamTopics-opmaak. Herken je die niet, dan zijn dit de onderdelen
die je moet aanpassen in `tools/import_exam.py`:

| Functie | Wat het doet |
|---------|--------------|
| `parse_text()` | Knipt de tekst in vragen, opties en antwoorden. De regexen `HDR`, `SECTION` en `OPT` bepalen de herkenning. |
| `normalize()` | Bepaalt het type van elke vraag (enkel, meervoudig, hotspot, sleep-en-zet). |
| `crop_images()` | Knipt de afbeeldingen uit de PDF. Gebruikt de kopjes "Question #N" om de vragen te vinden. |

Meestal volstaat het om de regexen aan te passen. Maak een kopie van de bron en vergelijk die met
de tekst die de importer uitleest (`pdftotext -layout bron.pdf -`).

Het formaat van `questions.json` staat in de README. Als je het formaat zelf maakt, moet de app
dezelfde velden verwachten.

## Veelvoorkomende problemen

- **`pdftotext: command not found`**: poppler is niet geïnstalleerd of niet in je PATH.
- **Afbeeldingen ontbreken**: installeer `pillow` en `numpy`. Zonder deze twee vallen vragen met een
  afbeeldingsantwoord terug op de tekst "Correct Answer", en kan het antwoord in de vraagafbeelding
  zichtbaar zijn.
- **Oude bank blijft staan**: draai de importer met hetzelfde `--id`. Die vervangt de map volledig.
- **Vragen met een verkeerde letter**: controleer de PDF. De importer leest het antwoord zoals het in
  de bron staat. Het community-percentage laat zien hoe zeker die antwoorden zijn.
