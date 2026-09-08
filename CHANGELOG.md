# Changelog

## 2.4.0 — Unreleased

Review follow-ups (#13-#20):

- Surface ambiguity everywhere a reference is resolved, not only in the symbol tools, and record it per reference so a two-endpoint query like `path` cannot lose one end. `get_impact` and `trace_path` return `resolved`/`also_matched`, and `genesis query --json` carries it too; a note on stderr was invisible to the callers most likely to act on the wrong symbol.
- Reject unregistered MCP tool names. An unknown name previously fell through to `get_neighbours` and returned a confident wrong answer.
- Stop calling `process.exit` when MCP stdin closes; a queued response on a pipe could be discarded before it flushed.
- Publish graph artifacts atomically (temp file then rename) and reindex through `genesis index`, which takes the repository write lock. A concurrent reader could previously parse a half-written `graph.json`.
- Resolve an aliased parent class by its exported name, so `import { Base as Parent }` followed by `class Child extends Parent` produces an inheritance edge.
- State plainly that `genesis serve` has no authentication and that loopback binding is not authorization: on a shared host any local process can read the index and project state regardless of filesystem permissions.
- Correct three recipes that claimed more for `impact` than it supports. It traverses imports only, so it is a lead rather than proof, it is never evidence about what ran at runtime, and it cannot resolve a file that is not indexed yet.


- Index monorepos correctly: resolve `tsconfig` path aliases against the nearest governing config and resolve workspace packages from `pnpm-workspace.yaml` or `package.json` workspaces, preferring the `exports` "types" condition. On a 351k-line codebase unresolved edges fall from 9,617 to 4,030.
- Extract the declaration kinds TypeScript actually uses, including unexported arrow components and `type`, `interface` and `enum`. Symbols rise from 2,738 to 8,813 on the same codebase; files yielding no symbol fall from 58% to 3%.
- Add `calls` and `inherits` edges for JavaScript, TypeScript and Python, resolved through real import bindings. Calls carry a tier: `proven` when one definition matches, `ambiguous` with every candidate retained when several do, and unresolved calls are counted rather than invented. Symbol indexes are per language, so a call never resolves across languages.
- Add `genesis serve`: a loopback-only, read-only control panel that watches sources, reindexes incrementally on save and streams updates over SSE. It never writes state, never runs commands and stays outside the repository write lock.
- Add a symbol treemap view with call filaments and independent toggles for call, candidate and inheritance edges.
- Make indexing incremental. Extraction is cached per file on size and mtime while resolution stays global, so results are byte-identical to a full rebuild. A single-file edit reindexes in about 0.9 seconds where a cold index takes 3.3.
- Slim `graph.json` by dropping derivable fields: 22MB to 13MB with identical node and edge counts. Graph schema is now 2.
- Add `genesis query`: `search`, `defines`, `scope`, `callers`, `callees`, `impact`, `neighbours` and `path` over the index, with `--json` for machine use. References resolve as a node id, file path, bare symbol name or `path#name`, and ambiguity is reported rather than resolved silently.
- Add `genesis mcp`: the same query surface over JSON-RPC on stdio, so an agent pulls answers from the index on demand instead of receiving one fixed packet. Read-only; approvals and gates stay in the CLI.
- Replace the context packet's raw graph edges with scope cards and a symptom map. A card names what a scope declares, what it depends on and what depends on it; the symptom map resolves file paths, quoted strings and identifiers in the task text to concrete declarations before the agent starts reading. Both are marked advisory.
- Rank records within a relevance band by vocabulary shared with the task, as a tie-break only, so `included_because` keeps its meaning.
- Teach every agent-facing surface to use the index: the skill, the operating contract, the block written into AGENTS.md and CLAUDE.md, the generated kickoff, the phase instruction carried in every packet, and all five phase recipes. Each states that answers are advisory, that `ambiguous` is a candidate set rather than an answer, and that absence from the index is not absence from the repository.
- Document the trust boundary of `genesis serve`, `genesis query` and `genesis mcp` in the autonomy contract: loopback only, no state writes, no approval path, no authentication, and the indexer as the one command `serve` runs.
- Fix `cleanup` reading `edge.kind`/`edge.to`/`node.kind` while the graphizer emits `edge.type`/`edge.target`/`node.type`. Both filters missed and cancelled out, so it always proposed zero files. Added the regression test that was missing.

Compatibility: the context packet replaces `graph` with `scope_cards` and `symptoms`; consumers reading advisory edges should read the cards instead. Graph schema moves from 1 to 2. `graph.json` no longer stores an `id` or `contentHash` on edges, both of which were derivable, and `provenance: {extractor, source}` flattens to `extractor`; the `source` field duplicated the node's own `path`. Regenerate with `genesis index`. Indexing writes `.genesis/index/cache.json`; delete it or pass `--full` to force a rebuild. Live source watching needs recursive `fs.watch`, available on macOS and Windows and on Linux from Node 20.13; elsewhere the panel still works and `genesis index` must be rerun after edits. Language coverage is JavaScript, TypeScript and Python only.

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
