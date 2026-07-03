# genesis.md — the project genesis ritual

Run this ONCE when starting (or adopting) any project. It produces the `.genesis/` spine, seeds it from
the global agentic-swe-kit, and leaves you ready to run loops. Agent-agnostic — see `AGENT-ADAPTERS.md`
for how each step's skill calls map to your agent.

> One sentence: **genesis turns an empty repo into a loop-ready repo** — knowledge graph in place,
> definition-of-done written, milestones sliced, state spine seeded, first loop primed.

---

## G0 — Cognitive Design (don't skip — most-skipped, most-expensive to skip)
Invoke `agentic-swe-master`. Answer its 5 diagnostic questions:
scope (new / extend / incident) · AI components? · distributed? · trust boundary? · current phase.
Then write the **cognitive job** into `DONE.html → section 1` (inputs, outputs, autonomy level, HITL
points, failure tolerance, trust boundary).

**Optional but recommended — run KICKOFF-INTERVIEW.md first.** Before answering the 5 questions
yourself, open `.genesis/KICKOFF-INTERVIEW.md` and let the agent ask YOU the questions. It produces
`decisions/decisions-manifest.md` — a record of every assumption made explicit before code starts.
This is the cheapest place to surface unknown knowns.
**Gate:** the cognitive job is written down before any code. Autonomy level explicit. Failure modes listed.

## G0.5 — Brainstorm (skip at your peril — the cheapest design decision is the one you haven't built yet)
Generate **3 fundamentally different approaches** to the cognitive job you just wrote.
For each: one name, two sentences of description, two strengths, two weaknesses.
Then pick one with a single-sentence rationale. Write all three + the choice into
`PLAN.md → Brainstorm section` (already scaffolded as a placeholder — fill it now).
**Gate:** 3 approaches written, 1 chosen with rationale, recorded in PLAN.md before any milestone is sliced.

## G1 — Scaffold the spine
Run `tools/scaffold.sh <target-repo>` (or copy `templates/.genesis/` in by hand). This creates:
`.genesis/{LOOPS.md, DONE.html, implementation-notes.html, context-graph.json, PLAN.md, KICKOFF.md,
decisions/, checkpoints/CURRENT.md, wiki/}`. scaffold.sh will ask you for:
  - cheap/driver model (the model your loops run on by default)
  - flagship/checker model (used for L4 VERIFY and hard ARCH hops)
  - router skill name
  - token budget per milestone
  - max loop iterations per milestone
Press Enter to accept defaults. These fill `{{CHEAP_MODEL}}`, `{{FLAGSHIP_MODEL}}`, etc. everywhere
in the spine so no placeholder tokens survive into your working files.

## G2 — Build the context graph
Run `node tools/graphizer.mjs <target-repo>` → fills `context-graph.json` nodes+edges from imports
(JS/TS/Py). Then **you add 2–3 invariants by hand** — the health rules that define "not broken" (latency,
memory, "domain never imports framework", "every outbound call has a timeout"). Empty repo? Seed nodes
from the architecture you chose in G0.
**Gate:** graph exists, no cycles in the dependency direction you intend, ≥2 invariants written.

## G3 — Seed the project wiki from the global kit
For each phase this project touches, add **pointers** (not full copies) to the relevant agentic-swe-kit
concept pages in `wiki/index.md → Seeded from agentic-swe-kit`. This gives the agent just-in-time access
to deep knowledge without bloating context. Create project-specific entity/concept stubs as you learn them.

## G4 — Write DONE.html from the orchestrator gates
For every phase the project will pass through, copy that phase's **"Gate:"** line from `agentic-swe-master`
into `DONE.html → section 2`. Those gates ARE your definition of done — you already wrote them in the kit.
Add the project-specific success criteria.

## G5 — Slice the plan into milestones
Fill `PLAN.md` (and mirror into `DONE.html → section 3`). Slicing rule: every milestone needs a single
outcome, an exact **demo command** that proves it, and a freeze boundary of files it may touch. If you
can't write the demo command, the milestone is too vague — split it. Assign skills per milestone.

## G6 — Prime and run
Confirm `KICKOFF.md` placeholders are filled. Start the BUILD loop:
- pick M1, run **G0 Existence Pre-Flight** (is it already built?), then **L1 BUILD** per `LOOPS.md`.
- drive it with your agent's goal/loop primitive (Claude `/goal`, Codex `/goal`, Hermes automation — see adapters).
- the loop checkpoints every iteration, exits through **L4 VERIFY** (separate model), updates
  `implementation-notes.html` + `CURRENT.md`.

---

## Genesis output checklist (all true = ready to loop)
- [ ] `DONE.html` section 1 (cognitive job) filled — G0
- [ ] `.genesis/` scaffolded — G1
- [ ] `context-graph.json` has nodes, edges, ≥2 invariants — G2
- [ ] `wiki/index.md` points at relevant swe-kit concepts — G3
- [ ] `DONE.html` section 2 (definition of done) filled from phase gates — G4
- [ ] `PLAN.md` has ≥1 milestone with a real demo command — G5
- [ ] `KICKOFF.md` placeholders replaced — G6
