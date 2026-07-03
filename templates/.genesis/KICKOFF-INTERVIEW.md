# KICKOFF-INTERVIEW — {{PROJECT_NAME}}

> Run this BEFORE G0. The agent asks YOU questions until every assumption is explicit.
> Output goes to `decisions/decisions-manifest.md`. That file is the input to G0.
>
> Paste this file into your agent and say: "Interview me. Ask one question at a time.
> Wait for my answer before the next. When done, write decisions/decisions-manifest.md."

---

## Instructions for the agent

You are NOT coding yet. Your job is to surface the human's unknown knowns before
any milestone is sliced. Ask the questions below ONE AT A TIME. Wait for the human's
answer before asking the next. Do not skip a question — if the human says "I don't
know", write that down; that's a decision too (it means you'll need a research spike).

When all questions are answered, write `decisions/decisions-manifest.md` using the
template at the bottom of this file. Then tell the human: "Interview done. Run G0
now — your cognitive job is pre-filled in decisions-manifest.md."

---

## Question bank (ask in order, skip only if clearly irrelevant)

### Trade-offs
1. Rank these four in order of importance for this project:
   speed · maintainability · cost · reliability
   (Drives almost every architecture call — don't skip this one.)

2. What's the expected scale at launch vs. in 12 months?
   (Users, requests/day, data volume — even rough orders of magnitude help.)

3. Is this a prototype, an internal tool, or a production system?
   (Changes the tolerance for tech debt significantly.)

### Non-obvious assumptions
4. Are there any performance requirements you'd immediately notice if violated?
   e.g. "dashboard must load in < 2s", "batch job must finish overnight"
   (These are classic unknown knowns — obvious to you, invisible to the agent.)

5. Are there brand or UX constraints? Any "it must feel like X" references?
   e.g. "Apple-clean", "Notion-style", "dense terminal-like"

6. What does the unhappy path look like? What should happen on failure?
   e.g. "show a friendly error", "retry silently", "alert on-call"

### Integration points
7. What existing systems does this touch?
   List every API, database, service, or CLI it needs to read from or write to.

8. Are there auth requirements? Who can do what?
   e.g. "only admins can delete", "all writes require 2FA"

9. Are there compliance or legal constraints?
   e.g. GDPR, SOC2, data residency, no PII in logs

### Risk & failure modes
10. What's the single most likely way this project fails?
    (Honest answer here is worth 10 architecture diagrams.)

11. What's the one thing you'd be embarrassed to ship?
    (Surfaces implicit quality bar — what "good enough" actually means to you.)

12. Any known unknowns? Things you know you don't know yet?
    (These become L3 RESEARCH spikes before M1 starts.)

---

## decisions-manifest.md template (write this when interview is done)

```markdown
# decisions-manifest — {{PROJECT_NAME}}
Generated: {{DATE}} via KICKOFF-INTERVIEW.md

## Trade-off ranking
1. {{PRIORITY_1}}
2. {{PRIORITY_2}}
3. {{PRIORITY_3}}
4. {{PRIORITY_4}}

## Scale
Launch: {{SCALE_LAUNCH}}
12 months: {{SCALE_12MO}}

## Project type
{{PROJECT_TYPE}}  <!-- prototype / internal / production -->

## Performance constraints (non-negotiable)
- {{PERF_1}}
- {{PERF_2}}

## UX / brand constraints
{{UX_CONSTRAINTS}}

## Failure behaviour
{{FAILURE_BEHAVIOUR}}

## Integration points
{{INTEGRATIONS}}

## Auth requirements
{{AUTH}}

## Compliance constraints
{{COMPLIANCE}}

## Primary failure mode (the honest one)
{{FAILURE_MODE}}

## Quality bar ("embarrassed to ship if...")
{{QUALITY_BAR}}

## Known unknowns → research spikes needed
- {{UNKNOWN_1}}
- {{UNKNOWN_2}}

## Assumptions never stated aloud (agent-inferred from answers above)
<!-- Agent fills this: list 3-5 implicit assumptions it drew from the answers. -->
- {{ASSUMPTION_1}}
- {{ASSUMPTION_2}}
- {{ASSUMPTION_3}}
```
