---
title: Reading notes on reliable systems
book: Designing for Failure
rating: 4
---

# Leesnotities

Het centrale argument is dat betrouwbaarheid afkomstig is van duidelijke grenzen, en niet van optimistische aannames. Een systeem moet het gebrek aan betrouwbaarheid zichtbaar maken, voldoende bewijsmateriaal bewaren om dit te kunnen diagnosticeren, en ervoor zorgen dat een gebroken component de gebruikersgegevens niet beschadigt.

## Ideeë die het de moeite waard zijn om te behouden

- Oefeningen zijn alleen veilig wanneer de operatie idempotent is.
- Een timeout bewijst niet dat het werk is gestopt.
- “Exactly once” is een principe dat in de praktijk wordt toegepast in bedrijfsomgevingen. Dit principe is echter gebaseerd op minder sterke garanties voor de uitvoering van taken.
- Mensenlijke evaluaties maken deel uit van het systeem. Als een automatisch berekende resultaat correct is, maar toch onjuist is, dan wordt er nog een beoordeling door mensen uitgevoerd.

> [!quote] – Onbegrijpelijk/inhoudeloos
> Het gevaarlijkste falen is een resultaat dat op het eerste gezicht logisch lijkt, maar in werkelijkheid een ongeldige uitkomst is.

De voorbeeldversie ziet er goed uit wanneer de tijd van ‘dinsdag’ naar ‘woensdag’ wordt gewijzigd. Hierdoor moet de applicatie de oorspronkelijke notities behouden en ‘Replace’ als een conditionele actie beschouwen. De conditie is `currentRevision === capturedRevision`; als deze conditie niet geldt, kan de gebruiker toch het resultaat kopiëren, zonder dat de nieuwere gegevens worden gewist.

## Verbindingen

1. [[Translation Safety Invariants]] – Beschermde markers en controles op de revisie.
2. [[Installer Design]] – Download het bestand naar een tijdelijk bestand. Verifieer de SHA-256-hashingwaarde van het bestand. Vervolgens moet het bestand atomisch worden geplaatst op de juiste plek.
3. [[Worker Lifecycle]] – Einde van de verbinding na succes, annulering of een fout.

| Concept
| Translatievoorbeeld
|
| --- | --- |
| – Idempotentie
| – Herovergenomen modeldownload
|
| Validering
| Markering van bestellingen en tellingen
|
| – Isolatie
| – Inferfering binnen een werknemer
|
| – Ongeldige audittrails
| – Ongeldige invoertarieven en uitvoertarieven
|

Het boek bevat soms te veel herhalingen. Maar het woordenschat in het boek is nuttig. Ik moet nog eens kijken naar het hoofdstuk over backpressure, voordat ik de ‘request queue’ verander. #reading/reliability
