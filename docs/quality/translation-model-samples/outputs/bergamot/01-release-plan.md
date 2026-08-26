---
title: Local Translation Release Plan
status: draft
owners:
  - alex
tags:
  - local-dictation
  - release
---

# Lokale vertaling release plan

Het doel is eenvoudig: laat iemand een selectie of een volledige notitie vertalen zonder tekst naar een externe service te sturen. De eerste release moet voorspelbaar aanvoelen voordat het slim aanvoelt. Een gebruiker kiest een brontaal, kiest een doeltaal, bekijkt een voorbeeld en beslist vervolgens of hij de oorspronkelijke tekst vervangt, het resultaat eronder invoegt of kopieert.

> [!important] Vrijgavegrens
> Vertaling moet optioneel blijven. Het installeren van een spraakmodel mag een vertaalmodel niet in stilte downloaden en het openen van Obsidian mag geen van beide modellen in het geheugen laden.

## Wat moet werken

- Vertaal een korte paragraaf met gewoon proza.
  - Blijf `npm run check` ongewijzigd.
  - Bewaar [[Local Dictation]] en [[Model Manager|the model browser]].
  - Verlaat de bestemming in [de openbare gids](https://example.com/guide) onaangetast.
- Vertaal een complete notitie zonder van frontmatter te veranderen.
- Annuleer een lange aanvraag zonder het actieve bestand gedeeltelijk te bewerken.
- Toon een nuttige herstelactie wanneer het model ontbreekt.
- Houd tags zoals #release/translation en vergelijkingen zoals $E = mc^2$ intact.

De preview is een veiligheidsgrens, niet decoratieve UI. Vertaalsystemen kunnen terminologie, datums, negatie en benoemde entiteiten veranderen terwijl ze zeer vloeiende zinnen produceren. De knop Vervangen wordt daarom niet beschikbaar als de notitie verandert nadat de voorvertoning is gemaakt. Kopiëren en hieronder invoegen blijven beschikbaar omdat ze het vastgelegde bronbereik niet overschrijven.

| Poort | Doel | Bewijs |
| --- | ---: | --- |
|warme notitie van 500 woorden | 15 seconden of minder | Drie lokale runs |
| Piekgeheugen | 4 GB of minder | Procesmeting |
| Modelintegriteit | SHA-256 match | Installatieprogramma metadata |
| Markdown overleving | Niet slechter dan baseline | Tien-noot corpus |

## Open vragen

1. Moeten taalnamen de Obsidian-interface lokaal volgen of in het Engels blijven?
2. Is automatische brondetectie nuttig genoeg om een ander model te rechtvaardigen?
3. Hebben we een terminologielijst nodig in de eerste release, of kan het wachten tot echte gebruikers daarom vragen?

```ts
type TranslationDecision =
  | { action: "replace"; expectedRevision: number }
  | { action: "insert-below" }
  | { action: "copy" };
```

Het smalle antwoord verdient de voorkeur: verzend de kleinste betrouwbare lus, meet waar deze uitvalt en vermijd het behandelen van een vloeiende preview als bewijs van semantische nauwkeurigheid. Vervolgwerkzaamheden horen thuis in [[Translation Backlog]], met de benchmarkinputs en outputs eraan verbonden zodat een toekomstig model kan worden getest tegen hetzelfde bewijs.

## Voor het samenvoegen

- [ ] Re-run het daadwerkelijke geïnstalleerde modelpakket.
- [ ] Beoordeel Engels↔Nederlandse kwaliteit met een vloeiende spreker.
- [ ] Verifieer Japanse beschermde markers.
- [ ] Registreer de modellicentie en distributiebeperkingen.
- [ ] Heropen Obsidian na het installeren van de uiteindelijke bundel.

De eigenaar kan een langzamer optioneel niveau accepteren, maar het product moet de afweging duidelijk vermelden: een grotere download koopt een meetbare kwaliteitsverbetering, niet alleen een andere schrijfstijl.
