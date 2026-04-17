# BrainCache + Feynman Learning System — Workflow

This document describes how the full learning loop works so you understand what you're setting up before you set it up.

---

## The Core Idea

Passive reading doesn't build durable knowledge. This system forces active engagement using the Feynman Technique: you don't understand something until you can explain it plainly without jargon. Every piece of this workflow exists to create that forcing function.

---

## The Three Layers

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: BrainCache (the app)                          │
│  Docker container running locally at localhost:7337     │
│  - Fetches articles from RSS feeds and scrape sources   │
│  - Runs a Feynman session for each article              │
│  - Adds unknown terms to a spaced repetition notebook   │
│  - Tracks your learning with SM-2 scheduling            │
└─────────────────────────────────────────────────────────┘
           │ API at http://localhost:7337
           ▼
┌─────────────────────────────────────────────────────────┐
│  Layer 2: Claude Code (the AI assistant)                │
│  Slash commands that connect Claude to BrainCache       │
│  and your Obsidian vault                                │
│                                                         │
│  /feynman <concept>     — run a Feynman session on      │
│                           anything, save to vault       │
│  /bc-brief              — morning status: what's new,   │
│                           what's due for review         │
│  /bc-sync-vault         — pull notebook into Obsidian   │
│  /learn-from-session    — extract concepts from this    │
│                           session, queue for Feynman    │
└─────────────────────────────────────────────────────────┘
           │ writes markdown
           ▼
┌─────────────────────────────────────────────────────────┐
│  Layer 3: Obsidian (the knowledge vault)                │
│  2ndBrain/ — all learning notes live here               │
│                                                         │
│  Projects/[name]/Feynman Sessions/  — Feynman notes     │
│  wiki/                              — BrainCache terms  │
│  Templates/                         — Daily template    │
└─────────────────────────────────────────────────────────┘
```

---

## A Typical Learning Session

### Morning Start
1. Open a Claude Code session from your project directory
2. Run `/bc-brief` — Claude checks BrainCache and tells you:
   - How many new articles are waiting
   - How many spaced repetition reviews are due today
   - What your last session was on
3. You open BrainCache at `localhost:7337` to read articles, or you start coding

### During a Session (Claude Code)
- You work on your project with Claude
- Claude explains decisions, names patterns, flags things you may not know
- Concepts that come up naturally are surfaced as learning candidates

### End of Session
- The `auto-learn` hook fires automatically when Claude Code stops (if the session had 8+ tool calls)
- It triggers `/learn-from-session` which scans the conversation and extracts concepts you encountered but may not fully understand
- You choose: work through them now (Feynman inline) or defer to a stub note in Obsidian

### Standalone Feynman Session
- Run `/feynman <concept>` on anything — code, security, history, math, cooking
- Claude runs the full 5-phase session:
  - Phase 0: Brief intro, then asks you to explain it back
  - Phase 1: Gap analysis — what you got right, what you got wrong, what you missed
  - Phase 2: 3 targeted Socratic questions on your specific gaps
  - Phase 3: Pushback and corrections per answer
  - Phase 4: Summary — what you know, what to revisit, what to do next
  - Phase 5: Save to Obsidian + queue in BrainCache for spaced repetition

### Spaced Repetition Review
- BrainCache tracks every notebook entry using the SM-2 algorithm (the same algorithm Anki uses)
- Entries have intervals that grow as you successfully recall them
- `/bc-brief` surfaces what's due each day
- You can also review directly at `localhost:7337` using the built-in review mode

### Syncing to Obsidian
- Run `/bc-sync-vault` to pull every BrainCache notebook entry into `2ndBrain/wiki/`
- Each term gets its own file with wikilinks, spaced repetition stats, and MITRE ATT&CK references if applicable
- An index file at `wiki/_index.md` lists everything alphabetically

---

## The Auto-Learn Hook

When Claude Code stops a session, the hook at `~/.claude/hooks/auto-learn.sh` fires.

It counts tool calls in the session transcript. If there were 8 or more, it emits `/learn-from-session` as a command — meaning Claude starts scanning the conversation and extracting learning candidates before you close the terminal.

This is what makes the system self-closing: you don't have to remember to extract learning. The workflow does it for you.

---

## What BrainCache Stores

Every term you encounter gets a structured notebook entry:
- **Hypothesis prompt** — what do you think this means before learning?
- **Plain explanation** — no jargon, generated by local Ollama (no cloud)
- **MITRE ATT&CK reference** — if the term is a cybersecurity technique
- **3 Socratic questions** — for review sessions
- **Resolution target** — the exact sentence you must be able to say clearly to mark it resolved
- **Spaced repetition data** — interval, ease factor, next review date

---

## What Claude Code Stores

Each Feynman session creates a structured note in Obsidian:

```
2ndBrain/Projects/[project-name]/Feynman Sessions/YYYY-MM-DD - [concept].md
```

The note includes: distilled understanding, what you got right, gaps found, the Q&A from the Socratic session, a 15-word compression test, an analogy, and blank wikilinks for you to connect to related concepts.

---

## Privacy

Everything is local. BrainCache uses Ollama for all AI inference — no API keys, no cloud services, no telemetry. Your notes go to your Obsidian vault on your machine. Claude Code runs locally. Nothing leaves your system.
