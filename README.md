# Genesis

Genesis is an open-source, agent-agnostic development harness for human–AI software work. It gives a new or existing repository one durable, inspectable source of truth:

```text
intent → bounded task → proof → checkpoint → cold-session handoff
```

It runs offline with Node.js 18+ and has no package dependencies. Ponytail `full` is mandatory: reuse what exists, prefer the standard library, and build only the smallest proven change.

## Install

```bash
./install.sh
```

The installer is offline and idempotent. It installs the Genesis skill for Codex and Claude Code and links `genesis` into `~/.local/bin` (override with `GENESIS_BIN_DIR`). It does not clone repositories or edit shell startup files.

You can also run the CLI without installing it:

```bash
node tools/genesis.mjs --help
```

## Start or adopt a project

For a new repository:

```bash
genesis init /path/to/repo --objective "Ship the smallest useful slice"
```

For an existing repository, inspect first and write only after review:

```bash
genesis adopt /path/to/repo
genesis adopt /path/to/repo --write --objective "Safely continue this project"
```

`init` and `adopt --write` create `.genesis/project.json`, the canonical state. They also generate:

- `.genesis/KICKOFF.md` — the cold-session handoff;
- `.genesis/dashboard.html` — a five-second-refreshing local view;
- `.genesis/index/graph.json` and focused graph views;
- `.genesis/local/events.jsonl` — redacted, git-ignored local traces.

Generated files are projections. Edit state through the CLI, not by maintaining parallel plans or dashboards.

## Daily loop

```bash
genesis status .
genesis record decision . --id ADR-1 --title "Keep state local" \
  --text "Repository JSON is authoritative" --source "human approval"
genesis record assumption . --text "The first release runs on Node 18+"
genesis record invariant . --text "Mandatory proof must match current sources"
genesis record knowledge . --title "Authentication boundary" \
  --text "The API validates tenant ownership" --source docs/security.md
genesis task add . --id T-1 --outcome "Add the first proven slice" \
  --gate 'tests:npm test'
genesis gate . T-1
genesis task complete . --id T-1
genesis checkpoint .
```

A mandatory gate passes only when its evidence passed against the current source hash. Missing, failed, pending, skipped, or stale evidence blocks completion. Medium, high, and critical work also needs an independently approved review gate.

Useful commands:

```bash
genesis index .                         # refresh the local code graph
genesis dashboard .                     # regenerate the dashboard
genesis trace . --event work.started    # append a redacted local trace
genesis cleanup .                       # propose; never delete
genesis learn propose . --rule "..."    # propose; never self-promote
```

Human controls are auditable events:

```bash
genesis control approve . T-1 --gate independent-review \
  --human ayush --reason "Reviewed diff and proof"
genesis control pause . T-1
genesis control resume . T-1
```

## Resume in a new session

Give the next human or agent `.genesis/KICKOFF.md`. It reconstructs the objective, completed work, active task, decisions, assumptions, blocker, evidence context, and exact next action without the earlier chat. The session should then read only relevant graph neighbors and proof.

## Legacy projects

Legacy `.genesis/` content is evidence and is never deleted:

```bash
genesis migrate .          # dry-run report
genesis migrate . --write  # add v2 state beside preserved files
```

## Package and test

```bash
npm test
./make-zip.sh
```

The archive contains only this kit; installation never requires network access.

MIT.
