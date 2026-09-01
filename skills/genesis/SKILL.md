---
name: genesis
description: Initialize, adopt, resume, inspect, or operate a project with the Genesis repository-native human-AI development harness.
---

# Genesis

Use Genesis when starting a project, adopting an existing repository, resuming work from a cold session, proving a bounded task, or inspecting its software-factory state.

## Required policy

Load the official Ponytail skill at `full` before architecture or code changes. Do not replace it with a copied summary.

## Entry points

- New repository: `genesis init <repo> --objective "..."`
- Existing repository: `genesis adopt <repo>` first; run again with `--write` only after the human accepts the discovery report.
- Existing legacy spine: `genesis migrate <repo>` first, then `--write`. Migration preserves every legacy file.
- Resume: read `.genesis/KICKOFF.md`, then the active task in `.genesis/project.json`.

If `genesis` is not on `PATH`, run `node <genesis-kit>/tools/genesis.mjs`.

## Session contract

Before editing, report `state → evidence → blocker → next action`. Inspect only the relevant graph neighborhood, decisions, and proof. Search the repository before adding anything.

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
