---
title: Translation adapter API sketch
status: exploratory
---

# Translation adapter API sketch

The interface should hide runtime details while exposing the facts the caller needs for safe orchestration. A controller should not know whether the implementation uses WebAssembly, Metal, or a native sidecar. It should know the language pair, progress state, cancellation behavior, and the validated result.

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

## Design pressure

- The fast engine receives model buffers inside a Web Worker.
- A larger decoder may live in another process.
- Both must return exactly one output for each input unit.
- Cancellation must not be confused with failure.
- Progress based on completed units is more stable than guessed token counts.

> [!question] Deep or shallow?
> If every runtime leaks its own loading, prompting, and resource semantics through this interface, the module is not buying much abstraction.

A useful result type can carry translations plus timings, but it should not expose a llama.cpp JSON response. Keep diagnostics behind a structured field or log them separately.

| Concern | Owner |
| --- | --- |
| Markdown segmentation | controller |
| Prompt construction | engine adapter |
| Artifact integrity | installer |
| Editor mutation | preview workflow |

Related: [[Deep Modules]], [[Translation Controller]], and `src/translation/bergamot-client.ts`. #architecture/api
