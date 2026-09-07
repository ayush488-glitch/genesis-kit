# Verify

Outcome: evidence that the declared behavior holds for the current inputs.
Inspect the diff and acceptance conditions before running mandatory gates. Cover actor, scope, environment, duration and failure behavior. Check runtime identity independently when runtime proof is required. A source-mutating gate must be rerun after the source is stable. Read full evidence when a status alone cannot explain a failure.

Handoff: report observed results, gaps and limitations. Obtain a real independent reviewer for non-low-risk work. Do not weaken the gate to make the task pass, impersonate a reviewer, or set task state to done manually. Complete through the CLI only when its contract passes, then checkpoint.
