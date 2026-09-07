---
name: genesis
description: Start a specification-first project, adopt or resume a repository, and operate the Genesis repository-native human-AI development harness.
---

# Genesis

Use Genesis when starting a project, adopting an existing repository, resuming work from a cold session, proving a bounded task, or inspecting its software-factory state.

## Required policy

Load the official Ponytail skill at `full` before architecture or code changes. Do not replace it with a copied summary.

## Entry points

- New product: `genesis init <repo> --workflow new-product --objective "..."`. Remain in discovery/specification until human approval.
- New task-only repository: `genesis init <repo> --objective "..."`.
- Existing repository: `genesis adopt <repo>` first; run again with `--write` only after the human accepts the discovery report.
- Existing legacy spine: `genesis migrate <repo>` first, then `--write`. Migration preserves every legacy file.
- Resume: read `.genesis/KICKOFF.md`, then the active task in `.genesis/project.json`.
- Connect cold coding-agent sessions: inspect `genesis agent connect <repo>` first, then use `--write` only with human approval.

If `genesis` is not on `PATH`, run `node <genesis-kit>/tools/genesis.mjs`.

## Session contract

Before editing, report `state → evidence → blocker → next action`. Inspect only the relevant graph neighborhood, decisions, and proof. Search the repository before adding anything.

Obey the workflow phase instruction in `KICKOFF.md`. During discovery, specification, and planning, do not write product implementation code.

## New-product workflow

1. Interview the human about users, outcomes, constraints, non-goals, trust boundaries, risks, success criteria, and unknowns.
2. Record consequential assumptions, decisions, and sourced knowledge through `genesis record` while filling `SPEC.md`.
3. Give every functional, non-functional, and acceptance requirement a stable `FR-*`, `NFR-*`, or `AC-*` identifier.
4. Run `genesis spec check <repo>`. Show the specification and stop for explicit human approval; never approve it on the human's behalf.
5. After approval, record it with `genesis spec approve <repo> --human NAME --reason "..."`.
6. Create bounded tasks using approved `--requirement` identifiers and at least one executable `--gate` per task.
7. Run `genesis plan check <repo>`, show generated `.genesis/PLAN.md`, and stop for explicit human approval.
8. Record approval with `genesis plan approve <repo> --human NAME --reason "..."`, then implement only the activated task.

Create one bounded task. Every mandatory check must pass against the current source hash; pending, skipped, failed, missing, and stale proof block completion. Medium risk and above requires independent review.

Use `genesis record knowledge|decision|assumption|invariant` for durable context and provenance. Do not leave a binding decision or discovered constraint only in chat.

Decision and knowledge records require `--title` and `--text`; assumptions and invariants require `--text`. Add `--source` whenever provenance is known.

Non-low-risk tasks automatically receive an `independent-review` gate. A separate human approves it only after checking the diff and proof:

```bash
genesis control approve <repo> <task-id> --gate independent-review --human <name> --reason "..."
```

Checkpoint before handing off:

```bash
genesis checkpoint <repo>
```

The generated kickoff and dashboard are read-only projections of `project.json`. Raw traces stay local and secrets are redacted. Propose cleanup and learned rules; never delete code or promote harness rules silently.

## Verified autonomy

Use `genesis context <repo> [task-id]` to retrieve bounded task context; `--id` retrieves a full durable record. Corrections use `record ... --supersedes <id>` so obsolete knowledge stays out of active context without erasing history.

For autonomous execution, declare file scope and outcome scenarios (actor, scope, environment, duration, observable and executable gate). Record only real user authorization with `genesis authorize grant`; then `genesis run` invokes the bounded host command and verifies completion. Existing authorization persists across sessions. Read the kit's `docs/autonomy-contract.md` for argument and receipt schemas.

Never route completion through `task set`. Run executable gates; runtime gates must independently check their target and return a source-bound JSON receipt. Medium/high-risk work still requires independent review of current evidence. Do not impersonate a reviewer. Resume a stopped review with `genesis run`; unchanged successful worker attempts are reused. After a crash, use `genesis recover`, inspect uncertain side effects and resume explicitly. Do not automatically replay side effects.

Keep causal incident hypotheses separate from supported diagnoses. Learning proposals require baseline/candidate evaluation with development and holdout cases, a matching policy artifact, independent review, explicit promotion and rollback. Candidate work directories are not sandboxes; host permissions must protect the evaluator and holdout. Never treat self-reported success or a tied evaluation as measured improvement.
