# /learn-from-session — Extract Learning from This Conversation

Run this at the end of any session. Scans the conversation for concepts you encountered but may not fully understand, then queues them for Feynman review.

---

## Steps

**1. Scan the conversation**

Look back through this session for:
- Terms, libraries, patterns, or concepts that were used but not deeply explained
- Things that had to be looked up, errors not initially understood, concepts introduced without definition
- Any moment where the explanation was "just do X" without explaining why
- **Architectural decisions** — why was something structured a certain way? (e.g. "why does db.py exist separately from main.py?")
- **Best practices** that appeared — parameterized queries, separation of concerns, error handling patterns, indexing, timeouts
- **Security concepts** — any time something was done to prevent an attack or vulnerability
- **Named patterns** — foreign keys, race conditions, event loops, WebSockets, spaced repetition, any named thing
- **"Why" questions** the user might have but didn't ask — surface those proactively

**2. Build a candidate list**

List 3–7 concepts worth understanding more deeply. For each one, write one sentence on *why it matters* — not what it is, but why deep understanding of it would make you more capable.

```
1. [concept] — [why it matters to understand deeply]
2. ...
```

**3. Present and default to now**

Present the list, then ask ONE question:

> "Ready to work through these now? Say **now** to start immediately, **later** to save them as stubs for next session, or pick numbers (e.g. '1, 3') to do a subset now."

Default assumption is **now**. If the user says nothing unexpected, start Feynman immediately.

**4. For each concept the user wants to cover — run Feynman inline**

Do not ask again per concept. Just start.

Run the full `/feynman` flow inline for each concept in sequence:
- Phase 0: brief intro + ask them to explain it back
- Phase 1: gap analysis
- Phase 2: socratic questions
- Phase 3: responses
- Phase 4: summary
- Phase 5: save to `2ndBrain/Feynman Sessions/YYYY-MM-DD - [concept].md` AND post to BrainCache if running

After each concept completes, say: "Saved. Moving to [next concept]..." and continue.

**5. For concepts the user defers ("later")**

Detect the current project name by running `basename $(pwd)`. Create `$HOME/2ndBrain/Projects/[project-name]/Feynman Sessions/` if it doesn't exist.

Write a stub note to `$HOME/2ndBrain/Projects/[project-name]/Feynman Sessions/[concept] - TO REVIEW.md`:

```markdown
# [concept] — To Review

#feynman #queued

Encountered during a session on: [today's date]
Context: [one sentence on why it came up in this session]

---

*This note will be picked up automatically at the next session start.*
```

Also POST to BrainCache if running.

**6. End**

Say: "Done — [N] Feynman sessions completed, [N] saved to `2ndBrain/Projects/[project-name]/`. [N] deferred to next session."

---

## Tone

Efficient. The user just finished a session — don't make this a lecture. The goal is to capture what slipped past and make sure it doesn't stay that way.
