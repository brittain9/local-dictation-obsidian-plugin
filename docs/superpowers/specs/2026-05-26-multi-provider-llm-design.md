# Multi-provider LLM support for transcript transformation

**Status:** Approved design — ready for implementation plan
**Date:** 2026-05-26
**Scope:** Add OpenRouter and Google Gemini API as LLM transformation providers alongside the existing Ollama integration.

## Goal

Today the LLM transformation feature is hard-wired to Ollama. Users without a local Ollama install (or who want frontier-quality cleanup of dictated text) have no path. This spec adds two cloud providers — OpenRouter and Google Gemini (AI Studio) — behind a small provider abstraction so the rest of the plugin (sidebar UI, dictation session controller, presets) is unchanged by the swap.

Non-goals:
- Streaming responses (no provider streams today; no UI need).
- Per-preset provider/model selection — presets remain prompt/temperature/skip-word settings only; provider+model is global.
- Vertex AI / Google Cloud OAuth credentials. "Gemini API key" in this spec always means an AI Studio key (`AIza…`) against `generativelanguage.googleapis.com`. Vertex would be a separate, much heavier integration.
- OS keychain integration for API keys — community Obsidian plugins have no access to one.

## Providers

| Provider | Identifier | Endpoint | Auth | Model selection UX |
|---|---|---|---|---|
| Ollama | `ollama` | `http://127.0.0.1:11434` | none | Dropdown probed from `/api/tags` (existing) |
| OpenRouter | `openrouter` | `https://openrouter.ai/api/v1` | `Authorization: Bearer <key>` | Free-text + "Check" button validates against `/api/v1/models` |
| Gemini | `gemini` | `https://generativelanguage.googleapis.com/v1beta` | `?key=<key>` query param | Dropdown populated from `/v1beta/models?key=…`, filtered to `supportedGenerationMethods` containing `generateContent` |

OpenRouter uses the OpenAI-compatible `POST /api/v1/chat/completions` request shape. Gemini uses `POST /v1beta/models/{model}:generateContent` with the Google-native request shape (`contents[]` with `parts[].text`, plus `systemInstruction`).

## Architecture

### Provider interface

A single `LlmProvider` interface in `src/llm/provider.ts` replaces the concrete `OllamaClient` consumed by the sidebar, dictation controller, and settings UI:

```ts
type LlmProviderId = 'ollama' | 'openrouter' | 'gemini';

interface LlmProvider {
  id: LlmProviderId;
  probe(): Promise<ProviderHealth>;
  listModels(): Promise<ModelOption[]>;
  cleanup(opts: CleanupOptions): Promise<string>;
  prewarmModel?(modelId: string): Promise<void>;   // optional, Ollama only
}

interface CleanupOptions {
  abortSignal?: AbortSignal;
  model: string;
  prompt: string;          // system message
  temperature: number;
  userMessage: string;     // user message
}

interface ModelOption {
  id: string;
  displayName: string;
}

type ProviderHealth =
  | { kind: 'unknown' }
  | { kind: 'unreachable' }       // network / connection failed
  | { kind: 'auth_invalid' }      // 401 / bad API key (cloud providers only)
  | { kind: 'no_models' }         // no usable models
  | { kind: 'ready'; modelCount: number };

class ProviderError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'connection_failed'
      | 'http_error'
      | 'invalid_response'
      | 'timeout'
      | 'auth_invalid'
      | 'rate_limited'
      | 'unknown_model',
  ) { super(message); this.name = 'ProviderError'; }
}
```

A factory `createProvider(settings: PluginSettings): LlmProvider` returns the right implementation based on `settings.llmProvider`. The dictation controller and sidebar hold an `LlmProvider`, never a concrete client. `prewarmModel` is invoked only when present.

### Provider implementations

- **`src/llm/ollama-provider.ts`** — thin adapter over the existing `ollama-client.ts`. The HTTP transport in `ollama-client.ts` stays as-is (still `http.request`, still its own response-byte cap and timeouts). The adapter maps `OllamaClientError.code` onto `ProviderError.code` and derives `ProviderHealth` the same way `formatOllamaHealth` does today.
- **`src/llm/openrouter-provider.ts`** — uses `fetch` via the shared helper. `cleanup` POSTs `{ model, messages: [{role:'system',content:prompt},{role:'user',content:userMessage}], temperature, max_tokens: 512, stream: false }` to `/api/v1/chat/completions`, reads `choices[0].message.content`. `listModels` GETs `/api/v1/models` unauthenticated. Error mapping: 401 → `auth_invalid`, 404 with "model" in message → `unknown_model`, 429 → `rate_limited`.
- **`src/llm/gemini-provider.ts`** — `cleanup` POSTs to `/v1beta/models/{model}:generateContent?key=…` with `{ systemInstruction: { parts: [{ text: prompt }] }, contents: [{ role: 'user', parts: [{ text: userMessage }] }], generationConfig: { temperature, maxOutputTokens: 512 } }`. Reads `candidates[0].content.parts[0].text`. `listModels` GETs `/v1beta/models?key=…` and filters by `supportedGenerationMethods.includes('generateContent')`. Error mapping: 400 with `API_KEY_INVALID` → `auth_invalid`, 404 → `unknown_model`, 429 → `rate_limited`.

### Shared HTTP helper

`src/llm/http-shared.ts` exposes a `fetchJson(url, init, { timeoutMs, abortSignal, maxBytes })` used by the OpenRouter and Gemini providers. Responsibilities:

- 60s default timeout (3s for probe calls).
- 2 MB response byte cap, mirroring `ollama-client.ts`.
- Composes the caller's `AbortSignal` with an internal timeout signal.
- Throws `ProviderError` with the correct code (`connection_failed`, `timeout`, `http_error`, `invalid_response`).

The existing `ollama-client.ts` keeps its own `http.request` transport — no need to rewrite it onto `fetch`. The shared helper is for the two new providers only.

## Settings schema

```ts
interface PluginSettings {
  // … existing fields …
  llmProvider: 'ollama' | 'openrouter' | 'gemini';
  llmOpenRouterApiKey: string;
  llmGeminiApiKey: string;
  llmProviderModels: {
    ollama: string;
    openrouter: string;
    gemini: string;
  };
  // REMOVED: llmPostprocessModel  (replaced by llmProviderModels)
}
```

Defaults: `llmProvider: 'ollama'`, both API keys `''`, all three `llmProviderModels` `''`.

The active model used in a transform call is `settings.llmProviderModels[settings.llmProvider]`.

### Migration

In `resolvePluginSettings`, if the persisted JSON contains a string `llmPostprocessModel` and no `llmProviderModels` block, seed:

```ts
llmProviderModels = { ollama: legacyModel, openrouter: '', gemini: '' }
llmProvider = 'ollama'
```

If both old and new exist, prefer the new block (forward-compatible save already happened). The reader stays tolerant of the old key indefinitely so a user opening an old vault never loses their selection. Drop `llmPostprocessModel` from the `PluginSettings` type — single source of truth going forward.

### API key storage

API keys are persisted as plain strings in the plugin's `data.json`. Obsidian community plugins have no OS-keychain access. The settings UI shows a one-line warning under each key field: *"Stored in plain text in your vault."* No additional obfuscation — that would imply a security guarantee we cannot make.

## UI

### Settings tab

The existing LLM section gains a Provider dropdown at the top; the rows below it switch based on selection:

```
Provider:  [ Ollama ▼ ]                Ollama / OpenRouter / Gemini

── Ollama ──
  Model:   [ llama3.1:8b ▼ ]           probed dropdown (existing UX)
  Status:  Ready (4 chat models).

── OpenRouter ──
  API key: [ sk-or-… ]                 ⓘ Stored in plain text in your vault.
  Model:   [ anthropic/claude-sonnet-4.5 ]   [Check]
  Status:  Model verified. / Unknown model. Did you mean X?

── Gemini ──
  API key: [ AIza… ]                   ⓘ Stored in plain text in your vault.
  Model:   [ gemini-2.5-flash ▼ ]      probed dropdown when key is set
  Status:  Ready (12 models). / Invalid API key.
```

Values for inactive providers are preserved in settings — switching Ollama → OpenRouter → Ollama does not lose either selection.

OpenRouter "Check" button: clicked-on-demand only. It fetches `/api/v1/models` once per session, caches in memory, then checks whether the entered model id appears in the catalog. On miss it surfaces the closest fuzzy match: *"Unknown model. Did you mean `anthropic/claude-sonnet-4.5`?"*. No background catalog fetch — preserves the local-first feel.

### Sidebar

The LLM transformation sidebar's existing inline-status pill (`src/ui/llm-status.ts`) generalizes: `OllamaHealth` → `ProviderHealth`, `deriveInlineStatus` becomes provider-agnostic. New states handled: `auth_invalid` → "API key rejected.", `rate_limited` → "Rate limit hit." (transient, set during a failed transform; auto-clears on the next success).

The sidebar still owns the same provider+model selection as the settings tab (already the case today for Ollama) — the new code path reuses the same UI components.

## Runtime behavior

**Mid-dictation failure.** A failed `cleanup` call falls back to the raw transcript text (existing behavior, untouched). In addition:
- `console.error` with `[local-dictation] <provider> cleanup failed: <code> (<message>)`.
- The sidebar shows a transient banner derived from the `ProviderError.code`:
  - `auth_invalid` → *"<Provider> API key rejected. Check settings."*
  - `rate_limited` → *"<Provider> rate limit hit. Falling back to raw text."*
  - `connection_failed` / `timeout` → *"Network error reaching <provider>."*
  - `unknown_model` → *"Selected model not found."*
  - other → *"LLM transform failed. See console."*
- The banner clears on the next successful transform.

**Cancellation.** All providers honor `CleanupOptions.abortSignal`. Ollama already does; `fetch`-based providers pass it through to `fetchJson`, composed with the timeout signal.

**Timeouts.** `CLEANUP_TIMEOUT_MS = 60_000`, `PROBE_TIMEOUT_MS = 3_000`. Shared across providers.

**Response size cap.** 2 MB, shared via `http-shared.ts` for fetch providers; existing constant in `ollama-client.ts` unchanged.

**Streaming.** None. All providers use `stream: false` (OpenRouter) / non-streaming endpoints (Gemini `generateContent`, Ollama `/api/chat` with `stream: false`).

**`prewarmModel`.** Ollama-only. The interface marks it optional; the dictation controller no-ops when the active provider doesn't implement it.

## File layout

```
src/llm/
  provider.ts              NEW  LlmProvider, ProviderHealth, ProviderError, createProvider
  ollama-provider.ts       NEW  thin adapter over ollama-client.ts
  openrouter-provider.ts   NEW
  gemini-provider.ts       NEW
  http-shared.ts           NEW  fetchJson with timeout / byte cap / AbortSignal
  ollama-client.ts         unchanged
  presets.ts               unchanged
  templates.ts             unchanged

src/ui/
  llm-status.ts            generalize OllamaHealth → ProviderHealth
  local-dictation-view.ts  swap OllamaClient → LlmProvider
  save-style-modal.ts      swap OllamaClient → LlmProvider

src/settings/
  plugin-settings.ts       add fields + migration; drop llmPostprocessModel from type
  settings-tab.ts          provider dropdown + conditional rows
    (or split into llm-provider-settings-section.ts if settings-tab.ts grows past ~400 lines)

src/dictation/
  dictation-session-controller.ts  swap OllamaClient → LlmProvider

src/main.ts                createProvider(settings) instead of createOllamaClient()
```

## Testing

High-ROI vitest coverage only — implementation-detail tests excluded.

- `test/llm/openrouter-provider.test.ts`
  - `cleanup` request shape (URL, headers, JSON body) and response parse.
  - `listModels` parse + caller can iterate.
  - Error mapping: 401 → `auth_invalid`, 429 → `rate_limited`, 404 model-not-found → `unknown_model`, network error → `connection_failed`, timeout → `timeout`.
  - `abortSignal` propagation.
  - Response-byte-cap enforcement.
- `test/llm/gemini-provider.test.ts`
  - Same error matrix.
  - URL construction for `:generateContent` and `?key=`.
  - `listModels` filters to `supportedGenerationMethods.includes('generateContent')`.
- `test/settings/plugin-settings.test.ts` (additions)
  - Migration: legacy `llmPostprocessModel` lands in `llmProviderModels.ollama`; `llmProvider` defaults to `'ollama'`.
  - Per-provider model memory survives a save/load roundtrip while switching providers.

`fetch` is mocked at the module boundary. No live network calls in tests.

No tests for `ollama-provider.ts` beyond what already exists for `ollama-client.ts` — the adapter is straight delegation. No tests for settings-tab DOM rendering — covered by manual verification per `CLAUDE.md`.

### Manual verification before merge

- Switch through all three providers in settings; confirm values for inactive providers persist across an Obsidian restart.
- Trigger a transcript transform on each provider; confirm raw-text fallback + `console.error` + sidebar banner on a deliberately bad API key.
- OpenRouter "Check" button: valid model id → "verified"; typo → fuzzy suggestion.
- Gemini model dropdown populates only after a valid key is entered; shows `auth_invalid` for a bad key.

## Out of scope (deferred)

- Vertex AI / Google Cloud OAuth credentials.
- Streaming responses.
- Per-preset provider+model.
- Background model-catalog refresh.
- Anthropic API direct (OpenRouter covers Claude already).
