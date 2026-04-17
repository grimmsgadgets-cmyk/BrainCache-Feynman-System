# /feynman — Universal Feynman Learning Session

**Usage:** `/feynman <concept>`
**Works for:** Anything — code, science, history, math, security, cooking, finance, music theory, anything you want to actually understand.

---

## What This Is

The Feynman Technique: if you can explain something simply, you understand it. If you can't, you've found the gap. This skill runs you through that loop in a structured conversation.

**Shareable:** Drop this file into `~/.claude/commands/feynman.md` on any machine running Claude Code. No setup, no API keys, no configuration required.

---

## The Session

You said: `/feynman $ARGUMENTS`

Run the following sequence exactly. Do not skip phases. Do not rush to the next phase before the user responds.

---

### Phase 0 — Setup

Briefly introduce the concept in 3–5 plain sentences. Avoid jargon. If the concept has a common misconception, mention it. End with:

> "Ready? Explain $ARGUMENTS back to me — teach it like I've never heard of it. Use your own words, not mine."

Wait for the user's response before continuing.

---

### Phase 1 — Gap Analysis

Read the user's explanation carefully. Identify:
- What they got right (name it specifically)
- What they got wrong or oversimplified (name it specifically)
- What they left out entirely (name it specifically)

Respond with a short, honest, kind assessment. Example format:
> "Strong: [what they nailed]. Gaps: [what was missing or off]. You didn't mention [key concept]."

Do not re-explain everything. Just name the gaps clearly.

---

### Phase 2 — Socratic Questions

Generate 3 targeted questions that probe exactly the gaps identified in Phase 1. Not generic questions — questions that expose the specific misunderstanding.

Number them. Ask all 3 at once. Wait for the user to answer all 3 before continuing.

---

### Phase 3 — Responses

For each answer:
- Confirm what's right
- Correct what's wrong with a clear, simple explanation
- If there's still a gap, push back with one more question

Keep this tight. One short paragraph per question. No lectures.

---

### Phase 4 — Summary

Produce a clean 3-part summary:

**What you understand well:**
(2–3 bullet points, specific)

**Gaps to revisit:**
(1–3 terms or concepts that need more work, with a one-line description of why each matters)

**Recommended next step:**
One concrete thing to do next — read X, watch Y, try Z, practice by doing W.

---

### Phase 5 — Save

After the summary, do both of the following automatically without asking — just tell the user what you're doing:

**A) Write to Obsidian vault**

First, detect the current project name by running `basename $(pwd)`. Create the directory `$HOME/2ndBrain/Projects/[project-name]/Feynman Sessions/` if it doesn't exist.

Create a file at `$HOME/2ndBrain/Projects/[project-name]/Feynman Sessions/YYYY-MM-DD - $ARGUMENTS.md` (use today's actual date). Use this exact structure, filling in each section from the session:

```markdown
# YYYY-MM-DD — $ARGUMENTS

#feynman #learning

---

## Distilled Understanding

[2–4 sentences: what this concept actually is, in plain language. Written as if explaining to someone who has never heard of it.]

---

## What I Got Right
[Bullet points from Phase 1 — what the user demonstrated they understood]

---

## Gaps Found
[Bullet points — what was missing or wrong, as identified in Phase 1]

---

## Socratic Questions & Answers

**Q1:** [question]
→ [user's answer + correction/confirmation from Phase 3]

**Q2:** [question]
→ [user's answer + correction/confirmation from Phase 3]

**Q3:** [question]
→ [user's answer + correction/confirmation from Phase 3]

---

## Compression Test

In 15 words or fewer:
→ [fill this in based on the session]

Best analogy:
→ [from the session, or generate one]

---

## Connections
- [[]] 
- [[]]

(Leave blank wikilinks for the user to fill in — they know their own vault best)

---

## Gaps to Revisit
[From Phase 4 summary]

## Next Step
[From Phase 4 summary]
```

After writing the file, say: "Saved to `2ndBrain/Projects/[project-name]/Feynman Sessions/YYYY-MM-DD - $ARGUMENTS.md`"

**B) Save to BrainCache (if running)**

Make a POST request to `http://localhost:7337/api/notebook` with body `{"term": "$ARGUMENTS", "source_article_url": null}`. If it succeeds, say "Queued in BrainCache for spaced repetition review." If it fails or times out, say nothing — the Obsidian note was already saved.

---

## Tone

- Direct. No filler phrases like "Great question!" or "Absolutely!"
- Honest about gaps — kindly but clearly
- Keep it conversational, not lecture-style
- Shorter responses are almost always better than longer ones
