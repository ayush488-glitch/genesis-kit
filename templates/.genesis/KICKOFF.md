# KICKOFF — paste this to start or resume a {{PROJECT_NAME}} session cold

> Works in any agent. Replace the skill-invocation syntax per `AGENT-ADAPTERS.md`
> (Hermes `skill_view(name=…)` · Claude Code `Skill`/`/x` · Codex `$x`). The rest is identical.

```
Load skills (skill canon — always):
- agentic-swe-master          (orchestrator — routes everything)
- {{ROUTER_SKILL}}            (route before any code)
- modular-architecture, production-readiness
- if frontend milestone: the design-system skill (MANDATORY)

Read in order:
- AGENTS.md / CLAUDE.md                       (repo governance)
- .genesis/DONE.html                          (locked spec + definition of done + plan)
- .genesis/PLAN.md                            (milestones being executed)
- .genesis/wiki/index.md                      (then drill into pages matching the milestone's nouns)
- .genesis/implementation-notes.html          (search for the milestone's nouns — what's LIVE now)
- .genesis/LOOPS.md                           (how the work gets done)
- .genesis/checkpoints/CURRENT.md             (where we are, if it exists)

Then:
1. Pick the next unstarted milestone (or resume from CURRENT.md).
2. Run G0 EXISTENCE PRE-FLIGHT first. Verdict UNBUILT → continue. PARTIAL → revise scope.
   BUILT → halt and surface the existing artifact.
3. Run L1 BUILD per LOOPS.md exactly. Enforce G0 + all 5 gates (G1 Skill, G2 Progress,
   G3 Cost, G4 Quality, G5 Verify). Gates are COMPUTED (run the command, paste exit code), not narrated.
4. Checkpoint every iteration to .genesis/checkpoints/<milestone-id>.md.
5. Spawn L2 DEBUG / L3 RESEARCH as needed. Exit through L4 VERIFY (separate model, fresh context).
6. On milestone done: update CURRENT.md, append a row to implementation-notes.html "what's live",
   append progress to PLAN.md.

Stop rules: if any gate fails 3 times, stop, write what you tried to CURRENT.md, surface to the user.
Never mark a milestone done without L4 VERIFY APPROVE. Never edit DONE.html / PLAN.md without being asked.
```
