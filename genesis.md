# Genesis operating contract

Genesis makes repository state sufficient for a new human or agent to continue the work safely.

## Start

- New product: `genesis init <repo> --workflow new-product --objective "..."`
- New task-only repository: `genesis init <repo> --objective "..."`
- Existing repository: run `genesis adopt <repo>`, review its report, then `genesis adopt <repo> --write`.
- Legacy Genesis project: run `genesis migrate <repo>` before `genesis migrate <repo> --write`.

Never overwrite an existing `.genesis/`. Never reorganize adopted source code merely to fit Genesis.

For a new product, discovery, specification, and planning are code-free phases. The agent interviews, researches, records context, and prepares artifacts, but product implementation starts only after explicit specification and plan approval.

## Before editing

1. Load the official Ponytail skill at `full`.
2. Read `.genesis/KICKOFF.md`, then run `genesis brief <repo>`. Do not load `.genesis/project.json` wholesale; it grows with every proof and record.
3. Inspect only the active task's decisions, proof, and the code it touches. Ask the index rather than grepping: `genesis query <repo> search|scope|callers|impact|path`.
4. Verify the configured baseline and current git state.
5. State: `current state → evidence → blocker → next action`.

If the current workflow phase is discovery or specification, complete and check `SPEC.md`, then wait for explicit human approval. If it is planning, create requirement-linked tasks with executable gates, check the plan, and wait for explicit human approval.

## Work

Create one bounded task with an outcome, risk, scope, next action, and executable gates. Search for existing code before adding code, and query the index before searching: `genesis query <repo> search NAME` finds a definition, `impact PATH` gives the blast radius before you touch shared code. Prefer deletion and reuse over new abstractions or dependencies.

Index answers are advisory. Confirm them in source, treat `ambiguous` as a candidate set rather than an answer, and remember that only JavaScript, TypeScript and Python are extracted.

Record consequential decisions, assumptions, confirmed invariants, and durable knowledge with `genesis record`. Include provenance in `--source`; do not leave reasoning only in chat.

Proof is fail-closed: mandatory evidence must be `pass` and match current sources. Medium risk and above needs independent review. A maker cannot approve its own review evidence.

Run `genesis serve <repo>` to watch the codebase as a live map while working; it reindexes on save and is read-only. Use local traces for debugging. Secrets are always redacted, raw traces are not committed, and the generated dashboard never becomes a second source of truth.

## Keep going

Once work is authorized, finish it before handing back. Stop only for:

- a Genesis gate: specification approval, plan approval, independent review, authorization, rule promotion;
- an action the human has not already authorized that is irreversible, spends money, or reaches people or systems outside the repository: production deploys, migrations, messages, publishing;
- a real blocker, a conflicting requirement, or an uncertain side effect.

A question the repository, its configuration, the environment or an attached tool can answer is not a blocker. Look first, and when you do ask, say what you checked. Do not go looking for credentials you were not given.

For a build task the handoff is an opened pull request: push the task branch and open one that states the outcome, the gates that ran and what is not covered. Do this without asking unless the repository's instructions or the human restrict pushing. Never push to the default branch, merge, or deploy on your own.

A handback says what was verified, what was only built, and what is left. If a gate or the user-visible outcome has not been exercised, say so first instead of calling the task done.

## Finish or pause

Run relevant gates, record blockers honestly, and run `genesis checkpoint <repo>`. The generated kickoff must identify completed work, current work, evidence, blocker, and one exact next action.

Agents may propose learned rules and stale-code cleanup. Only a human may promote a learned rule; cleanup is never silently applied.
