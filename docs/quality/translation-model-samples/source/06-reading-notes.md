---
title: Reading notes on reliable systems
book: Designing for Failure
rating: 4
---

# Reading notes

The central argument is that reliability comes from explicit boundaries rather than optimistic assumptions. A system should make failure visible, preserve enough evidence to diagnose it, and avoid turning one failed component into damaged user data.

## Ideas worth keeping

- Retries are safe only when the operation is idempotent.
- A timeout does not prove that work stopped.
- “Exactly once” is usually a business invariant built on top of weaker delivery guarantees.
- Human review is part of the system when an automated result can be fluent but wrong.

> [!quote] Paraphrased
> The most dangerous failure is a plausible result that silently violates an invariant.

This maps neatly to translation. The preview can look polished while changing Tuesday to Wednesday. Therefore, the application should preserve the original note and treat Replace as a conditional write. The condition is `currentRevision === capturedRevision`; if it is false, the user may still copy the result without overwriting newer work.

## Connections

1. [[Translation Safety Invariants]] — protected markers and revision checks.
2. [[Installer Design]] — download to a temporary file, verify SHA-256, then promote atomically.
3. [[Worker Lifecycle]] — terminate after success, cancellation, or error.

| Concept | Translation example |
| --- | --- |
| Idempotency | retrying a model download |
| Validation | marker order and count |
| Isolation | inference inside a worker |
| Audit trail | benchmark inputs and outputs |

The book is occasionally repetitive, but its vocabulary is useful. I should revisit the chapter on backpressure before changing the request queue. #reading/reliability
