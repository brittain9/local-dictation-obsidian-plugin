---
status: accepted
---

# Separate plugin and native runtime responsibilities

The TypeScript plugin owns Obsidian integration, microphone capture and playback, settings, orchestration, Markdown handling, optional LLM transforms, and editor changes; the Rust sidecar owns native system-audio capture, speech inference, synthesis, and native model lifecycle. They communicate through the framed stdin/stdout protocol instead of an in-process native add-on or local network service, keeping Obsidian-specific code separate from native runtime complexity and containing sidecar failures outside the plugin process.
