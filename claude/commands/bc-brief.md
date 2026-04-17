# /bc-brief — BrainCache Morning Context

Surfaces your BrainCache learning state at the start of a session so you know what's waiting before you start coding.

---

## Steps

1. **Check BrainCache is running** — make a GET request to `http://localhost:7337/api/ollama/status`. If it fails, say "BrainCache is not running — start it with `docker compose up -d` from the project directory" and stop.

2. **Fetch morning brief** — GET `http://localhost:7337/api/morning-brief`. Display:
   - New unread articles (title, source name)
   - Due spaced repetition review count
   - Last session info (article title, when)

3. **Fetch SR queue** — GET `http://localhost:7337/api/notebook/due`. If `due_count > 0`, list the overdue terms and say: "You have [N] notebook entries due for review. Run `/feynman <term>` to work through them, or open BrainCache at localhost:7337 to use the built-in review mode."

4. **Suggest a session** — If there are new articles, pick the first one and say: "Suggested reading: [title] from [source]. Open a Feynman session at localhost:7337 or run `/feynman` after reading it."

5. **End** — One-line summary: "[N] new articles, [N] reviews due." Then hand back to the user.

---

## Tone

Short, functional, no filler. This runs at the top of a session — get in and out in under 30 seconds of reading.
