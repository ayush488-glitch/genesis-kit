# Verified autonomy

## Release contract

This release implements the implementation and session-review recommendations approved by the repository owner on 8 September 2026.

1. All task transitions obey one completion and activation contract. Missing, corrupt, stale, mutating or environment-incompatible proof blocks completion. Review gates cannot become shell commands. Dependencies determine eligible work.
2. Executable proof has immutable attempt identity, input/configuration digests, environment provenance and failure classification. Concurrent writers cannot silently overwrite state. Interrupted attempts require reconciliation.
3. Outcome scenarios identify actor, scope, environment, duration and the gate that proves the observable behavior. Runtime checks can produce structured receipts for the actual build/service/database under test.
4. Context retrieval is task-scoped and bounded, including relevant knowledge, graph neighbors, prior attempts, active learned rules and existing authorization. Corrections supersede records rather than erasing history.
5. A bounded single-worker runner invokes an explicitly authorized host command, persists attempts, enforces time/task limits, checks scope, runs gates and stops for review or unresolved failures. It does not silently retry uncertain external side effects.
6. Learning compares baseline and candidate in separate disposable copies using a protected evaluator and development/holdout cases. Promotion needs intact experiment evidence, independent review, human attribution and a rollback reference. Active rules are included in context; rollback deactivates them.
7. Historical session failures become synthetic regression fixtures: missing proof, partial outcomes, stale runtimes, invalid prerequisites, source mutation, continuation, pause/recovery, isolation and unsupported learning claims.

## Boundaries

Local attribution records do not authenticate a human. Host permissions enforce credentials, network and filesystem isolation; a working directory or worktree is not a sandbox. Repository policy cannot protect against an actor that can rewrite both the verifier and its data. The evaluator must be controlled outside the candidate for adversarial optimization.

No graph database, hosted dashboard, automatic production deployment, automatic global-policy promotion or unmeasured model routing is included. Runtime and outcome checks remain domain-specific commands supplied by the project. There is no promise of exactly-once external effects or a benchmark improvement percentage.

## Verification

Run the existing suite and adversarial integration cases, including real child-process interruption and concurrent state mutation. Exercise the complete runner and learning flow in disposable fixtures, run syntax checks, and verify the offline distribution contains the new commands and documentation.

## Task and runtime contracts

An existing task-only project can opt into autonomous execution by declaring file scope and observable scenarios:

```sh
genesis task add . --id T-1 --outcome 'User can save an item' \
  --scope src --scope tests --gate 'tests:npm test' \
  --scenario '{"id":"save","actor":"signed-in user","scope":"own items","environment":"test","duration":"one save and reload","observable":"saved item survives reload","gate":"tests"}'
```

Repeat `--scenario` for another actor, tenant, restart, duration or failure case. Each scenario must reference a mandatory executable gate. Genesis verifies the mapping; the project supplies tests that actually check those observations. The runner requires scope and scenarios, while manually operated legacy tasks can be completed with an executable gate.

Use `--runtime 'live:node scripts/check-runtime.mjs'` for runtime proof. The command must emit one JSON object on stdout, containing nonempty `build`, `environment`, `endpoint`, and a `source_hash` matching the `GENESIS_SOURCE_HASH` environment variable. Runtime scenarios must match the receipt environment. The verifier should independently interrogate the running service/build rather than simply echoing those values. Runtime receipts expire after 300 seconds; `--runtime-max-age` changes that duration in seconds. Receipt fields and TTL cannot guarantee that a remote deployment remains unchanged after observation.

Source fingerprints include tracked files, nonignored untracked files, executable mode, missing tracked files, and internal file symlink targets. Ignored generated inputs, databases and dependencies are not implicitly captured: add specific files with repeatable `--input`, select environment variables with `--env`, and supply runtime checks for external state. Gate configuration, policy/specification/plan approval state and the verifier version also invalidate proof. A command that changes its own source inputs fails, even with exit code zero. Run formatters and builds that rewrite source before verification.

## Bounded execution and recovery

```sh
genesis authorize grant . --id A-1 --task T-1 \
  --command 'your-agent-command' --human owner --reason 'Implement the approved slice' \
  --expires '2030-01-01T00:00:00Z' --timeout 600000
genesis run . --max-tasks 1 --timeout 600000
genesis authorize list .
genesis authorize revoke . --id A-1
```

Choose a short expiry appropriate to the actual session. Grants bind one task, command and task configuration. They persist across sessions and must reflect the user's real authorization; recording a name is attribution, not identity verification. Existing specification and plan approvals remain required. The runner invokes one host command, checks declared file scope, runs fresh mandatory gates, and completes only when every completion requirement passes. Medium/high-risk work stops for independent human review. After review, rerunning `genesis run` reuses the successful worker only when its source/configuration and authorization still match. It also reuses valid gate evidence.

Attempts record IDs, parent/child PIDs, start/end times, failure classification and bounded redacted output. POSIX timeouts/signals kill the child process group. Windows termination only targets the child; use a host job/container for stronger process isolation. Operator pause and grant expiry/revocation are checked while a child runs. Cooperative writers use a process lock and reload current state when finishing work, so child completion cannot overwrite a pause. Direct edits outside the CLI bypass that lock.

```sh
genesis control pause . T-1
genesis recover .
genesis control resume . T-1 --human owner
```

Recovery refuses live processes and marks dead attempts interrupted, with an explicit side-effect reconciliation blocker. Inspect files, runtime and remote effects before resuming. No uncertain command is automatically retried. Detached processes that escape the process group and external services remain the host's responsibility. Recovery also marks interrupted experiments; inspect orphaned evaluation processes before rerunning. `--timeout` bounds work, not monetary spend: costs are recorded as unknown, and host/model spending limits must be set separately.

## Context and incidents

`genesis context . T-1 --bytes 12000` returns a bounded JSON packet with task contracts, relevant path/tag records, active rules, recent attempts, grants and advisory graph neighbors. `genesis next` is an alias. Use `genesis context . --id K-1` to retrieve a full record. Task contracts are never silently truncated; an insufficient budget returns an error. Generated kickoff views fall back to the core task handoff when the context packet cannot fit.

Add `--path src/module --tag FR-1` to knowledge records and `--supersedes K-1` to a replacement record. Superseded history remains in canonical state but is excluded from the packet. Static graph confidence describes an inference, not runtime proof; external package imports remain unresolved until independently verified. Graph edges carry the index source fingerprint so consumers can recognize stale indexes.

```sh
genesis incident record . --id I-1 --symptom 'Save failed' --hypothesis 'Stale runtime'
genesis incident update . --id I-1 --status reproduced --evidence 'Reproduction receipt path'
genesis incident update . --id I-1 --status supported --evidence 'Controlled result' \
  --control 'Same request against fresh build succeeds' --trace 'Runtime receipt path'
```

Incident evidence is an attributed investigation note, not executable proof. A plausible diagnosis stays suspected until the operator supplies reproduction and discriminating evidence.

## Evaluated learning

Keep baseline and candidate source in separate repositories/directories. Include the proposed rule in the candidate as `policy.json` containing `{"rule":"the exact proposed text"}`. An evaluator outside both trees receives the disposable work directory and case ID as arguments and returns `{"pass":true}` only after independently checking the outcome.

A suite JSON file looks like:

```json
{
  "evaluator": "./verify.mjs",
  "cases": [
    {"id":"regression-1","split":"development","command":"node solve.mjs","timeout":60000},
    {"id":"unseen-1","split":"holdout","command":"node solve.mjs","timeout":60000}
  ]
}
```

```sh
genesis evaluate . --baseline /path/baseline --candidate /path/candidate --suite /path/suite.json
genesis learn propose . --id LR-1 --rule 'the exact proposed text' --rollback 'Deactivate LR-1'
genesis learn evaluate . --id LR-1 --experiment EV-ID --policy policy.json
genesis learn review . --id LR-1 --human reviewer --reason 'Checked cases and evaluator'
genesis learn approve . --id LR-1 --human owner --reason 'Adopt evaluated rule'
genesis learn rollback . --id LR-1 --human owner --reason 'Observed a regression'
```

Each variant/case runs in its own disposable file copy. The same externally located evaluator checks both variants; input, suite, candidate, evaluator and verifier fingerprints are retained in immutable evidence. Promotion requires current candidate evidence, exact policy text, separate review/promotion attribution and a rollback reference. The command records case outcomes and elapsed time; cost remains unknown. A passing experiment means every candidate case passed with no baseline regression. A tie is allowed and is **not** evidence of improvement. Reviewers must judge whether the cases exercise the proposed policy and whether the gain justifies its maintenance cost.

These copies are not a security boundary: candidate code inherits host filesystem/network permissions and can read an accessible holdout or evaluator. Use externally enforced isolation and a protected evaluator for adversarial self-improvement. A string naming a regression command or `--review pass` cannot promote a rule. Promotion affects repository context only, never the installed global skill.

## Upgrade from 2.1

State schema 2 remains readable with additive defaults. Existing executable evidence must be regenerated because the provenance contract changed; approvals depending on that evidence must be repeated. Tasks without mandatory executable proof can remain drafts but cannot complete. Invalid dependency graphs and executable gates using the reserved `independent-review` ID are rejected. Correct those declarations before continuing. Prior learning approvals do not substitute for experiment evidence in the new promotion flow. There are no new package dependencies.
