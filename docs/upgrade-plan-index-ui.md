# Upgrade plan: real code index, pull-based retrieval, live graph UI

Status: written 2026-09-08. Phase 1 and the Phase 3 panel have landed on
`feat/code-index-and-live-graph`; Phase 2 retrieval is not started. Progress is
tracked in the checklist at the end of this document.

Goal: Genesis should index a large real codebase accurately, let an agent *query*
that index instead of receiving a fixed guess, and show the result in a live
control panel whose graph view is the centrepiece rather than an afterthought.

## Where the idea came from, and what is actually reusable

Two repos were reviewed as prior art. Neither can be ported; both contribute ideas.

**Benzi** (`github.com/oooscoos/Benzi`) — the repo contains no product code. The
engine (`benzi_mcp.py`, `benzi_headless.py`) is closed-source and absent; the
landing page is static marketing HTML with no application JavaScript. What the
repo does contain is a detailed prose description of the design plus a runnable
A/B benchmark harness. Ideas only, nothing to lift.

**bough** (`github.com/nickelsec/bough`) — real Go source, but it is a Claude Code
*transcript* visualizer, not a code indexer: it parses `~/.claude/projects/*.jsonl`
into a day -> task -> prompt tree and draws hand-rolled SVG. No AST, no embeddings,
no query API, no live updates. The viewer pattern is worth stealing; the index is
not there to steal.

Ideas adopted from each are marked below.

## Evidence: current graphizer against a real codebase

Run against `sbl-app` (3,762 tracked files, ~351k LOC TS/TSX):

    2.4s | 6,039 nodes | 16,108 edges | 14MB graph.json

| Measurement | Result |
| --- | --- |
| TS/TSX files with zero symbols extracted | 1,652 / 2,871 (58%) |
| `@/` alias imports resolving to nothing | 4,048 edges |
| Unresolved edges overall | 9,617 / 16,108 (60%) |

351k LOC yielded 2,738 symbols, roughly one per file. The regex extractor
(`graphizer.mjs` `jsSymbol`) misses arrow functions, React components, methods and
re-exports. There is no `tsconfig.json` `paths` resolution at all, so a quarter of
all edges point at synthetic `unresolved:` nodes -- and those are precisely the
internal edges traversal would want.

Separately confirmed: `commandCleanup` (`genesis.mjs:1460`) reads `edge.kind` /
`edge.to` / `node.kind`, while `graphizer.mjs` emits `edge.type` / `edge.target` /
`node.type`. Both filters miss and cancel out, so `genesis cleanup` always proposes
zero files. Dead rather than destructive, but it is a real schema disagreement
between two files that must agree.

## Decisions taken

1. **Ship it in genesis-kit, proven on sbl-app.** Land Phase 1 minimally, index
   sbl-app to prove it at real scale, then harden and build Phases 2-3 on evidence.
2. **Full pull-based retrieval, including MCP.** Genesis today *pushes* a fixed 8k
   packet; the agent should *pull* answers from the index on demand.
3. **TypeScript as an optional peer dependency.** Use the target repo's own
   `typescript` from `node_modules` when resolvable, fall back to today's regex when
   not. Genesis itself stays zero-dependency.
4. **The indexing UI is a first-class deliverable**, not a reporting tab.

### Consequence of decision 4 on architecture

`dashboard.html` is regenerated on *every* `saveState()` (`genesis.mjs:608`).
Inlining a multi-megabyte graph, or a graph rendering library, into a file rewritten
that often is untenable. Therefore the graph view must be **served, not inlined**,
which promotes `genesis serve` from a Phase 3 nicety to a Phase 1 dependency. It
also replaces today's fake liveness (a `setInterval` full-page reload of a static
file that nothing regenerated) with real push updates.

Rendering target is hand-rolled **canvas** with a deterministic force layout: SVG
does not stay interactive at 6k nodes, and vendoring a graph library back into a
constantly-regenerated file reintroduces the same weight problem. A CDN dependency
is rejected because it breaks the offline static-file property Genesis maintains
deliberately.

## Phase 1 -- make the index real

Everything else depends on this.

- Resolve `tsconfig.json` `paths` aliases. Roughly 30 lines of config reading;
  recovers 4,048 edges on sbl-app. Do this first regardless of the rest.
- Real TS/JS extraction via the target repo's `typescript` when resolvable, regex
  fallback otherwise (decision 3).
- Edge kinds beyond `imports` / `defines`: add `calls`, `references`, `exports`.
- **Three tiers of truth** (from Benzi): tag every edge `proven` / `ambiguous`
  (retain the candidate list, never collapse to a single guess) / `unknown`. Extend
  the existing `confidence` and `resolved` fields rather than inventing a schema.
- Incremental reindex keyed on the per-file `contentHash` that already exists.
  2.4s today; real extraction will cost a minute or more, so this stops being
  optional.
- Fix the `cleanup` schema mismatch above.
- Shrink graph.json. 14MB for 6k nodes is provenance strings repeated per node;
  intern them.

## Phase 2 -- make retrieval real

The architectural move: let the agent ask questions instead of receiving a guess.

- `genesis query callers|path|neighbors|defines` -- a real CLI over the graph. This
  is what makes the index queryable.
- The same surface exposed over MCP (decision 2).
- Replace the ranking line in `contextPacket()` (`genesis.mjs:1283`, a single clean
  seam) with graph-aware scoring: k-hop expansion from task scope seeds weighted by
  edge confidence, plus BM25 over knowledge and decision text. No embeddings, no
  vector store, no API key -- roughly 80 lines.
- **Symptom map** (from Benzi): extract identifiers, traceback frames and quoted
  strings from the task text, resolve them against the symbol index *before* the
  agent starts, and seed the packet with concrete code sites. Cheapest high-leverage
  item on the list once Phase 1 lands.
- **Scope cards** (from Benzi): when a task scopes a file, inject a compact profile
  -- its symbols, its callers, its tests -- instead of raw file text.

## Phase 3 -- the control panel

- `dashboardPage()` is a pure `data -> string` function called from exactly one
  place. Add the graph view behind the same signature.
- `genesis serve`: loopback HTTP, `fs.watch` on `project.json`, SSE. No
  dependencies. The static `dashboard.html` remains as an offline fallback.
- Canvas graph view over an aggregated graph -- directory-level nodes, expand on
  click, deterministic layout so it does not jitter between saves.
- Activity timeline in bough's day -> task -> turn shape, fed from Genesis's own
  `attempts[]`, `controls[]` and traces. This is better data than bough can
  reverse-engineer out of transcripts.
- **Provenance in the UI** (from bough): every context packet entry already carries
  `included_because`. Surface it, so retrieval is debuggable rather than a black box.

## Phase 4 -- index sbl-app

Two worktrees for `origin/main` and `origin/release/2sep26` (46 commits apart, 249
files, +63,251 / -1,229 lines). Index both and diff the graphs. Nearly free once
Phase 1 exists, and a branch-to-branch graph diff is useful on its own.

## Known weaknesses this plan does not address

Carried forward from the architecture review, listed so they are not mistaken for
oversights: the single global writer lock serialises all mutations repo-wide;
`--human NAME` attribution is self-reported and unauthenticated; gate and worker
commands run unsandboxed with full host permissions; runtime-gate freshness depends
on the project supplying a truthful verifier; `inputManifest()` rehashes every
tracked file on essentially every state-changing command, with no incremental cache.

## Progress

Measured against sbl-app (351k LOC, 3.7k files) unless noted.

- [x] tsconfig `paths` and pnpm workspace resolution -- unresolved edges 9,617 -> 4,030
- [x] real declaration kinds -- symbols 2,738 -> 8,813, files with none 58% -> 3%
- [x] `cleanup` schema mismatch fixed, with the regression test that was missing
- [x] graph.json slimmed 22MB -> 13MB by dropping derivable fields (schema 2)
- [x] `genesis serve`: loopback, read-only, SSE liveness, aggregated graph API
- [x] canvas graph view, deterministic layout, drill-down, node detail
- [x] both branches indexed into worktrees (`origin/main`, `origin/release/2sep26`)
- [ ] `calls`, `references` and `exports` edges
- [ ] three-tier truth tagging on edges
- [ ] incremental reindex keyed on per-file contentHash
- [ ] `genesis query` CLI and the MCP surface
- [ ] graph-aware context ranking, symptom map, scope cards
- [ ] activity timeline from attempts/controls/traces
- [ ] branch-to-branch graph diff

Two facts worth carrying forward. sbl-app has no `node_modules` installed, so the
TypeScript compiler cannot be resolved from it and the regex extractor is the path
that actually runs there; improving it was worth more than reaching for the
compiler. And `contextPacket` still parses the whole graph on every call, which is
the reason Phase 2 needs a query-friendly sidecar rather than a full parse.
