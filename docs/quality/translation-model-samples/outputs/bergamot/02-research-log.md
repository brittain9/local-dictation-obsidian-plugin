---
title: Research log
date: 2026-07-27
aliases:
  - experiment notes
---

# Onderzoekslogboek: fragmentbehandeling

Vraag: verbetert het grotere model vertalingen omdat het het document begrijpt, of omdat het gewoon beter is in geïsoleerde fragmenten?

## Waarnemingen

- Rubrieken komen zonder de onderstaande paragraaf.
- Elke kogel wordt vertaald als een aparte eenheid.
  - Geneste kogels verliezen de context die door hun ouder wordt aangeleverd.
  - Zeer korte labels zoals “Blocked” of “Next” zijn dubbelzinnig.
- Tabelcellen kunnen zelfstandige naamwoorden bevatten in plaats van zinnen.
- Een callout titel kan eruit zien als een commando.

> [!question] Mogelijke verwarring
> De plugin segmenteert momenteel per regel. Een model dat goed presteert op fragmenten kan winnen, zelfs als de vertaling met lange context niet beter is.

Voorbeelden verzameld van [[Release Notes]]:

| Bronfragment | Beoogde zin |
| --- | --- |
| Klaar | installatie staat |
| verwijderen | knooplabel | verwijderen
| Huidige | geselecteerd model |
|opladen | batterijgedrag, geen prijs |

De zin `model is cold` beschrijft een gelost gevolgtrekkingsproces. Het mag geen zin worden over temperatuur. Evenzo is $t_{load} + t_{decode}$ een formule en moet deze ongewijzigd blijven.

```text
Input:  "No model selected"
Risk:   translating "model" as a fashion model
Signal: settings-screen context is absent
```

Volgende experiment:

1. Vertaal elke lijn onafhankelijk via beide motoren.
2. Vertaal hetzelfde materiaal als één alinea.
3. Vergelijk terminologie, voornaamwoorden en weggelaten onderwerpen.
4. Controleer of het behoud van de rubriek als context het resultaat verandert.

Conclusie tot nu toe: een ogenschijnlijk modelkwaliteitsprobleem kan echt een segmentatie-beleidsprobleem zijn. Houd die bevinding gescheiden van algemene vloeiendheid. #research/translation
