---
title: Reading notes on reliable systems
book: Designing for Failure
rating: 4
---

# Leesnotities

Het centrale argument is dat betrouwbaarheid afkomstig is van expliciete grenzen in plaats van optimistische aannames. Een systeem moet falen zichtbaar maken, voldoende bewijs bewaren om het te diagnosticeren en voorkomen dat één mislukte component in beschadigde gebruikersgegevens wordt omgezet.

## Ideeën die de moeite waard zijn om te bewaren

- Retry's zijn alleen veilig als de operatie idempotent is.
- Een time-out bewijst niet dat het werk is gestopt.
- “Precies één keer” is meestal een zakelijke invariant die bovenop zwakkere leveringsgaranties is gebouwd.
- Human review maakt deel uit van het systeem wanneer een geautomatiseerd resultaat vloeiend maar verkeerd kan zijn.

> [!quote] Geparafraseerd
> De gevaarlijkste mislukking is een plausibel resultaat dat in stilte een invariant schendt.

Dit brengt netjes in kaart voor vertaling. De preview kan er gepolijst uitzien terwijl hij van dinsdag naar woensdag verandert. Daarom moet de applicatie de originele notitie behouden en Replace als een voorwaardelijke schrijf behandelen. De voorwaarde is `currentRevision === capturedRevision`; als het vals is, kan de gebruiker het resultaat nog steeds kopiëren zonder nieuwer werk te overschrijven.

## Aansluitingen

1. [[Translation Safety Invariants]] — beschermde markeringen en herzieningscontroles.
2. [[Installer Design]] — download naar een tijdelijk bestand, verifieer SHA-256 en promoot vervolgens atoomachtig.
3. [[Worker Lifecycle]] — beëindigen na succes, annulering of fout.

| Concept | Vertaalvoorbeeld |
| --- | --- |
| Idempotentie | opnieuw een model downloaden | opnieuw proberen
| Validatie | marker bestellen en tellen |
| Isolatie | gevolgtrekking binnen een werknemer |
| Audit trail | benchmark inputs en outputs |

Het boek is af en toe repetitief, maar de woordenschat is nuttig. Ik moet het hoofdstuk over de tegendruk opnieuw bekijken voordat ik de aanvraagwachtrij verwissel. #reading/reliability
