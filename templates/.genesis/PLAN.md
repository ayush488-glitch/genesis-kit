# PLAN — {{PROJECT_NAME}}

The machine-parseable implementation plan. Mirrors the milestone table in `DONE.html` (DONE.html is the
human/visual view; this is the one loops read). Sliced so each milestone ships in one L1 BUILD pass.

> Slicing rule: a milestone must have (a) a single clear outcome, (b) an exact **demo command** that
> proves it, and (c) a freeze boundary of files it may touch. If you can't write the demo command,
> the milestone is too vague — split it.

---

## Brainstorm (G0.5 — fill before slicing milestones)

> Three fundamentally different approaches to the cognitive job. Pick one. Record the rationale.
> This is the cheapest design decision — you haven't written a line of code yet.

### Approach A — {{APPROACH_A_NAME}}
{{APPROACH_A_DESCRIPTION}}
- Strengths: {{APPROACH_A_STRENGTHS}}
- Weaknesses: {{APPROACH_A_WEAKNESSES}}

### Approach B — {{APPROACH_B_NAME}}
{{APPROACH_B_DESCRIPTION}}
- Strengths: {{APPROACH_B_STRENGTHS}}
- Weaknesses: {{APPROACH_B_WEAKNESSES}}

### Approach C — {{APPROACH_C_NAME}}
{{APPROACH_C_DESCRIPTION}}
- Strengths: {{APPROACH_C_STRENGTHS}}
- Weaknesses: {{APPROACH_C_WEAKNESSES}}

### Chosen: {{CHOSEN_APPROACH}} — {{CHOSEN_RATIONALE}}

---

## Milestones

### M1 — {{M1_NAME}}
- **Outcome:** {{M1_OUTCOME}}
- **Phase (swe-master):** {{M1_PHASE}}
- **Files / freeze boundary:** `{{M1_FILES}}`
- **Demo command:** `{{M1_DEMO}}`
- **Success criteria:** {{M1_SUCCESS}}
- **Loops:** L1, L4
- **Skills:** canon + tdd + {{M1_SKILLS}}
- **Token budget:** {{MILESTONE_BUDGET}}

### M2 — {{M2_NAME}}
- **Outcome:** {{M2_OUTCOME}}
- **Phase:** {{M2_PHASE}}
- **Files:** `{{M2_FILES}}`
- **Demo command:** `{{M2_DEMO}}`
- **Success criteria:** {{M2_SUCCESS}}
- **Loops:** L1, L3 (research), L4
- **Skills:** canon + tdd + {{M2_SKILLS}}
- **Token budget:** {{MILESTONE_BUDGET}}

<!-- duplicate the block per milestone -->

---

## Progress (loops append here on milestone completion — newest last)

- _(none yet — first loop fills this)_
