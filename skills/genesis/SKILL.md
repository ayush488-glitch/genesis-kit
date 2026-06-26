---
name: genesis
description: "Use when starting a brand-new project, adopting an unfamiliar repo, or setting up AI-native loop-based development. Scaffolds the .genesis/ spine (context graph, definition-of-done, plan, rolling state, loops), seeds it from the agentic-swe-kit, and primes the first BUILD loop. Use this whenever the user says 'start a project', 'set up genesis', 'make this loop-ready', or describes kicking off new work."
title: "Genesis — turn an empty repo into a loop-ready repo"
one_liner: "Sets up the per-project spine + loops so you design loops instead of prompting turn-by-turn."
outcome: "A repo with a context graph, a written definition of done, a sliced plan, a durable state file, and a runnable BUILD loop — in any agent."
version: 1.0.0
license: MIT
works_with: [claude, hermes, codex, cursor, windsurf, any-agent]
composable: true
metadata:
  hermes:
    tags: [genesis, setup, loops, ai-native, orchestration, project-kickoff]
    category: swe-foundations
    related_skills: [agentic-swe-master, blueprint, detective, verify, scout]
trigger_conditions:
  - "Use this when starting a new production-grade or AI-native project from scratch"
  - "Use this when adopting an unfamiliar repo and you need a structured state spine before working"
  - "Use this when the user wants loop-based / autonomous development set up"
  - "Use this when there is no .genesis/ directory yet and work is about to begin"
  - "Use this when the user says 'set up genesis', 'make this loop-ready', or 'kick off the project'"
---

# /genesis

You are setting up a repo so that **loops prompt the agent, not the human**. The output is the
`.genesis/` spine plus a primed first loop. This skill is agent-agnostic — resolve every skill call
and loop primitive through `AGENT-ADAPTERS.md`.

## Procedure (run in order — this IS the genesis ritual)

1. **Load `agentic-swe-master`** and run its 5-question diagnostic. Write the cognitive job into
   `DONE.html` section 1. (G0 — Cognitive Design. Do not skip.)
2. **Scaffold** the spine: `tools/scaffold.sh <repo>` (or copy `templates/.genesis/`). (G1)
3. **Graph** the repo: `node tools/graphizer.mjs <repo> --write`, then add 2–3 invariants by hand
   to `context-graph.json`. (G2)
4. **Seed the wiki** — add pointers to relevant agentic-swe-kit concept pages in `wiki/index.md`. (G3)
5. **Write the definition of done** — copy each touched phase's "Gate:" line from `agentic-swe-master`
   into `DONE.html` section 2. (G4)
6. **Slice the plan** into milestones in `PLAN.md` — each with a single outcome, an exact demo command,
   a freeze boundary, and assigned skills. Mirror into `DONE.html` section 3. (G5)
7. **Prime & run** — fill `KICKOFF.md` placeholders, then start the BUILD loop on M1: run G0 Existence
   Pre-Flight, then L1 BUILD per `LOOPS.md`, exit through L4 VERIFY. (G6)

## Stop conditions
- Genesis is complete when the checklist at the bottom of `genesis.md` is all-true.
- If the repo already has `.genesis/`, do NOT overwrite — read it and resume from `CURRENT.md` instead.

## What good looks like
- Every milestone in `PLAN.md` has a runnable demo command (if you can't write one, the slice is too vague).
- `context-graph.json` has real invariants, not just dependencies.
- `DONE.html` definition-of-done is binary and checked by a **separate** verifier, never the maker.

## Common pitfalls
- **Skipping G0 cognitive design.** Fix — write the cognitive job first; everything downstream routes from it.
- **Inventing milestones without demo commands.** Fix — the demo command is the milestone's contract.
- **Letting the maker grade its own work.** Fix — L4 VERIFY is always a separate context/model.
- **Editing DONE.html mid-loop.** Fix — DONE.html is locked; change scope via the user, not silently.
