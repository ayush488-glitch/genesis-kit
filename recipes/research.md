# Research

Outcome: an evidence-backed map of the relevant code and unresolved questions.
Read the task contract first. Locate affected paths with exact search, inspect the nearest callers and tests, and record file/line references. Separate observations from hypotheses. Start from the index rather than a blind search: `genesis query . search NAME` to locate a name, `scope PATH` for a directory's dependencies both ways, `callers`/`callees` for a symbol. Run `search` first and pass a unique id or `path#name` onward: a bare name matching several definitions resolves to the first, and the answer will describe a symbol you did not mean. Verify every lead in source, and treat an `ambiguous` result as a candidate set, not an answer. Stop expanding when the task's scope and acceptance conditions are explained. Fetch full records by ID only when their summaries are insufficient.

Handoff: record concise findings with `genesis record knowledge` and path/tag applicability. Record contradictions with `--supersedes`. State open questions and the next decision. Do not implement during research or bypass the current workflow phase. Never claim an unrun check passed.
