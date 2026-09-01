# Agent adapters

Genesis state is agent-agnostic. Codex and Claude Code use the same repository contract and CLI.

| Need | Codex | Claude Code |
|---|---|---|
| Load policy | invoke installed `ponytail` and `genesis` skills | invoke installed `ponytail` and `genesis` skills |
| Resume | read `.genesis/KICKOFF.md` | read `.genesis/KICKOFF.md` |
| Connect repository | `genesis agent connect . --codex --write` | `genesis agent connect . --claude --write` |
| Run Genesis | `genesis …` or `node <kit>/tools/genesis.mjs …` | `genesis …` or `node <kit>/tools/genesis.mjs …` |
| Independent check | fresh context or another agent; record human approval for manual proof | fresh context or another agent; record human approval for manual proof |
| Parallel writing | isolated git worktree with declared file ownership | isolated git worktree with declared file ownership |

Other agents need only be able to read JSON/Markdown, run shell commands, and follow the contract in `.genesis/KICKOFF.md`. Add an adapter only after a real incompatibility is observed.
