# AGENT-ADAPTERS.md — one spine, any agent

The Genesis spine (`.genesis/` + `wiki/`) is **plain markdown + JSON + HTML**. Every agent can read and
write those. What differs between agents is only four verbs. This table is the single place that
difference lives — `LOOPS.md`, `KICKOFF.md`, and `genesis.md` all reference these verbs abstractly and
point here for the concrete form.

| Capability (abstract) | Hermes | Claude Code | Codex | Any other agent |
|---|---|---|---|---|
| **Invoke a skill** | `skill_view(name='X')` | `Skill` tool, or `/X`, or auto from `.claude/skills/X/SKILL.md` | `$X` / `/skills`, or `.codex/` prompt include | paste the skill's `SKILL.md` body into context |
| **Run a loop on a cadence** | Hermes automation / scheduled prompt | `/loop <interval> <prompt>` | Automations tab | external cron calling the agent CLI with `KICKOFF.md` |
| **Run until a goal/stop-condition holds** | manual re-prompt w/ checker step | `/goal "<DONE.html milestone all-checked>"` | `/goal` | wrap CLI in a `while`-loop that greps `CURRENT.md` |
| **Spawn a sub-agent (maker/checker split)** | Hermes sub-agent | `Agent` tool, or `.claude/agents/*.md`, or a dynamic **Workflow** | `.codex/agents/*.toml` | second CLI process with a fresh, trimmed context |
| **Isolate parallel work** | `git worktree` | `--worktree` flag / `isolation: worktree` on a subagent | built-in worktrees | `git worktree add` by hand |
| **Skill install dir** | `~/.hermes/skills/` | `~/.claude/skills/` (or project `.claude/skills/`) | `~/.codex/skills/` (or prompt files) | any dir on the skill resolution path |

## Skill resolution order (set in LOOPS.md → Operating Mode)
Default precedence, first match wins:
```
1. <agent home>/skills/            (installed global skills — swe-kit lands here)
2. ~/Desktop/skills-directory/skills/   (cognitive skills: detective, verify, scout, …)
3. <repo>/.genesis/skills/         (project-local skill overrides, if any)
```

## The maker/checker split is the load-bearing portability rule
L4 VERIFY must run as a **separate context from the maker** — a different model where possible, otherwise
a fresh session that sees only `{goal, spec, artifact, invariants}` and none of the build trail. Every
agent above can do this; only the spawning syntax differs. If your agent truly cannot spawn a second
context, run L4 as a clean new session after `/clear` and feed it `KICKOFF.md` + the diff.

## What is NOT portable (and we don't rely on)
- Agent-specific memory features — we use `.genesis/` on disk instead, so state survives any agent.
- Provider-specific tool schemas — skills are written as plain instructions, not tool bindings.
- IDE plugins — the spine is files; any editor or terminal works.
