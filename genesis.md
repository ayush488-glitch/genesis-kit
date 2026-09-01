# Genesis operating contract

Genesis makes repository state sufficient for a new human or agent to continue the work safely.

## Start

- New repository: `genesis init <repo> --objective "..."`
- Existing repository: run `genesis adopt <repo>`, review its report, then `genesis adopt <repo> --write`.
- Legacy Genesis project: run `genesis migrate <repo>` before `genesis migrate <repo> --write`.

Never overwrite an existing `.genesis/`. Never reorganize adopted source code merely to fit Genesis.

## Before editing

1. Load the official Ponytail skill at `full`.
2. Read `.genesis/KICKOFF.md` and `.genesis/project.json`.
3. Inspect only the active task's decisions, proof, and graph neighborhood.
4. Verify the configured baseline and current git state.
5. State: `current state → evidence → blocker → next action`.

## Work

Create one bounded task with an outcome, risk, scope, next action, and executable gates. Search for existing code before adding code. Prefer deletion and reuse over new abstractions or dependencies.

Record consequential decisions, assumptions, confirmed invariants, and durable knowledge with `genesis record`. Include provenance in `--source`; do not leave reasoning only in chat.

Proof is fail-closed: mandatory evidence must be `pass` and match current sources. Medium risk and above needs independent review. A maker cannot approve its own review evidence.

Use local traces for debugging. Secrets are always redacted, raw traces are not committed, and the generated dashboard never becomes a second source of truth.

## Finish or pause

Run relevant gates, record blockers honestly, and run `genesis checkpoint <repo>`. The generated kickoff must identify completed work, current work, evidence, blocker, and one exact next action.

Agents may propose learned rules and stale-code cleanup. Only a human may promote a learned rule; cleanup is never silently applied.
