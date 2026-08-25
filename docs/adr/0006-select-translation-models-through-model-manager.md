# ADR 0006: Select translation models through the model manager

- Status: accepted
- Date: 2026-08-25
- Supersedes: the engine-selection portion of [ADR 0005](0005-use-an-engine-registry-and-isolated-hy-mt-helper.md)

## Context

Translation has the same lifecycle as speech-to-text and text-to-speech: a user installs a catalog model and explicitly selects it. An engine preference, quality tier, or automatic fallback makes the selected model ambiguous and prevents the model catalog from describing its own capabilities.

HY-MT 2 is available as two pinned Q4_K_M catalog models. They share the isolated llama.cpp helper, but have different resource costs and must remain independently selectable.

## Decision

Persist one `selectedTranslationModel` selection and use the ordinary Manage Models `Use`/`Selected` lifecycle. Translation settings expose the current selection and a Manage Models action; translation execution derives language support, runtime, and adapter dispatch from that catalog record.

The frontend keeps a small adapter registry keyed by the selected model's runtime and family. Firefox/Bergamot models use the Bergamot adapter; Tencent HY-MT 2 models use the existing framed llama.cpp helper protocol. There is no translation-specific default, recommendation, priority, engine preference, or automatic fallback.

The isolated native helper decision from ADR 0005 remains in force. HY-MT 1.5 catalog resolution is removed, while previously downloaded files are left untouched and are never resolved by the new catalog.

## Consequences

- Model switching, removal guards, and recovery states are consistent with the other model-backed tasks.
- Catalog metadata can describe the 1.8B model as suitable for most users and present the 7B model as `Heavy` without changing behavior.
- A translation run is reproducible: its sidecar request carries the exact selected catalog model.
- Users must choose a model after upgrading; obsolete persisted engine preferences are ignored.
