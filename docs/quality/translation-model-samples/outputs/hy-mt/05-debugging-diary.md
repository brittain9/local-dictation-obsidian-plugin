---
title: Debugging diary
component: translation-worker
severity: medium
---

# Debugging-dagboek

Symptoom: De preview werkt soms niet. Er wordt dan de foutmelding “The translation runtime changed protected Markdown slots” weergegeven. Plain tekst werkt wel. De overgang van Engels naar Spaans werkt meestal goed. De overgang van Engels naar Japans werkte vroeger vaker niet.

## Reproductie

1. Ga naar [[Marker Regression Note]].
2. Kies de lijn die de URL’s `npm run check` en #release bevat. Deze zijn wiklinken.
3. Gebruik de link: **TranslateSelection**
4. Zorg ervoor dat elke marker precies één keer wordt weergegeven en in de juiste volgorde.

```md
Keep `npm run check`, [[Local Dictation]], #release, and $x + y$ unchanged.
Read [the specification](https://example.com/spec).
```

> [!bug] – Belangrijke onderscheidingen
> Een verloren markering is geen klein verschil. Als we de gedeelde tekst opnieuw zullen invullen, komt het beschermde materiaal in een onbekende plaats terecht. Het is dus beter om het resultaat te weigeren voordat je de tekst nog verder kunt bewerken.

De oorspronkelijke privé-gebruikte placeholders hebben het overleefd in de Europese taalmodellen. Echter, de Japanse tokenisering heeft deze placeholders vervangen. De synthetische URL-markers werken nog steeds goed, omdat het woordenschat deze placeholders nauwkeurig kopieert. Het probleem moet worden opgelost door de markers in te zetten in combinatie met de juiste taaltekens, in plaats van ze alleen in de langere vorm te gebruiken.

## Controles

- [x] Het aantal markers is precies.
- [x] De marker-order is stabiel.
- [x] Dubbelmarkeringen werken niet.
- [x] De ontbrekende markeerders werken niet.
- [ ] Langdurige annuleringen in de live-modus.

De werknemer moet het project stopzetten wanneer het is voltooid of wanneer het project mislukt. Er mag geen deel van het resultaat worden opgeschreven. De gemaakte versie van de bronbestanden moet nog steeds overeenkomen met de oorspronkelijke versie, voordat de functie ‘Vervangen’ wordt geactiveerd. Relatieke bestanden: `src/translation/markdown-segmentation.ts` en [[Translation Safety Invariants]]. #debugging/translation
