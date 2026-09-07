# Changelog

## 2.3.0 — Unreleased

- Rebuild the local control panel with overview, task search/filtering, evidence links, execution history, learning and context views. Controls copy CLI commands; the panel remains read-only.
- Add `dashboard --open` and a disposable `npm run demo` fixture.
- Default context to 8,000 UTF-8 bytes, rank scoped records, summarize optional knowledge, and retain full binding rules and applicable invariants. Use `--full` or `--id` for details.
- Add fingerprints, `--since` unchanged responses, explicit payload metrics and phase-specific `genesis brief` guides.
- Shorten cold-session handoffs and stop instructing agents to reread all canonical state.
- Add contribution/security guidance, an optional development container, issue/PR templates, context benchmarking and a manually triggered draft-release workflow.

Compatibility: the context view adds fields and summarizes optional records by default. Consumers requiring full records should use `--full` with an adequate `--bytes` budget. Required context that exceeds the budget fails explicitly. State schema remains 2; verifier-bound proof may require regeneration after upgrading. There is no claimed model-capability or cost improvement from payload measurements alone.

## 2.2.0

Add immutable source/configuration/environment-bound proof, shared completion validation, dependencies, bounded command authorization and execution, runtime receipts, pause/recovery, scoped context, baseline/candidate evaluation and reviewed rule promotion. Include a research-style README and reproducible LaTeX architecture diagram. See the [autonomy contract](docs/autonomy-contract.md) for 2.1 migration requirements.
