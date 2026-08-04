---
title: Local Translation Release Plan
status: draft
owners:
  - alex
tags:
  - local-dictation
  - release
---

# Plan voor de verwijzing van de lokale vertalingen

Het doel is eenvoudig: iemand in staat stellen om een deel van een tekst of een hele notitie te vertalen, zonder dat de tekst naar een remote service wordt gestuurd. De eerste versie moet voldoende voorspelbaar zijn, zodat het niet als ingewikkeld overkomt. De gebruiker kiest een brontaal, kiest een doeltaal, bekijkt de voorlopermeningen en besluit dan of hij de oorspronkelijke tekst moet vervangen, de resultaten onder de oorspronkelijke tekst moet invoegen, of de tekst gewoon moet kopiëren.

> [!important] – Release-bereik
> Vertaling moet optioneel blijven. Het installeren van een sprakmodel mag geen automatische download van een vertaalmodel veroorzaken. Bovendien moet het openen van Obsidian ook geen toewijzing van beide modellen naar de geheugen mogelijk maken.

## Wat moet er werken?

- Vertaal het korte paragraaf dat bestaat uit gewone zinnen.
  - Houd `npm run check` ongewoon.
  - Bewaar: [[Local Dictation]] en [[Model Manager|the model browser]].
  - Laat het bestemmingspunt achter op de websites [ en ](https://example.com/guide).
- Vertaal een volledige notitie, zonder de voorgaande delen van de notitie te veranderen.
- Annuleer een lange aanvraag, zonder de actieve bestandten in het geheel te wijzigen.
- Toon een nuttige manier om de toestand van het model te herstellen, wanneer het model niet meer beschikbaar is.
- Houd de tags zoals #release/translation en de formules zoals $E = mc^2$ ongehavend.

De voorvertoning is een soort veiligheidsgrens, en geen decoratieve interface. Vertaalingssystemen kunnen de terminologie, data, negatieve uitdrukkingen en benoemde entiteiten veranderen, terwijl ze toch nog steeds zeer soepele zinnen produceren. De knop ‘Vervangen’ wordt dus niet beschikbaar als de notitie na het maken van de voorvertoning wordt gewijzigd. De knoppen ‘Kopiëren’ en ‘Invoeren’ blijven wel beschikbaar, omdat ze de geselecteerde brongegevens niet overschrijven.

| Gateweg
| Doelwit
| Bewijs
|
| --- | ---: | --- |
| Warm 500 woorden. Note: 500 woorden is te veel voor deze nota.
| 15 seconden of minder.
| Drie lokale uitvoeringen.
|
| – Invalideerde gegevensopslag
| – 4 GB of minder gegevensopslag
| – Invalideerde processen
|
| – Integriteit van het model is ongeldig.
| – De SHA-256-waarde is ongeldig.
| – Metagegevens van de installator zijn ongeldig.
| – De rest van de gegevens is ongeldig.
| Markdown overleving…
| Nog niet slechter dan het basistabel.
| Ten-note corpus.
|

## Open vragen

1. Moeten de namen van de talen volgen de lokale instellingen van de Obsidian-interface, of moeten ze nog steeds in het Engels worden weergegeven?
2. Is de automatische detectie van bronnen voldoende nuttig om een nieuw model te rechtvaardigen?
3. Moeten we een lijst met terminologieën in de eerste versie hebben? Of kan deze lijst wachten tot er echt gebruikers die hem nodig hebben, vragen om hem te krijgen?

```ts
type TranslationDecision =
  | { action: "replace"; expectedRevision: number }
  | { action: "insert-below" }
  | { action: "copy" };
```

Het eenvoudigste antwoord is het beste: stuur de kleinste, betrouwbare versie van het model. Bekijk waar het model niet werkt, en vermijd het gebruik van een ‘fluitend overzicht’ als bewijs van semantische nauwkeurigheid. De verdere ontwikkeling vindt plaats op [[Translation Backlog]]. Hier zijn de benodigde invoer- en uitvoergegevens beschikbaar, zodat een toekomstig model tegen deze gegevens kan worden getest.

## Voordat de twee elementen worden gecombineerd

- [ ] Herstarten van het geïnstalleerde modelpakket.
- [ ] Beoordeel de kwaliteit van de vertaling in het Engels en Nederlands, door een spreker die vloeiend Engels spreekt.
- [ ] Controleer de beschermende tekens in het Japans.
- [ ] Registreer de beperkingen met betrekking tot het modellicentie-verleningsproces en de distributie van het model.
- [ ] Open de Obsidian opnieuw, nadat je de laatste set van bestanden hebt geinstalleerd.

De eigenaar kan ervoor kiezen om een langzamer downloadingsnelheid te accepteren. Echter moet het product duidelijk aangegeven worden dat dit een compromis is: een lagere downloadingsnelheid leidt tot een significante verbetering in de kwaliteit van het product. Het gaat hierbij echter niet alleen om een verschillende manier van schrijven.
