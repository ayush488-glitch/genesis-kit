# Verified autonomy

## Release contract

This release implements the implementation and session-review recommendations approved by the repository owner on 8 September 2026.

1. All task transitions obey one completion and activation contract. Missing, corrupt, stale, mutating or environment-incompatible proof blocks completion. Review gates cannot become shell commands. Dependencies determine eligible work.
2. Executable proof has immutable attempt identity, input/configuration digests, environment provenance and failure classification. Concurrent writers cannot silently overwrite state. Interrupted attempts require reconciliation.
3. Outcome scenarios identify actor, scope, environment, duration and the gate that proves the observable behavior. Runtime checks can produce structured receipts for the actual build/service/database under test.
4. Context retrieval is task-scoped and bounded, including relevant knowledge, graph neighbors, prior attempts, active learned rules and existing authorization. Corrections supersede records rather than erasing history.
5. A bounded single-worker runner invokes an explicitly authorized host command, persists attempts, enforces time/task limits, checks scope, runs gates and stops for review or unresolved failures. It does not silently retry uncertain external side effects.
6. Learning compares baseline and candidate in separate disposable copies using a protected evaluator and development/holdout cases. Promotion needs intact experiment evidence, independent review, human attribution and a rollback reference. Active rules are included in context; rollback deactivates them.
7. Historical session failures become synthetic regression fixtures: missing proof, partial outcomes, stale runtimes, invalid prerequisites, source mutation, continuation, pause/recovery, isolation and unsupported learning claims.

## Boundaries

Local attribution records do not authenticate a human. Host permissions enforce credentials, network and filesystem isolation; a working directory or worktree is not a sandbox. Repository policy cannot protect against an actor that can rewrite both the verifier and its data. The evaluator must be controlled outside the candidate for adversarial optimization.

No graph database, hosted dashboard, automatic production deployment, automatic global-policy promotion or unmeasured model routing is included. Runtime and outcome checks remain domain-specific commands supplied by the project. There is no promise of exactly-once external effects or a benchmark improvement percentage.

## Verification

Run the existing suite and adversarial integration cases, including real child-process interruption and concurrent state mutation. Exercise the complete runner and learning flow in disposable fixtures, run syntax checks, and verify the offline distribution contains the new commands and documentation.
