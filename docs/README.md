# Documentation

Speech Kit keeps different kinds of documentation separate so temporary plans do not become permanent clutter:

- [`system-architecture.md`](system-architecture.md) describes how the current system works.
- [`adr/`](adr/) records accepted architectural decisions and why they were made.
- [`guides/`](guides/) contains maintained setup, testing, and operating instructions.
- [`quality/`](quality/) preserves research, benchmarks, and other decision evidence.
- [`release/`](release/) contains the release process and historical release notes.
- [`specs/`](specs/) is for active design work that has not yet become current architecture.

When a specification is implemented, move lasting current-state information into `system-architecture.md`, preserve only useful evidence under `quality/`, and record any durable trade-off as an ADR. The implementation plan can then be removed; Git history and the associated issue or pull request retain its working history.

Accepted ADRs are constraints on future architectural work. Do not rewrite an accepted ADR to change its decision; add a new ADR that supersedes it.
