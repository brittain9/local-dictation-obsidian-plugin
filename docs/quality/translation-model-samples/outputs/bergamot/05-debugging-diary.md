---
title: Debugging diary
component: translation-worker
severity: medium
---

# Debugging dagboek

Symptoom: de preview mislukt af en toe met “De vertaalruntime veranderde beschermde Markdown-slots.” Platte tekst werkt. Engels→Spaans werkt meestal; Engels→Japans mislukte vroeger vaker.

## Reproductie

1. Open [[Marker Regression Note]].
2. Selecteer de regel met `npm run check`, een wikilink en #release.
3. Uitvoeren **Vertalen selectie**.
4. Merk op of elke marker precies één keer en in volgorde terugkeert.

```md
Keep `npm run check`, [[Local Dictation]], #release, and $x + y$ unchanged.
Read [the specification](https://example.com/spec).
```

> [!bug] Belangrijk onderscheid
> Een ontbrekende marker is geen cosmetisch verschil. Het opnieuw opbouwen van de vertaalde Markdown zou beschermde inhoud op een onbekende locatie plaatsen, dus het veilige gedrag is om het resultaat af te wijzen voordat u bewerkt.

De oorspronkelijke tijdelijke aanduidingen voor privégebruik overleefden de Europese taalmodellen, maar de Japanse tokenisatie liet ze vallen. Synthetische URL-markeringen werkten omdat de woordenschat ze betrouwbaar kopieerde. De fix moet paarbewust blijven in plaats van elke taal te veranderen in de langere markervorm.

## Controles

- [x] Markertelling is exact.
- [x] De markerorde is stabiel.
- [x] Dupliceer markers falen.
- [x] Ontbrekende markers falen.
- [ ] Lange notitie annulering in de live modal.

De werknemer moet na voltooiing of mislukking worden beëindigd. Er mag geen gedeeltelijke uitvoer worden geschreven en de vastgelegde bronrevisie moet nog steeds overeenkomen voordat Replace is ingeschakeld. Gerelateerde bestanden: `src/translation/markdown-segmentation.ts` en [[Translation Safety Invariants]]. #debugging/translation
