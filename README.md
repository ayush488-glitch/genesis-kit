# genesis-kit

> Turn any empty repo into a **loop-ready** repo — in any agent (Claude Code · Hermes · Codex · Cursor · …).
>
> You stop prompting the agent turn-by-turn. You run a one-time **genesis ritual** that lays down a
> per-project spine (knowledge graph, definition-of-done, sliced plan, durable state, loops), then a
> **BUILD loop** drives the agent against it with anti-slop gates and a separate verifier.

This sits on top of two libraries you already have:

| Layer | Repo | Role |
|---|---|---|
| **Knowledge graph** | `agentic-swe-kit` | The 20-phase `agentic-swe-master` orchestrator + 7 domain skills + concept wiki. "What's the correct engineering move." Installed globally. |
| **Cognitive skills** | `skills-directory` | `detective`, `verify`, `scout`, `blueprint`, `council`, `ghost`… the composable verbs a loop calls. |
| **Per-project spine** | **this kit** | The `.genesis/` directory the genesis ritual creates fresh in each project, and the loops that run it. |

---

## Install

```bash
cd genesis-kit
./install.sh        # installs agentic-swe-kit + the `genesis` skill into every agent found
```

Detects `~/.hermes`, `~/.claude`, `~/.codex` and installs into each. Sets `GENESIS_KIT_ROOT`.

## Start a project (the ritual)

```bash
cd <your-project>
$GENESIS_KIT_ROOT/tools/scaffold.sh .             # 1. drop the .genesis/ spine
node $GENESIS_KIT_ROOT/tools/graphizer.mjs . --write   # 2. build context-graph.json
# 3. in your agent: invoke the `genesis` skill, run G0–G6 (see .genesis/genesis.md)
```

Then drive the BUILD loop with your agent's primitive — Claude `/goal`, Codex `/goal`, Hermes
automation (see `AGENT-ADAPTERS.md`).

## Ship it to someone else

```bash
./make-zip.sh                # vendors the swe-kit, produces genesis-kit.zip
# recipient: unzip genesis-kit.zip && cd genesis-kit && ./install.sh
```

---

## What the spine looks like (created per project)

```
<project>/.genesis/
  genesis.md                  the ritual (G0–G6) — how to set this project up
  LOOPS.md                    the 5 loops (BUILD/DEBUG/RESEARCH/VERIFY/HEALTH) + 5 anti-slop gates + G0
  DONE.html                   LOCKED: cognitive job + definition-of-done + implementation plan (visual)
  implementation-notes.html   rolling "what's LIVE right now" — the git-like restart point
  PLAN.md                     machine-parseable milestone list (mirror of DONE.html §3)
  KICKOFF.md                  paste-to-resume prompt for a cold session
  context-graph.json          nodes/edges/invariants — what breaks what (L4 checks invariants)
  decisions/                  ADRs — one file per irreversible decision
  checkpoints/CURRENT.md      where we are; per-milestone append-only logs
  wiki/                       project knowledge base (index.md, log.md, concepts/)
  AGENT-ADAPTERS.md           how skills/loops/subagents map to each agent
```

## The loop, in one breath

`read STATE → G0 (already built?) → pick milestone → load skills → L1 BUILD (5 gates each iter) →
L2 DEBUG / L3 RESEARCH as needed → L4 VERIFY (separate model, fresh context, checks context-graph
invariants) → update implementation-notes + CURRENT → repeat until DONE.html milestone all-checked.`

## Why it's portable
The spine is just markdown + JSON + HTML — every agent reads those. The only agent-specific things
(how you invoke a skill, run a loop, spawn a verifier) live in **one file**, `AGENT-ADAPTERS.md`.
Swap agents without touching the spine.

## Design principles (from loop-engineering + dynamic-workflows)
- **The agent forgets; the repo doesn't.** State lives on disk in `.genesis/`, never only in context.
- **Maker ≠ checker.** L4 VERIFY is always a separate context/model. "Done" is a verdict, not a vibe.
- **Gates are computed, not narrated.** Run the command, paste the exit code.
- **G0 before every milestone.** Never rebuild what the wiki/notes say already exists.
- **Cheap driver, flagship only for hard hops.** Loops assume the driver is not a flagship model.

MIT.
