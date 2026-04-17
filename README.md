# BrainCache Feynman Learning System

A local, privacy-first learning system that combines the Feynman Technique, spaced repetition, and AI-assisted Socratic questioning. Everything runs on your machine — no API keys, no accounts, no cloud services.

See `WORKFLOW.md` for a full description of how the system works before you set it up.

---

## What You're Setting Up

Three interconnected pieces:

1. **BrainCache** — A Docker app at `localhost:7337` that fetches articles, runs Feynman sessions, and manages a spaced repetition notebook using a local LLM (Ollama)
2. **Claude Code slash commands** — Four commands that connect Claude Code to BrainCache and your Obsidian vault
3. **Obsidian vault** — A `2ndBrain/` folder where all your learning notes live

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Claude Code](https://claude.ai/code) CLI installed and authenticated
- [Obsidian](https://obsidian.md/) (free desktop app)
- Linux, macOS, or Windows with WSL2
- 8 GB RAM minimum, 16 GB recommended
- ~5 GB free disk space (Ollama model + app)

---

## Part 1 — Set Up BrainCache

### 1. Clone or copy the app

The `braincache-app/` folder in this repo contains the full application source. Copy it somewhere permanent on your machine:

```bash
cp -r braincache-app/ ~/BrainCache
cd ~/BrainCache
```

Or if you're working from this export folder directly:

```bash
cd braincache-app/
```

### 2. Configure environment

```bash
cp .env.example .env
```

The only setting in `.env` is the Ollama model. The default (`llama3.2`) is a good starting point. Options:

| Model | Notes |
|-------|-------|
| `llama3.2` | Default. Good balance of quality and speed. |
| `mistral` | Faster, slightly smaller context window. |
| `phi3` | Fastest. For hardware with less than 8 GB RAM. |
| `llama3.1` | Highest quality. ~5 GB download. |

### 3. Start BrainCache

```bash
docker compose up --build
```

On first run, Ollama downloads the model (~2 GB for llama3.2). The UI shows a red indicator until the download completes — typically 5–15 minutes. Open `http://localhost:7337` to follow progress.

### 4. Add sources

In BrainCache at `localhost:7337`:
- Go to the **Sources** tab
- Add RSS feeds or scrape targets
- Click **Poll All Sources** to fetch your first articles

---

## Part 2 — Set Up the Obsidian Vault

### 1. Create the vault structure

Create your vault folder (or use an existing one):

```bash
mkdir -p ~/2ndBrain/Projects
mkdir -p ~/2ndBrain/wiki
mkdir -p ~/2ndBrain/Templates
mkdir -p ~/2ndBrain/raw
mkdir -p ~/2ndBrain/"Feynman Sessions"
```

### 2. Copy the Obsidian template

```bash
cp obsidian/Templates/"Daily Learning Template.md" ~/2ndBrain/Templates/
```

### 3. Open in Obsidian

Open Obsidian → Open folder as vault → select `~/2ndBrain/`.

**Recommended plugins:**
- [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) — enables Claude Code to write directly into your vault. Install via Community Plugins in Obsidian settings, then enable it.

---

## Part 3 — Set Up Claude Code Commands

### 1. Copy the slash commands

```bash
mkdir -p ~/.claude/commands
cp claude/commands/feynman.md ~/.claude/commands/
cp claude/commands/bc-brief.md ~/.claude/commands/
cp claude/commands/bc-sync-vault.md ~/.claude/commands/
cp claude/commands/learn-from-session.md ~/.claude/commands/
```

### 2. No path changes needed

The commands use `$HOME` which resolves automatically to your home directory. Nothing to edit.

### 3. Set up the auto-learn hook

The auto-learn hook fires after substantive Claude Code sessions and automatically triggers `/learn-from-session`. This is what makes the system self-closing.

```bash
mkdir -p ~/.claude/hooks
cp claude/hooks/auto-learn.sh ~/.claude/hooks/
chmod +x ~/.claude/hooks/auto-learn.sh
```

Update the hook script path if needed:
```bash
# The hook itself doesn't need path changes — it reads from Claude's session files
# which are always in ~/.claude/projects/
```

### 4. Configure Claude Code settings

Claude Code reads settings from `~/.claude/settings.json`. You need to register the hook there.

If you don't have a settings file yet:
```bash
cp claude/settings-template.json ~/.claude/settings.json
```

If you already have a `~/.claude/settings.json`, add the hook entry manually inside the `"hooks"` object:

```json
"Stop": [
  {
    "hooks": [
      {
        "type": "command",
        "command": "python3 $HOME/.claude/hooks/auto-learn.sh",
        "timeout": 10,
        "statusMessage": "Checking for learning opportunities..."
      }
    ]
  }
]
```

---

## Part 4 — Verify Everything Works

### 1. Test BrainCache

```bash
curl http://localhost:7337/api/ollama/status
# Should return: {"ready": true, "model": "llama3.2", ...}
```

### 2. Test the Feynman command

Open a Claude Code session from any project directory:

```
/feynman TCP handshake
```

Claude should walk you through a 5-phase Feynman session and save a note to `~/2ndBrain/Projects/[project-name]/Feynman Sessions/`.

### 3. Test the morning brief

```
/bc-brief
```

Claude should report new articles and spaced repetition reviews due today. (Requires BrainCache running.)

### 4. Test the vault sync

```
/bc-sync-vault
```

Claude should pull all notebook entries into `~/2ndBrain/wiki/` as individual markdown files.

### 5. Test the auto-learn hook

Run a substantive session with 8+ tool calls, then end it. Claude should automatically offer to run `/learn-from-session` before closing.

---

## Folder Structure After Setup

```
~/
├── 2ndBrain/                          ← Obsidian vault
│   ├── Projects/
│   │   └── [project-name]/
│   │       └── Feynman Sessions/      ← /feynman saves here
│   ├── wiki/                          ← /bc-sync-vault writes here
│   └── Templates/
│       └── Daily Learning Template.md
│
├── BrainCache/                        ← Docker app
│   ├── docker-compose.yml
│   ├── .env
│   └── ...
│
└── .claude/
    ├── commands/
    │   ├── feynman.md
    │   ├── bc-brief.md
    │   ├── bc-sync-vault.md
    │   └── learn-from-session.md
    ├── hooks/
    │   └── auto-learn.sh
    └── settings.json
```

---

## Daily Use

**Start of session:** `/bc-brief` — see what's new and what's due for review.

**During coding:** Claude explains decisions and flags concepts you may not know. These become Feynman candidates.

**End of session:** Auto-learn hook fires if the session was substantive. Or run `/learn-from-session` manually.

**Standalone learning:** `/feynman <anything>` — works for any topic, not just code or security.

**Weekly:** `/bc-sync-vault` to pull your BrainCache notebook into Obsidian as wikilinked notes.

---

## Troubleshooting

**BrainCache not running**
```bash
cd ~/BrainCache && docker compose up -d
```

**Feynman command can't save notes**
Check that the `2ndBrain/Projects/` path exists and that the path in `feynman.md` matches your actual home directory.

**Auto-learn hook not firing**
Check `~/.claude/settings.json` has the correct hook path and that `auto-learn.sh` is executable (`chmod +x`).

**Voice not working in BrainCache**
```bash
sudo usermod -aG audio $USER
# Log out and back in
```

**Model download stalled**
```bash
docker compose logs ollama
```
The first pull can take 5–15 minutes. The indicator in the UI turns green when ready.

---

## Configuration Reference

`braincache-app/config.yaml` — BrainCache runtime settings (model, poll interval, TTS/STT paths)

`braincache-app/.env` — Ollama model selection

`~/.claude/settings.json` — Claude Code hook registration

---

## Architecture

```
┌─────────────────────────────────┐   ┌──────────────────────┐
│  BrainCache (port 7337)         │   │  Ollama (port 11434) │
│  FastAPI                        │◄──►  Local LLM           │
│  Piper TTS                      │   │  (llama3.2 default)  │
│  whisper.cpp STT                │   │                      │
│  SQLite                         │   │                      │
└─────────────────────────────────┘   └──────────────────────┘
         │ API calls
         ▼
┌─────────────────────────────────┐
│  Claude Code (your terminal)    │
│  /feynman, /bc-brief, etc.      │
└─────────────────────────────────┘
         │ writes markdown
         ▼
┌─────────────────────────────────┐
│  Obsidian (2ndBrain vault)      │
│  Projects/, wiki/, Templates/   │
└─────────────────────────────────┘
```

No data leaves your machine. No API keys. No accounts. No telemetry.
