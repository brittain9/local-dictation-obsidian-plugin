---
status: accepted
---

# Preserve persisted compatibility identifiers

User-visible names may change, but persisted and protocol-level identifiers remain stable: the `local-dictation` plugin ID, command IDs, view type, settings keys and schema, secret IDs, sidecar and release-asset names, model and cache paths, CSS prefixes, and wire-protocol strings. Changing one of these identifiers requires an explicit compatibility migration because existing installs, settings, hotkeys, secrets, workspace layouts, downloads, and cached models depend on them.
