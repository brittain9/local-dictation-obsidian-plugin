---
title: Research log
date: 2026-07-27
aliases:
  - experiment notes
---

# Onderzoekslog: behandeling van fragmenten

Vraag: verbetert het grotere model de vertalingen, omdat het de documenten begrijpt, of komt het alleen maar door dat het beter is in het bepalen van afzonderlijke fragmenten?

## Opmerkingen/observaties

- Titelteksten worden gepresenteerd zonder dat er een onderliggend paragraaf bij staat.
- Elke ‘bullet’ wordt vertaald als een apart onderdeel.
  - De onderliggende bulletpoints verliezen de context die wordt gegeven door de overige bulletpoints.
  - Zeer korte labels, zoals “Blocked” of “Next”, zijn dubbelzinnig.
- In de tabellencellen kunnen zelfs zelfstandige naamwoorden staan, in plaats van zinnen.
- Een titel die wordt weergegeven in de interface kan eruitzien als een commando.

> [!question] – Mogelijk verwarrend.
> De plugin maakt momenteel gebruik van segmentatie per regel. Een model dat goed presteert op fragmenten, kan zelfs winnen, zelfs wanneer zijn lange-contextuele vertaling niet beter is.

Voorbeelden die zijn verzameld van: [[Release Notes]]:

| – Ongeldig bronfragment.
| – Opgegeven betekenis.
|
| --- | --- |
| – Klaar voor gebruik.
| – Installeeringsstatus: onbekend.
|
| – Verwijderen van deze link.
| – Verwijderen van deze link.
| – Verwijderen van deze link.
| – Huidige model.
| – Geselecteerd model.
|
| – Onbruikbaar.
| – Onbruikbaar. Het is geen prijs die relevant is.
|

De uitdrukking `model is cold` beschrijft een proces waarbij geen extra informatie wordt verwerkt. Het mag dus geen zin zijn die gaat over temperatuur. Hetzelfde geldt voor $t_{load} + t_{decode}$: het is een formule die op dezelfde manier moet blijven, zonder enige veranderingen.

```text
Input:  "No model selected"
Risk:   translating "model" as a fashion model
Signal: settings-screen context is absent
```

Volgende experiment:

1. Vertaal elke regel apart, met beide engines.
2. Vertaal hetzelfde materiaal in één paragraaf.
3. Vergelijk de terminologie, de voornaamwoorden en de vermijdbare onderwerpen.
4. Controleer of het behouden van de titel, ongeacht de veranderingen in de context, de uitkomst beïnvloedt.

Conclusie tot nu toe: een schijntje probleem met de kwaliteit van het model kan in werkelijkheid een probleem zijn met de segmentatie-strategie. Houd dit resultaat apart van het algemene probleem met de fluïniteit. #research/translation
