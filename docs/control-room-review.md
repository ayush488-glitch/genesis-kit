# Control panel and context review

Reviewed against Genesis 2.2 on 8 September 2026. This document records the implemented changes and the next experiments; it does not claim model-capability gains.

## Findings and implementation

The previous panel was a generated table with a five-second meta refresh. It showed task state but made it difficult to distinguish the active next action, current proof, interrupted attempts and learned rules. Reloading also discarded interaction state. The replacement adds six views, task search/state filtering, contract details, receipt links, attempts, rules and context metrics. It preserves view/filter/scroll state across reloads, exposes keyboard-accessible tabs and supports a narrow layout. Commands are copyable and explicitly require execution in a terminal. There is no browser command server or fabricated approval flow.

The previous kickoff repeated historical context and directed agents to canonical JSON, often followed by another context fetch. The new kickoff is a small entrypoint into `genesis brief`. Optional records are ranked by scope and requirement tags, then recency; summaries expose stable IDs and truncation. Active rules and applicable invariants are retained in full, with an explicit error when they cannot fit. `--since` returns an unchanged marker only when the current source, selected environment, task configuration and selected packet match its fingerprint. Consumers must already hold that full packet to reuse it.

## Measurement

`npm run benchmark:context` creates an isolated repository containing 150 synthetic knowledge records, 30 applicable to the active parser task. It does not call a model. One observed run produced:

| View | UTF-8 bytes |
| --- | ---: |
| Canonical state | 170,820 |
| Applicable context with full records, 64k budget | 33,816 |
| Default compact context, 8k budget | 7,750 |
| Unchanged response | 212 |
| Kickoff | 1,251 |

The compact packet included 15 optional records and reported 15 omissions. Full records remain available by ID. A separate same-fixture comparison against the previous implementation measured 11,322 bytes for the former default context and 2,149 bytes for its kickoff; measurements vary slightly with project metadata. Reducing bytes by omitting optional content is not evidence that acceptance outcomes stayed constant. The next evaluation must check that.

Metrics expose `estimated_tokens = ceil(UTF-8 bytes / 4)` as a labeled heuristic. Tokenization differs across models, languages and content. Billing also depends on host history, tool output, caching and failed attempts. No percentage of real token or cost savings is promised here.

## Research–plan–implement

[HumanLayer's context-engineering article](https://www.humanlayer.dev/blog/advanced-context-engineering) describes deliberate compaction through research, planning and implementation with human review at consequential decisions. Its [planning](https://github.com/humanlayer/humanlayer/blob/main/.claude/commands/create_plan.md) and [implementation](https://github.com/humanlayer/humanlayer/blob/main/.claude/commands/implement_plan.md) workflows also separate implementation phases and verification.

Genesis adopts the useful structural idea through original brief guides: research produces cited findings; planning produces a bounded acceptance contract; implementation produces source and proof. Verification and recovery get their own small guides. Existing repository phase and approval rules remain authoritative. A guide is a reusable procedure, not a claim that a small model inherits the intelligence of the model that wrote it.

## Next experiments, ranked

| Priority | Experiment | Required evidence before expanding it |
| --- | --- | --- |
| 1 | Compare full vs compact context on matched repository tasks | Accepted outcomes, missed requirements, interventions, actual host tokens and elapsed time; include failure cases |
| 2 | Compare phase briefs with a smaller and a stronger model | Fixed task/model versions and budgets, paired outcomes and retries; no routing policy before measurements |
| 3 | Identify repeated failure classes and successful counterexamples | Reproduced incidents with discriminating evidence; convert only recurring failures into candidate rules |
| 4 | Improve context selection for large task graphs | Retrieval misses and latency on realistic repositories; consider extractor caching only when indexing is a bottleneck |
| 5 | Add authenticated browser controls | A concrete workflow requiring execution from the browser plus host-bound authorization, CSRF protection, cancellation and audit tests |

Do not replace missing telemetry with zero cost or describe a tied experiment as improvement. Do not add a vector database, multi-agent scheduler or model router solely to make the repository appear larger. The current release provides the contracts, metrics, guides and contribution paths needed to evaluate those ideas.

## Open-source operating model

The release adds contributor documentation, a source map, an optional Node/Python devcontainer, issue/PR templates, a changelog, security guidance and a draft-release workflow. The workflow verifies the package version, runs checks/tests and attaches an offline ZIP with a SHA-256 checksum. Publication is a separate maintainer action. No invented team, benchmark leaderboard, support promise or production adoption claim is included.
