# Development and releases

## Local environment

Use Node 22 for development, with compatibility checked on Node 18 and 22. Python 3 is used by the Python graph extractor. `npm run check` checks JavaScript syntax; `npm test` runs executable regressions. `npm run demo -- --open` creates an isolated UI fixture, and `npm run benchmark:context` prints reproducible payload sizes for synthetic context. No hosted database, model API, frontend build or npm dependency is needed.

The committed devcontainer installs the development runtime. It is optional and has not been asserted to be a security boundary for hostile code. A normal checkout is sufficient. The offline installer remains separate from development and should not run automatically against a contributor's personal skill folders.

## Source map

| Area | Responsibility |
| --- | --- |
| `tools/genesis.mjs` | CLI, canonical state, transitions, proof, context and evaluation |
| `tools/dashboard.mjs` | Escaped static panel HTML/CSS and browser interactions |
| `tools/graphizer.mjs` | Advisory static dependency/symbol index |
| `recipes/` | Short host-neutral phase guides included in briefs |
| `tests/` | Synthetic fixtures exercising observable contracts |
| `tools/demo.mjs` | Disposable demonstration repository |
| `tools/benchmark-context.mjs` | Payload-size comparison; no model call or token claim |

The panel uses native HTML/CSS and a small inline script. It performs no HTTP mutation requests. Open a generated `dashboard.html` directly or serve its `.genesis` directory on loopback for UI development. Auto-refresh reloads the generated file; it does not re-run source checks. Use `genesis dashboard` to recompute the snapshot after external source changes. Never publish a real project's `.genesis` contents as a public demo.

## Compatibility

Maintain the declared Node floor and avoid new runtime dependencies for existing standard-library capabilities. State schema 2 uses additive defaults. Explain any new required field or gate rule in the changelog and migration docs. Proof binds the verifier, so code upgrades can require gates and dependent reviews to be rerun. Compact context is a retrieval view: `--full` opts into full optional records, `--id` retrieves an individual record, and a budget error means required information did not fit.

## Release process

1. Land a bounded PR with current checks and migration notes. Update `package.json`, the README version badge and `CHANGELOG.md` together. Use SemVer: incompatible public contracts require a major version or an explicitly documented compatibility path.
2. From `main`, run the **Draft release** workflow with a tag matching the package version, such as `v2.3.0`. The workflow validates the tag, checks syntax, runs tests, builds an offline ZIP and writes its SHA-256 checksum.
3. Inspect the draft's notes, commit, ZIP contents and checksum. A draft is not a public release. Edit the notes to the selected version's changes and migration requirements, then publish when ready.
4. Release consumers should verify the checksum and inspect upgrade notes. Never overwrite a published version; issue a patch release. If a release is bad, explain the defect and recommend a known-good version while preparing a fix.

The workflow intentionally runs only from `main`, creates a draft, and does not publish to npm or install into contributors' hosts. It uses `contents: write` only in its release job. Re-running an existing tag fails rather than overwriting its release assets. Repository maintainers may add environment approval rules for their governance needs.

No public release, branch protection rule, maintainer team or response SLA is implied merely by adding this workflow.
