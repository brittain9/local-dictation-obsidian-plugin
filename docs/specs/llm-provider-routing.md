# Provider-independent LLM routing

Status: proposed for implementation

Source: [issue #276](https://github.com/brittain9/speech-kit-obsidian-plugin/issues/276)
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

This is a provider and routing redesign, not a general automation engine. Keep
the provider adapters and policy selector independent of Obsidian UI and the
full settings model because that makes them easier to test and leaves a clean
extraction seam. Do not add an abstraction or package solely for hypothetical
reuse.

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

The design uses three terms consistently:

- **Provider connection**: a destination plus its model, endpoint, and secret
  reference.
- **Routing policy**: the rule that selects a provider connection. This is an
  implementation term, not a concept users must learn in the UI.
- **Transformation payload**: transcript text plus any enabled note or prior
  utterance context. Audio is never part of this payload.

## Product model

### Provider connections

The first release supports exactly three provider types:

| Provider | Endpoint | Authentication | Model discovery |
| --- | --- | --- | --- |
| Ollama | Built-in Ollama endpoint | None | Ollama catalog |
| OpenRouter | Fixed OpenRouter API endpoint | Required bearer key | Searchable OpenRouter catalog with existing pricing metadata |
| OpenAI-compatible | User-supplied base URL | Optional bearer key | Best-effort OpenAI-compatible model list |

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

Retain `Enable LLM features` as the single live kill switch. Check it immediately
before every transformation request, including requests from a session that is
already running. Turning it off prevents further provider requests in that
session; cancelling a request already in flight remains best effort because its
payload may already have reached the selected endpoint. Once disabled, that
session remains raw even if the switch is turned back on; re-enabling LLM
features applies to the next session so a running session never resumes against
stale provider or routing snapshots.

## User experience

### Routing controls

Remove Local, Remote, and Auto from the user-facing interface. The transform
sidebar presents routing directly:

1. **Provider** — Ollama, OpenRouter, or OpenAI-compatible.
2. **Use a different provider for large transcripts** — off by default.
3. When enabled:
   - Rename the first control to **Default provider**.
   - **Large-transcript provider** — every provider except the selected default.
   - **Large transcript threshold** directly below the two provider controls.

With no policy selected, show the empty **Provider** control and `Choose a
provider to use transforms.` in the same sidebar. Reveal the large-transcript
toggle only after the first provider is selected. Until every active routing leg
has a valid provider configuration and model, keep raw transcript behavior and
show the missing setup inline rather than allowing a request that is guaranteed
to fail.

The controls describe routing directly without requiring users to learn
internal policy names or repeating the route in a separate summary. Do not
guess a product name from a URL. The connection is labeled
`OpenAI-compatible`, and the persisted provider ID remains generic.

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

Discovery enhances model selection but never gates use of a custom endpoint:

- Ollama keeps its local dropdown and refresh action.
- OpenRouter keeps its editable searchable input, display names, and price tiers.
- OpenAI-compatible calls `GET {baseUrl}/models` with the configured bearer key
  when present and builds searchable suggestions from valid `data[].id` values;
  its model input always remains editable.
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
`/v1` or rewrite paths. Reject URL credentials, query parameters, and fragments;
authentication belongs only in Secret Storage, and endpoint paths must compose
predictably. Display the destination host beside the configuration. A
non-loopback HTTP endpoint receives a clear unencrypted-connection warning; the
plugin does not otherwise judge whether a user-configured endpoint is local,
private, or trustworthy.

### Settings copy

Remove provider-location language throughout settings and dialogs:

- Remove `Enable remote LLM`; explicit provider selection replaces it.
- `Remote routing threshold` -> `Large-transcript threshold`
- `Remote timeout` -> `Network request timeout`, applying to OpenRouter and the
  custom endpoint while Ollama keeps its current timeout behavior
- `Sends ... to OpenRouter` -> `Sends ... to the provider selected above`

Keep the explicit statement that audio is never sent. Failure banners and
status rows name the provider that actually handled the job.

## OpenAI-compatible contract

The custom adapter implements the smallest interoperable contract already used
by the transformation pipeline:

- `POST {baseUrl}/chat/completions`
- `GET {baseUrl}/models` for best-effort discovery
- OpenAI-shaped `messages`, `model`, `temperature`, `stream: false`, and
  `max_tokens` request fields. This deliberately preserves the portable field
  already used by OpenRouter and LM Studio; endpoints or model families that
  require `max_completion_tokens` are outside this initial compatibility subset.
- Text from `choices[0].message.content`
- Optional `Authorization: Bearer <key>` header
- Existing abort, timeout, response-size, malformed-JSON, empty-output, and
  truncated-output protections

Provider error mapping remains typed and provider-attributed. For the custom
adapter, map 401 to authentication failure, 403 to permission denied, 404 model
failures when the response identifies a model, 429 to rate limiting, request
abort, timeout, connection failure, malformed response, and empty response.
Permission copy must mention credentials and account/model access rather than
claiming the API key alone is invalid; Bedrock can return 403 for IAM or
model-access policy. Preserve OpenRouter's existing adapter-specific mappings
unchanged.

This contract supports compatible OpenAI Chat Completions models, default LM
Studio servers, OpenRouter-like gateways, and Amazon Bedrock's OpenAI-compatible
endpoints configured with a Bedrock API key. LM Studio documents `/v1/models` and
`/v1/chat/completions` in its
[OpenAI compatibility API](https://lmstudio.ai/docs/developer/openai-compat).
Amazon documents the same calls and bearer-key authentication for
[Bedrock Chat Completions](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-chat-completions-mantle.html),
including the recommended regional `bedrock-mantle` base URL. The following
require separate adapters and are out of scope:

- AWS credential-chain or SigV4 authentication
- Azure deployment-style paths and `api-version` query parameters
- Arbitrary custom headers or query-string authentication
- OpenAI Responses API
- Streaming completions

## Module design

The provider and policy seam lives under `src/llm` and must not depend on
Obsidian UI or the full `PluginSettings` shape.

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
  response parsing, and transport/HTTP-status capture. Provider adapters retain
  provider-specific status interpretation and user-facing errors.
- `OpenRouterProvider` composes it and retains OpenRouter catalog/pricing and key
  health behavior.
- `OpenAiCompatibleProvider` composes it and supplies generic model discovery
  and optional authentication. It uses Obsidian's CORS-free HTTP transport so
  local servers such as LM Studio do not need to expose browser CORS headers;
  caller aborts and timeouts still settle promptly and ignore any later result.

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
- The global LLM feature switch is the privacy exception: read it live before
  each request so disabling LLM features blocks further requests immediately.
  A disabled session remains raw; re-enabling applies only to new sessions.

This boundary is sufficient for possible later extraction. Publishing a package
or making the sidebar/settings UI portable is not part of this work.

## Persisted settings and migration

Bump the plugin settings schema from version 6 to version 7 because keys are
renamed and the routing representation changes semantics.

The normalized settings shape should have one source of truth for:

- `llmRoutingPolicy: LlmRoutingPolicy | null`
- Provider configuration for Ollama, OpenRouter, and OpenAI-compatible,
  including one model per provider and secret references where applicable
- One network request timeout for OpenRouter and the custom endpoint; Ollama
  retains its current fixed timeout

The exact nested property names may follow existing settings style, but old and
new fields must not coexist in normalized `PluginSettings`.

Migrate every existing schema through version 6 by preserving its current
effective behavior:

| Existing effective behavior | Schema-7 policy |
| --- | --- |
| Remote LLM explicitly disabled | Fixed Ollama |
| `llmRouting: 'local'` | Fixed Ollama |
| `llmRouting: 'remote'` | Fixed OpenRouter |
| `llmRouting: 'auto'` | Size-based: Ollama -> OpenRouter at `llmRemoteThresholdChars` |
| Legacy `llmProvider: 'ollama'` or `'gemini'` | Fixed Ollama |
| Legacy `llmProvider: 'openrouter'` | Fixed OpenRouter |
| Missing or malformed routing in an existing settings object | Fixed Ollama, matching the current tolerant fallback |

Only a genuinely fresh installation with no persisted settings starts with no
selected policy. This distinction prevents the new opt-in default from silently
changing an existing vault's effective route.

Also migrate:

- Existing Ollama and OpenRouter models into their provider configurations.
- `llmOpenRouterSecretId` without copying secret material into persisted data.
- `llmRemoteTimeoutSec` to the network request timeout without changing
  Ollama's timeout.
- Legacy `llmPostprocessModel` through its current tolerant migration before
  producing the schema-7 shape.
- Update schema-version guards for unrelated persisted capability snapshots so
  schema-7 data preserves valid dictation and TTS snapshots instead of forcing
  a model reprobe on every restart.

The settings loader persists the normalized schema-7 shape after migration so
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
| Localization | `src/locales/*.ts`, `test/locales-parity.test.ts` |
| Documentation | `docs/system-architecture.md` and release notes |

## Implementation plan

Implement in small, reviewable commits:

1. **Define provider configuration and routing policy.** Add schema-7 settings
   types, pure policy selection, invariant tests, and exact migration coverage.
2. **Decouple the router from plugin settings.** Pass normalized policy and
   provider/model lookup across the seam; preserve session snapshot and failure
   semantics while keeping the global LLM feature switch live.
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
7. **Update localized UI and documentation.** Rename remote-specific copy through
   the locale catalogs, preserve placeholders across every translation, update
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
  live global-disable behavior, provider-attributed errors, and no implicit
  retry.
- Settings tests: every supported historical route migration, fresh no-policy
  default, malformed provider configuration, secret-reference migration,
  removal of old normalized keys, and preservation of every unrelated setting,
  including dictation and TTS capability snapshots under schema 7.
- OpenAI-compatible adapter tests: optional auth header, URL joining, model
  parsing, unsupported model discovery, completion parsing, status mapping,
  abort, timeout, response cap, and truncated output.
- OpenRouter regression tests proving request shape, pricing catalog, key probe,
  and existing error copy are unchanged after extraction.
- Presentation tests for fixed, size-based, unconfigured, and model discovery
  fallback states.
- Locale parity tests for every new or renamed user-facing string and
  placeholder.

Use `npm run check:frontend` while iterating and run the repository's full
`npm run check` quality gate before merging the implementation. No native
sidecar code should change.

### Manual

- Ollama as the fixed provider.
- OpenRouter as the fixed provider.
- Ollama below the threshold and OpenRouter above it, verifying both exact
  threshold edges.
- LM Studio at `http://localhost:1234/v1` with no key: model discovery, manual
  model entry, connection test, fixed routing, and either size-policy leg.
- Amazon Bedrock at its regional OpenAI-compatible `/v1` base URL with a Bedrock
  API key: model discovery, connection test, and one real transformation.
- Another key-protected OpenAI-compatible endpoint over HTTPS when available.
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
   an explicitly disabled remote capability remains fixed to Ollama.
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
12. All new user-visible copy goes through Speech Kit's locale catalogs with
    placeholder parity and English fallback.
13. Disabling LLM features during a running session prevents every subsequent
    provider request, regardless of the snapshotted policy. Re-enabling applies
    only to sessions started afterward.

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
