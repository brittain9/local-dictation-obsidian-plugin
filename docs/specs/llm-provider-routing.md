# Provider-independent LLM routing

Status: proposed for implementation

Source: [issue #276](https://github.com/brittain9/local-dictation-obsidian-plugin/issues/276)
and the product-design discussion that followed it. The attached implementation
diff on the issue was deliberately not used as design input.

## Product goal

Let users configure Ollama, OpenRouter, or a custom OpenAI-compatible endpoint
and independently decide how transcript transformations route between those
providers.

The routing feature should preserve its original value: a user can keep ordinary
jobs on one provider and send transcripts that exceed that provider's useful
context or performance envelope to another. Provider selection must no longer
encode a claim about where the provider runs.

This is a provider and routing redesign, not a general automation engine. Its
core logic should remain independent of Obsidian so another plugin could reuse
the provider adapters and routing policy without copying settings or sidebar
code.

## Problem

The current model combines three different concepts:

- `ollama` and `openrouter` identify provider adapters.
- `local`, `remote`, and `auto` describe routing behavior.
- The UI uses Local and Remote as privacy and deployment-location claims.

That only works while Ollama is the sole local server and OpenRouter is the sole
network provider. An OpenAI-compatible endpoint can be OpenAI, Bedrock, a hosted
gateway, a LAN server, or LM Studio on the same device. Compatibility is a wire
protocol, not a location.

Extending `remote` to mean "OpenRouter or OpenAI-compatible" would preserve a
false model and spread provider-specific branching through routing, settings,
and UI code. Instead, provider configuration and routing policy become separate
sources of truth.

## Product model

### Provider connections

The first release supports exactly three provider types:

| Provider | Endpoint | Authentication | Model discovery |
| --- | --- | --- | --- |
| Ollama | Built-in Ollama endpoint | None | Ollama catalog |
| OpenRouter | Fixed OpenRouter API endpoint | Required bearer key | Searchable OpenRouter catalog with existing pricing metadata |
| Custom OpenAI-compatible | User-supplied base URL | Optional bearer key | Best-effort OpenAI-compatible model list |

A provider connection owns one configured model. Routing between two models on
the same provider, multiple custom endpoint profiles, and named connections are
not part of this release.

OpenRouter remains a distinct adapter even though it uses the OpenAI chat
completions wire format. Its key probe, model filtering, pricing metadata, fixed
endpoint, and provider-specific error copy earn a separate adapter. Shared wire
behavior belongs in one internal OpenAI-compatible client used by both adapters.

### Routing policies

Replace `LlmRouting = 'local' | 'remote' | 'auto'` with:

```ts
type LlmRoutingPolicy =
  | {
      kind: 'fixed';
      providerId: LlmProviderId;
    }
  | {
      kind: 'transcript_size';
      defaultProviderId: LlmProviderId;
      largeTranscriptProviderId: LlmProviderId;
      thresholdChars: number;
    };
```

`PluginSettings.llmRoutingPolicy` is nullable. A fresh installation has no
provider selected; enabling a transform leads the user to provider setup rather
than silently preferring Ollama or a hosted provider.

The size-based policy uses the dictated transcript length only. It must not use
the assembled user message, because that also contains optional note and prior
utterance context. This preserves the privacy and predictability correction from
#194.

The exact threshold rule remains:

- `transcriptChars <= thresholdChars`: default provider
- `transcriptChars > thresholdChars`: large-transcript provider

The two provider IDs must differ. Selecting the same provider for both sides
collapses to a fixed policy because providers own one configured model in this
release.

Provider failure is not a routing fallback. If the selected provider times out,
rejects authentication, or rejects the model, the existing behavior keeps the
raw transcript and surfaces an attributed failure. The router never retries the
payload against another provider implicitly.

### Locality and privacy

Locality is provider metadata, not a routing mode:

- Ollama is the only integration the product guarantees is on-device.
- OpenRouter is hosted.
- A custom OpenAI-compatible endpoint is user-configured. The plugin displays
  its destination but does not infer a privacy guarantee from its URL.

The stable privacy contract is:

- Audio transcription remains on-device and audio is never sent to an LLM.
- LLM transformation remains optional.
- Selecting a provider explicitly authorizes sending the transformation
  payload—transcript text plus enabled context—to its displayed endpoint.
- API keys stay in Obsidian Secret Storage and never enter `data.json`.

Remove the current `Enable remote LLM` switch. Once provider choice and routing
are explicit, a second provider-location switch is redundant and would preserve
Ollama as a privileged special case. Provider selection is the opt-in. During
migration, a vault that explicitly disabled remote LLM use resolves to a fixed
Ollama policy so the upgrade never broadens its effective data-sharing behavior.

## User experience

### Routing controls

Remove Local, Remote, and Auto from the user-facing interface. The transform
sidebar presents routing directly:

1. **Default provider** — Ollama, OpenRouter, or OpenAI-compatible.
2. **Use a different provider for large transcripts** — off by default.
3. When enabled:
   - **Large-transcript provider** — every provider except the selected default.
   - A compact threshold summary with the existing Model settings affordance.

The labels describe behavior without requiring users to learn internal policy
names. Representative summaries:

- `All transcripts use Ollama.`
- `All transcripts use OpenRouter.`
- `Ollama up to 6,000 characters; OpenRouter above 6,000.`
- `LM Studio up to 6,000 characters; OpenRouter above 6,000.`

"LM Studio" in the final example is descriptive endpoint labeling, not a new
provider type. A custom connection may display a recognizable loopback hostname
or a user-facing `OpenAI-compatible` label; the persisted provider ID remains
generic.

### Progressive provider configuration

Render configuration only for providers selected by the effective policy:

- Fixed policy: one provider section.
- Size-based policy: `Default` and `Large transcripts` sections.

Provider sections retain the current inline health and model status patterns.
Do not add a separate provider-management screen or require users to create
profiles before routing.

Changing a provider does not erase the previous provider's endpoint, key
reference, or model. Returning to it restores its configuration.

### Model selection

Model entry is always editable. Discovery enhances it but never gates provider
use:

- Ollama keeps its local dropdown and refresh action.
- OpenRouter keeps searchable suggestions, display names, and price tiers.
- OpenAI-compatible calls `GET {baseUrl}/models` with the configured bearer key
  when present and builds searchable suggestions from valid `data[].id` values.
- If model discovery is unsupported, malformed, or unavailable, retain manual
  entry and show `Couldn't load models—enter a model ID manually.` inline.

The connection test sends the same minimal real completion currently used for
OpenRouter. A successful model-list request is not proof that the selected model
can perform a transformation.

### Custom OpenAI-compatible fields

Present fields in dependency order:

1. **Base URL** — required absolute HTTP or HTTPS URL, including the provider's
   version prefix when required, for example `http://localhost:1234/v1`.
2. **API key** — optional and stored in Obsidian Secret Storage.
3. **Model** — searchable when discovery succeeds and always manually editable.
4. **Test connection** — tests the configured endpoint, authentication, and
   exact model together.

Normalize surrounding whitespace and trailing slashes only. Do not silently add
`/v1`, rewrite paths, or accept URL credentials. Display the destination host
beside the configuration. A non-loopback HTTP endpoint receives a clear
unencrypted-connection warning; the plugin does not otherwise judge whether a
user-configured endpoint is local, private, or trustworthy.

### Settings copy

Remove provider-location language throughout settings and dialogs:

- Remove `Enable remote LLM`; explicit provider selection replaces it.
- `Remote routing threshold` -> `Large-transcript threshold`
- `Remote timeout` -> `Provider timeout`
- `Sends ... to OpenRouter` -> `Sends ... to the provider selected by the routing policy`

Keep the explicit statement that audio is never sent. Failure banners and
status rows name the provider that actually handled the job.

## OpenAI-compatible contract

The custom adapter implements the smallest interoperable contract already used
by the transformation pipeline:

- `POST {baseUrl}/chat/completions`
- `GET {baseUrl}/models` for best-effort discovery
- OpenAI-shaped `messages`, `model`, `temperature`, `stream: false`, and
  `max_tokens` request fields
- Text from `choices[0].message.content`
- Optional `Authorization: Bearer <key>` header
- Existing abort, timeout, response-size, malformed-JSON, empty-output, and
  truncated-output protections

Provider error mapping remains typed and provider-attributed. At minimum, map
401/403 to authentication failure, 404 model failures when the response
identifies a model, 429 to rate limiting, request abort, timeout, connection
failure, malformed response, and empty response.

This contract supports OpenAI, default LM Studio servers, OpenRouter-like
gateways, and Amazon Bedrock endpoints configured with a Bedrock API key. The
following require separate adapters and are out of scope:

- AWS credential-chain or SigV4 authentication
- Azure deployment-style paths and `api-version` query parameters
- Arbitrary custom headers or query-string authentication
- OpenAI Responses API
- Streaming completions

## Module design

The reusable seam lives under `src/llm` and must not depend on Obsidian UI or the
full `PluginSettings` shape.

### Provider seam

Retain the existing small `LlmProvider` interface:

```ts
interface LlmProvider {
  readonly id: LlmProviderId;
  cleanup(options: CleanupOptions): Promise<string>;
  listModels(): Promise<ModelOption[]>;
  probe(): Promise<ProviderHealth>;
  prewarmModel?(modelId: string): Promise<void>;
}
```

Add the custom adapter and remove `PluginSettings` from provider construction.
Provider constructors receive only normalized runtime options such as base URL,
timeout, and resolved key. Obsidian Secret Storage remains in the plugin
integration layer.

Use composition for the OpenAI wire implementation:

- An internal OpenAI chat client owns URL joining, headers, request shape,
  response parsing, and common HTTP error mapping.
- `OpenRouterProvider` composes it and retains OpenRouter catalog/pricing and key
  health behavior.
- `OpenAiCompatibleProvider` composes it and supplies generic model discovery
  and optional authentication.

Do not introduce inheritance, a declarative provider DSL, or a registry whose
configuration surface merely mirrors the three constructors.

### Routing-policy seam

Move provider selection into a pure module with an interface equivalent to:

```ts
selectProviderId(policy: LlmRoutingPolicy, transcriptChars: number): LlmProviderId
```

The module validates policy invariants and selects a provider. It knows nothing
about HTTP, models, secrets, provider locality, Obsidian, or fallback behavior.
Its tests are the authoritative routing-policy contract.

The router composes the policy selector with provider lookup, model resolution,
output budgeting, error attribution, and provider instance caching. Accept
dependencies rather than importing plugin settings or secret storage.

Session behavior stays predictable:

- Policy, provider configuration, models, and thresholds are snapshotted at
  session start. Settings changes apply to the next session.

This module shape is reusable by extraction, but publishing a package or making
the sidebar/settings UI portable is not part of this work.

## Persisted settings and migration

Bump the plugin settings schema to version 5 because keys are renamed and the
routing representation changes semantics.

The normalized settings shape should have one source of truth for:

- `llmRoutingPolicy: LlmRoutingPolicy | null`
- Provider configuration for Ollama, OpenRouter, and OpenAI-compatible,
  including one model per provider and secret references where applicable
- Provider-neutral timeout

The exact nested property names may follow existing settings style, but old and
new fields must not coexist in normalized `PluginSettings`.

Migrate schema-4 behavior exactly:

| Schema-4 value | Schema-5 policy |
| --- | --- |
| `llmRouting: 'local'` | Fixed Ollama |
| `llmRouting: 'remote'` | Fixed OpenRouter |
| `llmRouting: 'auto'` | Size-based: Ollama -> OpenRouter at `llmRemoteThresholdChars` |
| Invalid explicit routing | No selected policy |

An explicit `llmRemoteFeaturesEnabled: false` overrides those mappings and
migrates to fixed Ollama, matching the vault's effective schema-4 behavior.

Also migrate:

- Existing Ollama and OpenRouter models into their provider configurations.
- `llmOpenRouterSecretId` without copying secret material into persisted data.
- `llmRemoteTimeoutSec` to the provider-neutral timeout.
- Legacy `llmProvider` and `llmPostprocessModel` through their current tolerant
  migrations before producing the schema-5 shape.

The settings loader persists the normalized schema-5 shape after migration so
renamed keys are removed from `data.json`. Fresh installations default to no
selected routing policy; LLM transformation itself remains off until enabled.

## Expected impact

| Area | Primary files |
| --- | --- |
| Provider and routing seams | `src/llm/provider.ts`, `src/llm/router.ts`, new routing-policy and OpenAI-compatible modules |
| Provider adapters | `src/llm/openrouter-provider.ts`, `src/llm/ollama-provider.ts`, new custom adapter |
| Settings and migration | `src/settings/plugin-settings.ts`, generalized secret-storage integration |
| Sidebar and status UX | `src/ui/llm-routing-controls.ts`, `src/ui/llm-provider-ui.ts`, `src/ui/llm-status.ts` |
| Advanced model settings | `src/ui/llm-model-settings-modal.ts`, `src/ui/llm-model-settings-presentation.ts` |
| Plugin composition | `src/main.ts`, `src/ui/local-dictation-view.ts` |
| Verification | Existing provider, router, settings, sidebar, and presentation test suites plus the new adapter tests |
| Documentation | `docs/system-architecture.md` and release notes |

## Implementation plan

Implement in small, reviewable commits:

1. **Define provider configuration and routing policy.** Add schema-5 settings
   types, pure policy selection, invariant tests, and exact migration coverage.
2. **Decouple the router from plugin settings.** Pass normalized policy and
   provider/model lookup across the seam; preserve session snapshot and failure
   semantics.
3. **Extract the OpenAI chat wire client.** Move shared request/response and
   error behavior out of OpenRouter without changing its observable behavior.
4. **Add the custom OpenAI-compatible adapter.** Implement optional bearer
   authentication, model discovery fallback, URL validation, health, and real
   completion test coverage.
5. **Generalize secrets and provider construction.** Keep Obsidian Secret
   Storage in the integration layer, migrate the OpenRouter secret, and add the
   custom-provider secret without plaintext persistence.
6. **Replace sidebar routing controls.** Render fixed/size-based policies,
   progressive provider configuration, provider-neutral status, and endpoint
   disclosure.
7. **Update settings and documentation.** Rename remote-specific copy, update
   the model-settings presentation, architecture documentation, and release
   notes.
8. **Simplify after verification.** Remove obsolete routing types, render
   branches, helpers, tests, comments, and legacy normalized fields. Keep only
   migration reads for persisted historical settings.

## High-ROI verification

### Automated

- Pure routing-policy tests: fixed selection, both threshold edges, invalid
  duplicate providers, and every provider ID in either leg.
- Router tests: selected provider/model, session snapshot behavior,
  provider-attributed errors, and no implicit retry.
- Settings tests: every schema-4 route migration, fresh no-policy default,
  malformed provider configuration, secret-reference migration, and removal of
  old normalized keys.
- OpenAI-compatible adapter tests: optional auth header, URL joining, model
  parsing, unsupported model discovery, completion parsing, status mapping,
  abort, timeout, response cap, and truncated output.
- OpenRouter regression tests proving request shape, pricing catalog, key probe,
  and existing error copy are unchanged after extraction.
- Presentation tests for fixed, size-based, unconfigured, and model discovery
  fallback states.

Run `npm run check:frontend` for the implementation. No native sidecar code
should change.

### Manual

- Ollama as the fixed provider.
- OpenRouter as the fixed provider.
- Ollama below the threshold and OpenRouter above it, verifying both exact
  threshold edges.
- LM Studio at `http://localhost:1234/v1` with no key: model discovery, manual
  model entry, connection test, fixed routing, and either size-policy leg.
- A key-protected OpenAI-compatible endpoint over HTTPS.
- Restart Obsidian after configuring every provider and confirm models,
  endpoint, policy, and secret references restore without plaintext keys.

## Acceptance criteria

1. No user-facing control describes routing as Local, Remote, or Auto.
2. A fresh installation has no implicit LLM provider selection.
3. Users can route all jobs to any supported provider.
4. Users can optionally route transcripts above a character threshold to a
   different supported provider, using transcript length rather than assembled
   context length.
5. Existing Local, Remote, and Auto settings migrate without behavior change;
   an explicitly disabled schema-4 remote capability remains fixed to Ollama.
6. The custom OpenAI-compatible adapter works with an optional bearer key and
   does not require model discovery to succeed.
7. Provider configuration, routing policy, and locality metadata remain
   independent; no URL heuristic changes routing behavior.
8. Provider failures keep raw transcript text, name the provider that handled
   the job, and never trigger an implicit second provider request.
9. API keys exist only in Obsidian Secret Storage.
10. Core provider and routing modules do not import Obsidian UI or the complete
    plugin settings model.
11. Ollama and OpenRouter retain their current model selection, health,
    transformation, and error behavior.

## Non-goals

- Multiple named configurations for one provider type
- More than two routing legs or more than one threshold
- Routing by price, latency, health, token estimate, task type, or preset
- Automatic failover or retry against a different provider
- Different models on the two legs of the same provider
- Automatic classification of custom endpoints as local, LAN, or cloud
- AWS SigV4, Azure-specific compatibility, custom headers, or query auth
- Streaming or Responses API support
- Moving LLM transformation into the Rust sidecar
- Extracting or publishing a reusable package in this change
