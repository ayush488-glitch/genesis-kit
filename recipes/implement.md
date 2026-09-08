# Implement

Outcome: the smallest source change that satisfies the active task's contract.
Check current phase, scope, dependencies, authorization and blockers. Run `genesis query . impact PATH` before editing shared code and size the change against what it returns. Inspect only the affected code and full records needed for a decision. Implement the active slice; keep formatting/build mutations before verification. Record new facts and corrections in repository memory. Stop on a conflicting requirement or uncertain external side effect.

Handoff: run fresh mandatory gates, obtain required independent review, then use `genesis task complete` and checkpoint. A successful tool call is not proof of the user outcome. Reuse fresh evidence with `--reuse`; after a review stop, `genesis run` can reuse an unchanged successful worker. Preserve the next action for a cold session.
