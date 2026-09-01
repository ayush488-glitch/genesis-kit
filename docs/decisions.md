# Genesis decisions

These decisions govern the software-factory upgrade. Superseded entries stay here with their replacement.

## D1 — One repository-native state model

- **Decision:** `.genesis/project.json` and task/decision JSON records are canonical. Markdown, HTML, graphs, and handoffs are generated views.
- **Why:** mirrored writable state drifted in the sample sessions.
- **Trade-off:** JSON is less pleasant to edit than YAML, but Node reads it without a dependency and agents preserve it more reliably.

## D2 — Two adoption modes, one kernel

- **Decision:** `init` creates Genesis for a new project. `adopt` inspects an existing repository read-only unless `--write` is passed.
- **Why:** adoption must establish truth before changing a repository.

## D3 — Ponytail is mandatory

- **Decision:** project policy is `ponytail: full`; every coding/architecture session loads the official Ponytail skill.
- **Why:** unnecessary agents, abstractions, dependencies, gates, and durable files are factory defects.

## D4 — Local, layered code graph

- **Decision:** inventory, dependency, and approximate symbol data normalize into `.genesis/index/graph.json`. Views are generated locally. SCIP/language-native indexes remain optional adapters.
- **Why:** a local graph works offline and avoids a database. Every approximate edge carries provenance and confidence.

## D5 — Proof fails closed

- **Decision:** mandatory evidence must be `pass` and fresh. Missing, `pending`, `skipped`, `stale`, or environment-ambiguous evidence cannot complete a task.
- **Why:** the research corpus contained gates that exited successfully while review was pending.

## D6 — Knowledge survives chat

- **Decision:** a cold session reads the generated knowledge index, current task, relevant decisions/invariants/graph neighborhood, git state, and baseline result before editing.
- **Why:** repository state must let a new human or agent resume without prior conversation history.

## D7 — Observable, human-controlled autonomy

- **Decision:** raw traces remain local and ignored by git. Compact proof references may be committed. The dashboard is derived from state. Control actions append auditable events.
- **Why:** the control panel must observe truth, not become another mutable truth store.

## D8 — Learning is proposed, never silently promoted

- **Decision:** agents may create learned-rule proposals. Activation requires regression evidence, independent review, explicit human approval, and rollback metadata.
- **Why:** fixing one incident does not prove a universal harness rule.

## D9 — Stale-code cleanup is a normal task

- **Decision:** Genesis detects and proposes cleanup. It never silently deletes code.
- **Why:** deletion can break dynamic or externally referenced behavior and requires the same proof discipline as addition.

## D10 — Dark-factory autonomy is earned

- **Decision:** projects advance from discovery to bounded execution to sustained automation only through measured evaluation results; incidents can reduce autonomy.
- **Why:** unattended execution without specifications, observation, and recovery is merely unobserved risk.

