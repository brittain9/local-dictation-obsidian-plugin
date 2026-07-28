---
title: Weekly team meeting
attendees: [Alex, Morgan, Priya]
---

# Wekelijkse teamvergaderingen

## Beslissingen

- Houd de snelle Firefox-engine als standaardinstelling.
- Kijk naar elke grotere model als een optionele kwaliteitslaag.
- Probeer niet om ‘professionele vertalingen’ te bieden, zonder dat deze eerst door moederslijke vertalers zijn gecontroleerd.
- Meten van de latency van de berichten op eindpunt, in plaats van alleen de aantallen berichten per seconde te noteren.

> [!decision] Gebruiksregels voor het downloaden van de inhoud
> Er mag geen artefact dat wordt beheerd door een bepaalde database in het catalog terechtkomen. De installator moet in staat zijn om alle bestanden anoniem te verkrijgen en de controlewaarden van deze bestanden te controleren.

## Discussie

Morgan rapporteerde dat de Portugese uitingen niet correct klonken, zelfs wanneer de zinnen wel versteld konden worden. De groep vermoedt dat er een dialectverschil is: het model geeft waarschijnlijk de voorkeur aan Braziliaans Portugees, terwijl het verwachte resultaat juist Europese Portugese moet zijn. Priya zal de termen “você” met “tu”, “trem” met “comboio” en constructies als “está falando” versus “está a falar” vergelijken.

Alex liet zien hoe de huidige werknemer te werken. Het laden van de bestanden en het starten van de werknemer duurde minder dan een seconde. Een decoder die meerdere gigabyte aan gegevens kan verwerken, had echter een veel langere cold-start-tijd. Iedereen was het eens dat `tokens/sec` nuttige diagnostische gegevens zijn, maar dat dit geen maatstaf is voor de productiviteit.

| Owner
| Follow-up
| Due
|
| --- | --- | --- |
| Alex
| Run – Engels↔Oudhooglandse taal: COMET
| Tuesday
|
| Morgan
| Beoordeling in het Portugees
| Woensdag
|
| Priya
| Controleer de fouten in Markdown.
| Vrijdag.
|

## Risico’s

1. Een fluitend model kan bijvoorbeeld een datum verkeerd interpreteren of een negatieve uitspraak omzetten in een positieve.
2. Gecoördineerde markeringen kunnen worden verplaatst of opnieuw gerangschikt.
3. Een beperkende licentie kan de wereldwijde distributie onmogelijk maken.
4. Een laag batterijniveau kan de tijd die nodig is voor het uitvoeren van bepaalde handelingen, veranderen.

```bash
node scripts/translation-model-benchmark.mjs \
  --model hy-mt \
  --direction en-nl \
  --input samples.jsonl \
  --output results.jsonl
```

Verwijzingen naar deze pagina’s: [[Translation Quality]], [[Model Licensing]] en #meeting/local-dictation.
