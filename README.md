# certification-killer

Persoonlijke oefenapp voor multiple-choice certificeringen (bijvoorbeeld Microsoft AZ-104).
Werkt in de browser op telefoon en laptop, is op te slaan als app op het beginscherm en
werkt daarna ook offline.

## Wat de app kan

- **Oefenen** per onderwerp, met filters: alle vragen, nog niet beantwoord, fout beantwoord, gemarkeerd.
- **Examenmodus**: willekeurige vragen uit de hele bank, met timer. Antwoorden worden pas aan het eind nagekeken.
- **Voortgang**: score per onderwerp en eerdere examens. Alles staat in de browser van het apparaat.
- **Afbeeldingsvragen** (hotspot, sleep-en-zet, tabellen en exhibits) worden als plaatje getoond.
  Bij vragen zonder tekstantwoord zie je het antwoord pas na "Toon antwoord".

De app is niet aan één certificaat gekoppeld. Elk certificaat staat in `bank/<id>/`, en
`bank/index.json` vertelt de app welke certificaten er zijn.

## Structuur

```
index.html, app.js, style.css   De app (statisch, geen build-stap)
manifest.json, sw.js            Installeerbaar en offline-ondersteuning
bank/index.json                 Lijst van beschikbare certificaten
bank/<id>/questions.json        Vragen van één certificaat
bank/<id>/img/*.jpg             Uitsneden van vragen met afbeeldingen
tools/import_exam.py            Zet een ExamTopics-PDF om naar een bank
```

## Een nieuwe set vragen toevoegen

1. Zorg dat de PDF met vragen en antwoorden in de ExamTopics-opmaak staat
   (kopjes als "Question #1 Topic 1", opties "A. …", regels "Correct Answer: …").
2. Draai de importer. Gebruik een nieuwe `--id` voor een ander certificaat:

   ```bash
   python3 tools/import_exam.py --id az-500 --name "AZ-500" \
       --pdf "/pad/AZ-500_Answers.pdf" \
       --questions-pdf "/pad/AZ-500_Questions.pdf"   # optioneel, voor controle
   ```

3. Open de app. Het nieuwe certificaat staat in de lijst bovenaan.

Vereisten voor de importer: Python 3.9+ en poppler (`pdftotext`, `pdftoppm`).
Voor het afsnijden van het antwoordvak van vragen met afbeeldingsantwoord: `pip install pillow numpy`.
Zonder deze twee werkt het importeren ook, alleen valt de scheiding tussen vraag en antwoord dan
terug op de regel "Correct Answer".

Als een nieuwe PDF een andere opmaak heeft dan ExamTopics, moet `parse_text()` in
`tools/import_exam.py` worden aangepast. De rest (afbeeldingen, opslag, app) blijft gelijk.

## Het formaat van questions.json

```json
{
  "certificate": { "id": "az-104", "name": "AZ-104", "source": "…pdf" },
  "questions": [
    {
      "id": 1,                 // uniek binnen het certificaat
      "number": 1,             // nummer in de bron
      "topic": 1,              // onderwerp uit de bron
      "type": "single",        // single | multi | hotspot | drag_drop | answer_area
      "question": "…",
      "options": [{ "letter": "A", "text": "…" }],
      "correct": ["C"],        // leeg bij hotspot/sleep-en-zet zonder tekstantwoord
      "answer_text": null,     // tekstuitleg, indien aanwezig
      "community_pct": 97,     // stemming community voor het juiste antwoord (of null)
      "images": ["img/q023_1.jpg"],          // vraag-afbeeldingen
      "answer_images": ["img/q023_a1.jpg"]   // antwoord-afbeeldingen (alleen na "Toon antwoord")
    }
  ]
}
```

## Publiceren (optioneel)

De app is statisch, dus je kunt de map op elke statische host zetten, bijvoorbeeld GitHub Pages.
Let op: de vragen komen van ExamTopics. Gebruik de app voor eigen studie, en zet de repository
niet publiek als je de vragen niet openbaar wilt delen.

## Ontwikkelen

Open `index.html` via een lokale server (service workers werken niet via `file://`):

```bash
python3 -m http.server 8000
```
