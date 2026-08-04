---
title: Weekly team meeting
attendees: [Alex, Morgan, Priya]
---

# Wekelijkse teamvergadering

## Beslissingen

- Houd de snelle Firefox-engine als standaard.
- Behandel elk groter model als een optionele kwaliteitslaag.
- Adverteer geen “professionele vertaling” zonder native-speaker review.
- Meet de end-to-end nota latentie in plaats van het citeren van alleen tokens per seconde.

> [!decision] Download beleid
> Er kan geen repository-gated artefact in de catalogus verschijnen. Het installatieprogramma moet elk bestand anoniem kunnen ophalen en de controlesum ervan kunnen verifiëren.

## Discussie

Morgan meldde dat de Portugese output verkeerd klonk, zelfs wanneer de zin begrijpelijk was. De groep vermoedt een dialectmismatch: het model mag de voorkeur geven aan Braziliaans Portugees terwijl het verwachte resultaat Europees Portugees is. Priya zal “você” vergelijken met “tu”, “trem” met “comboio”, en progressieve constructies zoals “está falando” versus “está a falar”.

Alex liet de huidige arbeiderstiming zien. Het laden van de bestanden en het starten van de werknemer duurde minder dan een seconde, terwijl een multi-gigabyte decoder had een veel grotere koude start. Iedereen was het erover eens dat `tokens/sec` nuttige diagnostische gegevens zijn, maar niet de productmetriek.

| Eigenaar | Follow-up | verschuldigd |
| --- | --- | --- |
| Alex | Run English↔Dutch COMET | Dinsdag |
| Morgan | Review Portugees dialect | woensdag |
|Priya | Inspecteren Markdown storingen | vrijdag |

## Risico's

1. Een vloeiend model kan een datum halucineren of een ontkenning omkeren.
2. Beschermde markers kunnen worden gedropt of opnieuw worden besteld.
3. Een restrictieve licentie kan wereldwijde distributie onmogelijk maken.
4. Laag batterijvermogen kan de timing van metaal vervormen.

```bash
node scripts/translation-model-benchmark.mjs \
  --model hy-mt \
  --direction en-nl \
  --input samples.jsonl \
  --output results.jsonl
```

Gerelateerd: [[Translation Quality]], [[Model Licensing]], en #meeting/local-dictation.
