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

The cognitive skills referenced in LOOPS.md (`detective`, `verify`, `scout`, `blueprint`, `council`,
`ghost`, `foresight`) live in a separate repo. Install them alongside the kit:

```bash
git clone https://github.com/ayush488-glitch/skills-directory ~/Desktop/skills-directory
# install.sh already adds it to the skill resolution order
```

## Full onboarding (copy-paste this into your agent on first use)

````
You are setting up the "genesis-kit" AI-native development system on my machine,
then helping me start my first project with it. Work like an engineer, not a
narrator: after EVERY command, actually run it and paste the real output. Never
say "this should work." If a step fails, stop and tell me exactly what broke.

────────────────────────────────────────
STEP 1 — Check prerequisites
────────────────────────────────────────
Run and show me the versions:
    git --version
    node --version        # need v18 or newer
If node is missing or older than 18, STOP and tell me to install it first.

────────────────────────────────────────
STEP 2 — Clone the three repos into ~/Desktop
────────────────────────────────────────
(If a folder already exists, cd into it and `git pull` instead of cloning.)
    mkdir -p ~/Desktop
    git clone https://github.com/ayush488-glitch/genesis-kit       ~/Desktop/genesis-kit
    git clone https://github.com/ayush488-glitch/skills-directory  ~/Desktop/skills-directory
    git clone https://github.com/ayush488-glitch/agentic-swe-kit   ~/Desktop/agentic-swe-kit
Confirm all three folders exist with: ls -d ~/Desktop/{genesis-kit,skills-directory,agentic-swe-kit}

────────────────────────────────────────
STEP 3 — Install the kit
────────────────────────────────────────
    cd ~/Desktop/genesis-kit && ./install.sh
This installs the agentic-swe-kit, drops the `genesis` skill into my agent, and
sets GENESIS_KIT_ROOT in my shell file. Because that variable won't be live in
this session yet, export it now so the rest of the steps work:
    export GENESIS_KIT_ROOT="$HOME/Desktop/genesis-kit"
Verify the install — both must succeed:
    echo "$GENESIS_KIT_ROOT"
    ls "$GENESIS_KIT_ROOT/tools"        # must show scaffold.sh and graphizer.mjs
Confirm the genesis skill landed in my agent (show whichever exists):
    ls ~/.claude/skills/genesis 2>/dev/null || ls ~/.codex/skills/genesis 2>/dev/null || ls ~/.hermes/skills/genesis 2>/dev/null

────────────────────────────────────────
STEP 4 — Ask me about my project, then scaffold it
────────────────────────────────────────
Ask me: "What are you building, and is there a project folder yet?" WAIT for my
answer. If I have no folder, create one and make it a git repo:
    mkdir -p ~/Desktop/<my-project> && cd ~/Desktop/<my-project> && git init
Then lay the genesis spine into it:
    "$GENESIS_KIT_ROOT/tools/scaffold.sh" .
    node "$GENESIS_KIT_ROOT/tools/graphizer.mjs" . --write
Verify the spine exists: ls -la .genesis
(If .genesis already exists, do NOT overwrite it — read .genesis/checkpoints/CURRENT.md and resume instead.)

────────────────────────────────────────
STEP 5 — Run the genesis ritual (G0–G6) with me
────────────────────────────────────────
Invoke the `genesis` skill and walk me through these, filling the files as you go:
  • G0 — Ask me the 5 diagnostic questions (scope: new/extend/incident · AI
        components? · distributed? · trust boundary? · current phase). Write the
        cognitive job into .genesis/DONE.html section 1.
  • G2 — Add 2–3 invariants BY HAND to .genesis/context-graph.json — the health
        rules that define "not broken" for my project (e.g. "domain never imports
        framework", "every outbound call has a timeout").
  • G3 — Seed .genesis/wiki/index.md with pointers to the agentic-swe-kit concept
        pages my project touches.
  • G4 — Fill .genesis/DONE.html section 2: the definition of done, copied from
        the phase "Gate:" lines.
  • G5 — Slice .genesis/PLAN.md into milestones. EVERY milestone needs one exact
        demo command that proves it works. If you can't write the demo command,
        the milestone is too vague — split it.
  • G6 — Fill .genesis/KICKOFF.md, then show me the "Genesis output checklist" at
        the bottom of .genesis/genesis.md and confirm every box is true.

────────────────────────────────────────
STEP 6 — Tell me what to do next
────────────────────────────────────────
When the checklist is all-true, print a short "You're ready" summary and tell me:
  1. Pick milestone M1 and run G0 Existence Pre-Flight (is it already built?).
  2. Start the BUILD loop. Drive it with my agent's loop/goal command, e.g.
     /goal "M1 done — the M1 demo command passes and L4 VERIFY approves".
  3. Every iteration must pass the 5 gates (G1 Skill, G2 Progress, G3 Cost,
     G4 Quality, G5 Verify) — gates are computed (run the command, paste the
     result), never narrated.
  4. Run L4 VERIFY as a SEPARATE session/model — the maker never grades itself.
  5. To resume later in a cold session, paste .genesis/KICKOFF.md.

RULES THE WHOLE TIME: never overwrite an existing .genesis/. Gates are computed,
not narrated. Never mark a milestone done without a separate L4 VERIFY approval.
Never edit DONE.html or PLAN.md without asking me first.
````

---

## Start a project (the ritual)

```bash
cd <your-project>
$GENESIS_KIT_ROOT/tools/scaffold.sh .
# ↳ prompts for cheap model, flagship model, router skill, budget, max iters
# press Enter to accept defaults (haiku driver / opus checker / coding-orchestrator)
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

## What's in the spine (features)

### G0.5 — Brainstorm before you build (P1)
Before slicing milestones, generate 3 fundamentally different approaches, pick one
with rationale. Lives in `PLAN.md → Brainstorm section`. Cheapest place to avoid
committing to the wrong architecture.

### Interview mode — surface unknown knowns (P2)
`.genesis/KICKOFF-INTERVIEW.md` — paste into your agent before G0. It asks you
12 questions (trade-offs, perf constraints, UX expectations, integrations, failure
modes, known unknowns) and produces `decisions/decisions-manifest.md` before a
single line of code is written. The trap is assuming the agent knows what "good"
means to you — it doesn't until you say it.

### Deviation log — institutional memory (P3)
`implementation-notes.html` has an append-only deviation table between "Decisions
that constrain" and "Known gaps". Every time the agent can't follow the plan and
pivots, it records: date · milestone · planned approach · actual approach · reason ·
invariant impact. Future sessions never wonder why the code looks different from PLAN.md.

### Quiz-me gate on L4 VERIFY (P4)
After a VERIFY APPROVE verdict, before a milestone is marked done, the verifier
asks you 3 targeted questions: one design decision, one edge case, one change impact.
If you can't answer → verdict downgrades to UNCERTAIN, milestone stays open. No
more rubber-stamp "looks good" merges.

### Model/config prompts in scaffold (P5)
`scaffold.sh` now asks for cheap model, flagship model, router skill, token budget,
and max loop iterations before laying the spine. Press Enter for defaults
(`claude-haiku-4-5` driver / `claude-opus-4-5` checker / `coding-orchestrator`).
No `{{CHEAP_MODEL}}` placeholders survive into your working files.

---



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
