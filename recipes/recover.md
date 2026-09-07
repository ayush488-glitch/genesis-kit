# Recover

Outcome: a reconciled attempt and a safe, explicit next action.
Read recent attempt IDs, stop reasons, scope and existing authorization. Check whether parent/child processes or external effects remain active before using `genesis recover`. Inspect outputs and changed files; missing output does not establish that a command did nothing. Classify the blocker and record what was observed.

Handoff: resume only after uncertain side effects are reconciled. Never automatically replay a payment, deployment, message or other external action. Reuse a successful unchanged worker after review. If permission or runtime state is uncertain, preserve the blocker and ask the relevant human. Checkpoint the recovery decision.
