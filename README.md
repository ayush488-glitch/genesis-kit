# Genesis

Genesis is an open-source, agent-agnostic development harness for human–AI software work:

```text
idea → discovery → specification → plan → code → proof → checkpoint
```

It gives a coding agent durable project memory, explicit phase boundaries, traceable requirements, fresh proof, and an exact next action. It runs locally on Node.js 18+ with no package dependencies. Ponytail `full` is mandatory.

## Fastest start: paste this into your coding agent

Replace the goal in the first line, then paste the complete prompt into a coding session opened inside your new project repository:

```text
Set up and use Genesis for this repository. My project goal is: "REPLACE THIS WITH WHAT I WANT TO BUILD."

1. Check whether the `genesis` command is available. If it is missing, install the current kit from https://github.com/ayush488-glitch/genesis-kit.git into ~/.local/share/genesis-kit: clone it when absent, or update it with a fast-forward-only pull when present, then run install.sh. Do not modify shell startup files.
2. Load the installed Genesis skill and the official Ponytail skill at full.
3. If this repository already contains implementation code, run `genesis adopt .` read-only, show me the discovery report, and wait for my approval before running `genesis adopt . --write`.
4. If this is a new project, run `genesis init . --workflow new-product --objective "<the project goal I gave above>"` using my actual goal, not the angle-bracket placeholder.
5. Run `genesis agent connect . --write` so future coding sessions load the repository contract.
6. Read `.genesis/KICKOFF.md` and report: state → evidence → blocker → next action.
7. For a new product, remain in discovery/specification mode. Interview me about users, outcomes, constraints, non-goals, trust boundaries, risks, success criteria, and open questions. Record durable assumptions, decisions, and sourced knowledge through Genesis. Fill SPEC.md with stable FR-*, NFR-*, and AC-* identifiers. Do not write product implementation code.
8. Run `genesis spec check .`. Show me the specification and wait for my explicit approval. Never approve on my behalf.
9. After I approve, record it with `genesis spec approve . --human "MY NAME" --reason "Specification reviewed"`.
10. Create bounded implementation tasks. Every task must reference approved requirement IDs with `--requirement` and include an executable `--gate`. Run `genesis plan check .`, show me `.genesis/PLAN.md`, and wait for my explicit plan approval.
11. After I approve the plan, run `genesis plan approve . --human "MY NAME"`. Implement only the active task, run its gates, obtain independent human review for medium-risk or higher work, and checkpoint before stopping.

Never claim a gate passed without running it. Never code while the Genesis phase instruction prohibits implementation. Never leave a binding decision only in chat.
```

For an existing project, use this shorter prompt:

```text
Use Genesis to adopt this existing repository. Load Genesis and Ponytail full. Run `genesis adopt .` read-only and show me the discovered languages, commands, git state, and legacy Genesis status. Do not write anything until I approve adoption. After approval, run `genesis adopt . --write`, then `genesis agent connect . --write`, read `.genesis/KICKOFF.md`, index the repository, record confirmed invariants and important knowledge, and propose one bounded task with executable proof. Report state → evidence → blocker → next action before editing code.
```

For a later cold session:

```text
Resume this repository with Genesis. Load Genesis and Ponytail full, read `.genesis/KICKOFF.md`, verify the current source and proof state, obey the current phase instruction, and continue only the active task. Record durable discoveries and run `genesis checkpoint .` before stopping.
```

## Install manually

```bash
git clone https://github.com/ayush488-glitch/genesis-kit.git ~/.local/share/genesis-kit
cd ~/.local/share/genesis-kit
./install.sh
```

The offline, idempotent installer copies the Genesis skill and a pinned copy of the official MIT-licensed [Ponytail](https://github.com/DietrichGebert/ponytail) base skill for supported coding agents, then links `genesis` into `~/.local/bin`. It does not edit shell startup files or download dependencies.

## New-product workflow

Initialize a specification-first project:

```bash
genesis init . --workflow new-product --objective "Build a clinic scheduling platform"
genesis agent connect . --write
```

Genesis creates:

- `SPEC.md` — the human-readable product specification;
- `.genesis/project.json` — canonical workflow, task, knowledge, approval, and proof state;
- `.genesis/KICKOFF.md` — the cold-session handoff;
- `.genesis/PLAN.md` — a generated requirement-to-task projection;
- `.genesis/dashboard.html` — local status and redacted trace view;
- `.genesis/index/graph.html` — searchable graphical code index.

During discovery, the coding agent interviews the human and updates `SPEC.md`. It records durable context instead of leaving it in chat:

```bash
genesis record assumption . --id A-1 --text "Clinic staff create appointments" --source "human interview"
genesis record decision . --id ADR-1 --title "First user" --text "The first release serves clinic staff" --source "human approval"
genesis record knowledge . --id K-1 --title "Scheduling rule" --text "A doctor cannot have overlapping appointments" --source "domain interview"
```

The specification must contain `FR-*`, `NFR-*`, and `AC-*` identifiers. Check it, then record explicit human approval:

```bash
genesis spec check .
genesis spec approve . --human ayush --reason "Scope and acceptance criteria reviewed"
```

Create tasks that trace back to approved requirements:

```bash
genesis task add . \
  --id T-1 \
  --outcome "Staff can create conflict-free appointments" \
  --risk medium \
  --requirement FR-1 \
  --requirement NFR-1 \
  --requirement AC-1 \
  --gate 'tests:npm test'

genesis plan check .
genesis plan approve . --human ayush --reason "Slices and proof reviewed"
```

Genesis will not activate implementation work until the specification and plan pass their checks and receive human approval.

## Build and prove

```bash
genesis status .
genesis gate . T-1
genesis control approve . T-1 \
  --gate independent-review \
  --human reviewer-name \
  --reason "Reviewed the change and current proof"
genesis task complete . --id T-1
genesis checkpoint .
```

Mandatory proof must pass against current sources. Missing, failed, pending, or stale evidence blocks completion. Medium, high, and critical tasks automatically receive an `independent-review` gate, and the task owner cannot approve their own work.

## Existing projects

Adoption is read-only first:

```bash
genesis adopt /path/to/project
genesis adopt /path/to/project --write --objective "Safely continue this project"
genesis agent connect /path/to/project --write
```

Genesis does not reorganize adopted source code. Legacy `.genesis/` content can be migrated without deletion:

```bash
genesis migrate .
genesis migrate . --write
```

## Useful commands

```bash
genesis workflow status .               # current workflow and phase
genesis spec status .                   # draft, checked, approved, or stale
genesis plan status .                   # traceability and approval state
genesis plan reopen . --human NAME --reason "Scope changed"  # reopen after active work ends
genesis index .                         # refresh the graphical code index
genesis dashboard .                     # regenerate the local control view
genesis trace . --event work.started    # append a redacted local trace
genesis control pause . T-1             # human control action
genesis cleanup .                       # propose stale-code review; delete nothing
genesis learn propose . --rule "..."    # propose a harness rule; never self-promote
```

Generated Markdown and HTML files are projections. Change operational state through the CLI, not by maintaining parallel dashboards or plans.

## Package and test

```bash
npm test
./make-zip.sh
```

See [the workflow plan](docs/workflow-plan.md), [architecture decisions](docs/decisions.md), and [agent adapters](AGENT-ADAPTERS.md).

MIT.
