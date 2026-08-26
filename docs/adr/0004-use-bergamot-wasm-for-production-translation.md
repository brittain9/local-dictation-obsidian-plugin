---
status: superseded by 0005
---

# Use Bergamot WebAssembly for production translation

Production translation uses Bergamot WebAssembly with SHA-256-pinned Firefox Translations artifacts and runs inference inside an isolated plugin Web Worker; the native sidecar catalog continues to own model metadata, verified installation, and removal without executing translation inference. Bergamot met the interactive latency, footprint, licensing, offline, and Markdown-preservation requirements that the evaluated TranslateGemma, Python, cloud, and LLM-based alternatives did not; a future engine must demonstrate a meaningful improvement and be introduced as a separate product decision.
