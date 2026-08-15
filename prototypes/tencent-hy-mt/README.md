# Tencent HY-MT translation prototype

This throwaway prototype answers one question: **does HY-MT's more natural,
paraphrastic translation feel valuable enough in real Obsidian notes to justify
a production engine?** It is not a shipping model integration.

The model is not distributed by Speech Kit. Its Tencent HY Community License
excludes use and distribution in the EU, UK, and South Korea, so confirm that
you may use it before downloading or running it.

## Run it

1. Install `llama-server` from a current llama.cpp build.
2. Download `HY-MT1.5-1.8B-Q4_K_M.gguf` from Tencent's
   `HY-MT1.5-1.8B-GGUF` Hugging Face repository.
3. Start the loopback-only server:

   ```sh
   npm run prototype:tencent-translation -- /path/to/HY-MT1.5-1.8B-Q4_K_M.gguf
   ```

4. Enable **Developer mode** in Speech Kit settings.
5. Run **Prototype: Translate selection with Tencent HY-MT** or
   **Prototype: Translate note with Tencent HY-MT** from Obsidian's command
   palette.

The prototype reuses the production translation preview and Markdown
segmentation, but sends each translatable unit to the local server at
`127.0.0.1:18080`. Preview is mandatory. The server and model are started and
stopped manually, and nothing is added to Speech Kit's model catalog.

## What to evaluate

- Does the output sound meaningfully more natural than **Translate note**?
- Are dates, quantities, names, negation, and technical terms still faithful?
- Does the result preserve the note's structure?
- Is the slower translation worth a separate “natural” mode?

Prior benchmark evidence and known failures are in
`docs/quality/translation-model-comparison.md`.
