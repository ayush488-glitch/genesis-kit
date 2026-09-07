# Phase briefs

Use `genesis brief .` for a bounded packet and a guide selected from the current phase. Choose a guide explicitly with `--stage research|plan|implement|verify|recover`; the actual workflow instruction remains in the packet and takes precedence over an incompatible requested stage.

| Guide | Output |
| --- | --- |
| [Research](research.md) | Verified code map, source references and open questions |
| [Plan](plan.md) | Bounded tasks, observable acceptance and review requirements |
| [Implement](implement.md) | Minimal active-slice change and current evidence |
| [Verify](verify.md) | Independent checks of actual behavior, with limitations |
| [Recover](recover.md) | Reconciled attempt and explicit safe next action |

These are original, host-neutral workflow guides. They do not invoke a model or transfer the capability of a stronger model into a weaker one. They expose scope, evidence and next actions so any capable host can follow the same contract. To assess a smaller model, measure accepted outcomes and interventions on the same tasks with and without the guides.

Research–plan–implement and deliberate context compaction are useful reference patterns in [HumanLayer's context-engineering work](https://www.humanlayer.dev/blog/advanced-context-engineering). Genesis combines short guides with its own repository state, executable completion contract and explicit promotion path. These recipes do not copy HumanLayer's prompts or require its product.
