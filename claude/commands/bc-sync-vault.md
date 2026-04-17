# /bc-sync-vault — Sync BrainCache Notebook to Obsidian

Pulls every notebook entry from BrainCache and writes them as individual markdown files into `ObsidianVault/wiki/` — one file per concept, with wikilinks.

---

## Steps

**1. Check BrainCache is running**

GET `http://localhost:7337/api/ollama/status`. If it fails, say: "BrainCache is not running. Start it with `docker compose up -d` from the BrainCache project directory." Stop.

**2. Fetch all notebook entries**

GET `http://localhost:7337/api/notebook` — returns all entries as JSON.

**3. For each notebook entry, write a file**

Path: `$HOME/ObsidianVault/wiki/[term].md`

Use this exact format:

```markdown
# [term]

#braincache #wiki

---

## Plain Explanation

[plain_explanation field from BrainCache]

---

## MITRE Reference

[mitre_reference field, or "None" if empty]

---

## Socratic Questions

[socratic_questions array — one bullet per question]

---

## Source

[source_article_url if present, otherwise "No source article"]

---

## Spaced Repetition

- Interval: [sr_interval] days
- Repetitions: [sr_repetitions]
- Ease Factor: [sr_ease_factor]
- Next Review: [[sr_due_date]]
- Status: [is_resolved == 1 ? "Resolved" : "Active"]

---

## Connections
- [[]]

(Add wikilinks to related concepts as you encounter them)
```

**4. Write an index**

Write `$HOME/ObsidianVault/wiki/_index.md`:

```markdown
# BrainCache Wiki Index

Last synced: [today's date]

[List every term as a wikilink, one per line, alphabetically]
- [[term1]]
- [[term2]]
...
```

**5. Report**

Say: "Synced [N] entries to `ObsidianVault/wiki/`. [N new / N updated]. Index written to `wiki/_index.md`."

---

## Notes

- If a file already exists for a term, overwrite it — BrainCache is the source of truth for these entries.
- Do not delete files in `wiki/` that aren't in BrainCache — the user may have manually added notes there.
- Wikilinks inside the Obsidian notes will automatically resolve if both files exist in the same vault.
