---
title: Translation adapter API sketch
status: exploratory
---

# Vertaaladapter API schets

De interface moet runtime-details verbergen terwijl de feiten worden blootgelegd die de beller nodig heeft voor veilige orkestratie. Een controller moet niet weten of de implementatie gebruik maakt van WebAssembly, Metal of een native zijspan. Het moet het taalpaar, de voortgangsstatus, het annuleringsgedrag en het gevalideerde resultaat kennen.

```ts
interface TranslationEngine {
  translate(request: TranslationRequest): Promise<TranslationResult>;
  dispose(): Promise<void>;
}

interface TranslationRequest {
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  units: readonly string[];
  signal: AbortSignal;
}
```

## Ontwerpdruk

- De snelle motor ontvangt modelbuffers in een webwerker.
- Een grotere decoder kan in een ander proces leven.
- Beide moeten precies één uitgang voor elke invoereenheid retourneren.
- Annulering mag niet verward worden met falen.
- Voortgang op basis van voltooide eenheden is stabieler dan geraden tokentellingen.

> [!question] Diep of ondiep?
> Als elke runtime zijn eigen laad-, ingevings- en resource-semantiek via deze interface lekt, koopt de module niet veel abstractie.

Een nuttig resultaattype kan vertalingen plus timings dragen, maar het mag geen lama.cpp JSON-reactie blootleggen. Houd de diagnostiek achter een gestructureerd veld of log ze apart.

| Aan de slag | Eigenaar |
| --- | --- |
|Markdownsegmentatie | controller |
|prompte constructie | motoradapter |
| Artefactintegriteit | installateur |
| Editormutatie | voorbeeldworkflow |

Gerelateerd: [[Deep Modules]], [[Translation Controller]], en `src/translation/bergamot-client.ts`. #architecture/api
