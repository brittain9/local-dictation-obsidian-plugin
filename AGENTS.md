# Repository Guide

## Goal

Build a desktop-first Obsidian plugin for private, local speech-to-text.

- Obsidian is the host editor and note-taking environment
- speech-to-text is the core feature
- transcription stays local after setup
- no accounts, no cloud dependency, no telemetry
- cross-platform desktop matters more than OS-specific integration tricks

## Principles

Behavioral rules for working in this repo. Bias toward caution over speed; use judgment for trivial tasks. These sit on top of the global engineering standards in `~/.claude/CLAUDE.md` and the project workflow below.

### Think Before Coding

Don't assume. Don't hide confusion. Surface tradeoffs.

- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop and name what's confusing before acting.

### Simplicity First

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If 200 lines could be 50, rewrite it.

Senior-engineer test: would they call this overcomplicated? If yes, simplify.

### Surgical Changes

Touch only what you must. Clean up only your own mess.

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- Notice unrelated dead code? Mention it — don't delete it.
- Remove imports, variables, or functions that *your* changes made unused; leave pre-existing dead code unless asked.

Every changed line should trace directly to the request.

### Goal-Driven Execution

Define success criteria. Loop until verified.

- "Add validation" → "Write tests for invalid inputs, then make them pass."
- "Fix the bug" → "Write a test that reproduces it, then make it pass."
- "Refactor X" → "Ensure tests pass before and after."

For multi-step tasks, state a brief plan with a verify step per item. Strong success criteria let you loop independently; weak ones ("make it work") just produce rework.

## Workflow

Trunk-based development. Short-lived feature branches merged via PR. `main` stays releasable. GitHub issues are the primary tracker for planned work, bugs, and feature requests. Code is the source of truth.

Use `PLANS.md` only for active large-change work. Do not keep stale plan text as a second source of truth.

## Dev vault

Build and dev-install target this vault: `C:\Users\alex\Documents\stt-test-vault` (used by `npm run install:dev`).

## Architecture

The repository is split into two runtime boundaries:

- root Obsidian plugin in TypeScript
- native sidecar in Rust under `native/`

Rules:

- the plugin owns Obsidian UX, settings, editor insertion, and capture-side concerns
- the sidecar owns inference and native audio-processing concerns
- keep the plugin class thin and push logic into focused modules
- desktop-first remains the active default
- evolve the design within this split instead of reshaping it for each new backend
- prefer broadly portable backends over platform-locked ones
