# Contributing to Genesis

Genesis is a repository-native harness. Contributions should make outcomes easier to verify, sessions easier to resume, or context cheaper to use without discarding requirements. Model-specific behavior belongs in a demonstrated host adapter, not the core state contract.

## Start locally

You need Git and Node.js 18+; Node 22 is the development default (`.nvmrc`). Python 3 enables Python AST indexing. Bash, rsync and zip are needed for the installer/distribution checks on Unix-like systems.

```sh
git clone https://github.com/ayush488-glitch/genesis-kit.git
cd genesis-kit
npm run check
npm test
npm run demo -- --open
npm run benchmark:context
```

There is no `npm install` step or model credential requirement. The demo creates an isolated temporary repository and prints its path; its no-op gates are explicitly illustrative, not evidence about a real queue. Remove that temporary directory when finished. Run `node tools/genesis.mjs` directly while developing; installation into personal skill folders is optional.

A [development container](.devcontainer/devcontainer.json) provides Node 22 and Python. Open it with a Dev Containers-compatible editor. The container configuration does not mount model credentials or grant a repository access to a model provider. Image and feature downloads need network access on first build.

## Pick a bounded change

Search existing issues and code first. A useful proposal names an observed problem, the affected contract, the smallest change, and how success would be measured. The [review and roadmap](docs/control-room-review.md) distinguishes implemented improvements from experiments that still need evidence.

Create a topic branch from `main`. For coordinated work, agree on file ownership and use isolated worktrees; preserve others' changes. One task should have one writer. Avoid introducing a second writable copy of canonical state.

## Contracts to preserve

- Completion goes through the shared task contract; missing, stale or corrupt proof cannot pass.
- Commands and generated HTML treat repository content as untrusted data.
- Human attribution records real decisions; never synthesize approval identities.
- Resume/recovery never silently replays uncertain external effects.
- Context may summarize optional knowledge, but not silently discard applicable invariants or active rules.
- Learned-rule promotion requires matching experiment evidence, review and rollback.

For nontrivial behavior, add the smallest regression test that fails before the fix and proves the user-visible outcome. Keep synthetic data independent of private coding sessions. For UI changes, check keyboard navigation, search/filters, no-match/empty states, copy-command behavior and a narrow viewport. The panel is a read-only snapshot, so controls must not imply that clicking executed a command.

## Open a pull request

Explain the trigger and resulting behavior, validation actually performed, and compatibility/migration implications. Conventional commit titles such as `fix: preserve pause during recovery` are welcome. Formatting-only and documentation edits do not need mirrored tests. Changes to context schemas, approval requirements, proof fingerprints or CLI contracts need explicit release notes.

CI runs syntax checks and the regression suite. A green suite is evidence about those cases, not a general capability claim. Maintainers decide review and release readiness; do not represent an automated reviewer as human approval.

## Improve the recipes

The original [research, plan, implement, verify and recover guides](recipes/README.md) are deliberately short. Describe required inputs, concrete output and checks. Avoid naming a mandatory model, pasting entire repositories, duplicating system instructions, or turning an untested lesson into policy. Evaluate proposed changes on matched tasks before claiming better outcomes on smaller models.

## Releases and security

See [development and releases](docs/development.md) for compatibility and packaging, and [security reporting](SECURITY.md) for sensitive findings. Genesis is [MIT-licensed](LICENSE); contributions should be compatible with that license and preserve third-party attribution.
