# Plan

Outcome: a bounded implementation slice with observable acceptance checks.
Use verified research records and current requirements. Name the files to change, dependencies, actor/environment/duration scenarios, executable gates, and relevant risks. Check `genesis query . impact PATH` for each file you intend to change so the slice is scoped against real dependents rather than a guess. Distinguish automated verification from human review. Resolve consequential uncertainty before implementation; document remaining limitations honestly.

Handoff: create requirement-linked tasks through `genesis task add`, run `genesis plan check` in a specification-first workflow, and present the plan for real human approval. Reuse existing approval when still valid. Assign one active slice; avoid pasting the full research history into every task. Do not approve on another person's behalf.
