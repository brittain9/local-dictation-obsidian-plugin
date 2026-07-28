---
title: Translation adapter API sketch
status: exploratory
---

# Vertaalingsadapter-API-schema

De interface moet de details van het uitvoeringsproces verbergen, terwijl de feiten die de aanvrager nodig heeft voor een veilige uitvoering worden weergegeven. De controller moet niet weten of de implementatie gebruik maakt van WebAssembly, Metal of een native sidecar. De controller moet wel weten wat de taalcombinatie is, de voortgang van het proces, de manier waarop het proces wordt gestopt en het geverifieerde resultaat.

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

## Ontwerpbelasting

- De snelle motor ontvangt de modulaire buffers binnen een Web Worker.
- Een grotere decoder kan zich bevinden in een andere proces.
- Beide moeten voor elke invoer een enkele uitkomst geven.
- Het annuleren van een evenement moet niet worden verward met een falen van het evenement zelf.
- De voortgang die wordt gemeten op basis van de voltooide eenheden, is stabieler dan de geschatte aantallen tokens.

> [!question] Diep of oppervlakkig?
> Als elke runtime de eigen ladenprocessen, prompts en resources via deze interface verliest, dan heeft het module niet veel abstractie boodschap.

Een nuttig resultaattype kan translaties en tijdsindicatoren bevatten. Echter, het mag geen JSON-respons van llama.cpp bevatten. De diagnostische informatie moet worden opgeslagen in een gestructureerde vorm of apart worden vastgelegd.

| Concern
| Owner
|
| --- | --- |
| Markdown-segmentatie
|-controller
|
| Prompt-constructie
| Engine-adapter
|
| – Integriteit van het artefact is onbekend.
| – De installator is niet beschikbaar.
|
| – Editor: Mutatie
| – Preview van het werkflow
|

Verwante links: [[Deep Modules]], [[Translation Controller]], en `src/translation/bergamot-client.ts`. #architecture/api
