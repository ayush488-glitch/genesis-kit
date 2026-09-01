# Software-factory upgrade contract

## Required outcomes

Genesis must:

1. initialize a new repository and adopt an existing repository without overwriting prior work;
2. derive current state and the next admissible action from repository files alone;
3. index qualified files, dependencies, and JS/TS/Python symbols with provenance, confidence, freshness, and deterministic output;
4. generate a bounded graphical repository view;
5. preserve decisions, tasks, proof, failures, limitations, and cold-session handoffs;
6. record local traces and generate a continuously refreshable local dashboard;
7. run task checks and fail closed on incomplete or stale mandatory evidence;
8. append auditable human control actions;
9. create learned-rule and stale-code proposals without activating or deleting automatically;
10. keep Ponytail `full` in project policy and session instructions;
11. migrate an existing legacy `.genesis/` without deleting its files;
12. run with Node standard-library dependencies only.

## Acceptance suite

- Shell and Node syntax checks pass.
- Skill metadata validates.
- A temporary empty repository completes `init`, `status`, `index`, `checkpoint`, and `dashboard`.
- An existing mixed JS/Python fixture completes read-only `adopt`, then `adopt --write` without modifying its source files.
- Repeated indexing without source changes is byte-for-byte deterministic.
- Duplicate basenames retain distinct qualified identities.
- A dependency and symbol expected by the fixture appear in the graph.
- A mandatory pending/stale/failed check prevents completion.
- A passing check records command, exit status, source hash, time, and environment.
- A cold-start handoff identifies current state, evidence, blocker, and exact next action.
- Raw traces are ignored by git and secrets are redacted.
- A learning proposal cannot become active without explicit human approval metadata.
- Migration preserves every legacy file.
- Final Ponytail review finds no removable dependency or speculative subsystem.

## Non-goals for this release

- Hosted control plane or graph database.
- Automatic production deployment.
- Silent rule promotion or code deletion.
- Perfect cross-language call graphs without compiler/indexer evidence.
- Cloud trace retention.
