# Genesis workflow plan

## Objective

Let a coding agent take a project from an initial idea to an approved specification, a traceable implementation plan, verified code, and a cold-session handoff without inventing requirements or coding before human approval.

## Shared lifecycle

`intent → discovery → research → specification → planning → build → verify → operate`

Projects use only the phases they need. The first implementation is the complete `new-product` vertical slice. Existing-project adoption continues to use the same task, proof, knowledge, graph, and checkpoint kernel. Incident and research workflows follow only after the shared kernel is proven.

## Decisions

1. `.genesis/project.json` remains the only operational source of truth.
2. `SPEC.md` is a human-readable artifact; its status, requirements, approval, and source hash live in the ledger.
3. Specification approval is always human. The agent may check structure but may not judge product intent.
4. Tasks created from an approved specification must reference requirement IDs and include executable proof.
5. A generated `.genesis/PLAN.md` projects tasks from the ledger; it is never independently edited.
6. Agent connection appends a small marked contract to `AGENTS.md` and/or `CLAUDE.md` only after `--write`; existing content is preserved.
7. No workflow framework, YAML parser, database, server, hook system, or new dependency is introduced.

## New-product contract

1. `genesis init . --workflow new-product --objective "..."` creates the ledger, `SPEC.md`, and an active specification task.
2. The agent interviews the human and records decisions, assumptions, constraints, and sourced knowledge.
3. `genesis spec check .` validates required sections and stable `FR-*`, `NFR-*`, and `AC-*` identifiers.
4. `genesis spec approve . --human NAME --reason "..."` binds human approval to the current specification hash and moves to planning.
5. Planning tasks reference approved requirement IDs through `--requirement` and name executable gates.
6. `genesis plan check .` fails closed on missing, unknown, or unproved requirements.
7. `genesis plan approve . --human NAME` activates the first task and moves to build.
8. Existing gate, review, completion, control, trace, dashboard, graph, and checkpoint behavior continues unchanged.

## Assumptions

- Markdown is the most portable specification artifact for coding agents and humans.
- Structural checks can detect missing specification content but cannot replace human product judgment.
- Local human names are adequate audit identity for this release; cryptographic identity belongs to a later hosted integration.
- Repository instruction files are the smallest reliable bridge into cold coding-agent sessions.
- Prototype, production, and regulated profiles will eventually vary phase gates, but the first slice must prove the workflow before adding profile-specific policy.

## Acceptance criteria

- A new repository starts in discovery/specification and contains no generated application code.
- Specification approval fails if required sections, requirement IDs, or human identity are missing.
- Approval becomes stale when `SPEC.md` changes.
- Planning rejects tasks that omit requirements, reference unknown requirements, or lack executable proof.
- A fresh agent can follow only the generated kickoff and repository instruction file through the next admissible action.
- Existing Genesis v2 projects remain valid and can start the new-product workflow explicitly.
- Existing `AGENTS.md` and `CLAUDE.md` content is preserved; connection is dry-run by default and idempotent on write.
- All existing tests continue to pass with no runtime dependency added.

## Deferred

- Dedicated incident and research workflow templates.
- Profile-specific regulatory evidence packs.
- Hosted approvals, identity, trace storage, deployment, or background orchestration.
- Automatic requirement prose generation inside the CLI; the coding agent performs reasoning, Genesis records and gates it.
