# BrainCache Feynman Learning System

A local, privacy-first learning system that combines the Feynman Technique, spaced repetition, and AI-assisted Socratic questioning. Everything runs on your machine — no API keys, no accounts, no cloud services.

See `WORKFLOW.md` for a full description of how the system works before you set it up.

---

## What You're Setting Up

Three interconnected pieces:

1. **BrainCache** — A Docker app at `localhost:7337` that fetches articles, runs Feynman sessions, and manages a spaced repetition notebook using a local LLM (Ollama)
2. **Claude Code slash commands** — Four commands that connect Claude Code to BrainCache and your Obsidian vault
3. **Obsidian vault** — A `ObsidianVault/` folder where all your learning notes live

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

BrainCache is a separate project. Clone and start it first, then come back here to wire up the Claude Code integration.

**Repo:** [https://github.com/grimmsgadgets-cmyk/BrainCache](https://github.com/grimmsgadgets-cmyk/BrainCache)

```bash
git clone https://github.com/grimmsgadgets-cmyk/BrainCache
cd BrainCache
cp .env.example .env
docker compose up --build
```

Open `http://localhost:7337`. On first run, Ollama downloads the default model (~2 GB). The UI shows a red indicator until it's ready — typically 5–15 minutes.

Once the indicator turns green, add your first sources on the **Sources** tab and you're ready to continue.

---

## Part 2 — Set Up the Obsidian Vault

### 1. Choose your vault name

The commands use `ObsidianVault` as a placeholder. Replace it with whatever you want to call your vault folder — or use an existing vault name if you already have one.

```bash
VAULT=MyVault   # change this to whatever you want
```

If you already have an Obsidian vault, set `VAULT` to match its folder name exactly.

### 2. Create the vault structure

```bash
mkdir -p ~/$VAULT/Projects
mkdir -p ~/$VAULT/wiki
mkdir -p ~/$VAULT/Templates
mkdir -p ~/$VAULT/"Feynman Sessions"
```

### 3. Copy the Obsidian template

```bash
cp obsidian/Templates/"Daily Learning Template.md" ~/$VAULT/Templates/
```

### 4. Update the vault name in the Claude commands

The commands have `ObsidianVault` hardcoded — replace it with the name you chose:

```bash
for f in ~/.claude/commands/feynman.md ~/.claude/commands/learn-from-session.md ~/.claude/commands/bc-sync-vault.md; do
  sed -i "s|ObsidianVault|$VAULT|g" "$f"
done
```

### 5. Open in Obsidian

Open Obsidian → Open folder as vault → select `~/$VAULT`.

**Recommended plugin:**
[Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) — enables Claude Code to write directly into your vault. Install via Community Plugins in Obsidian settings.

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

### 2. Path setup

`$HOME` resolves automatically — no changes needed there. The vault name substitution is handled in Part 2 Step 4 above. If you skipped that step, go back and run it before continuing.

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

Claude should walk you through a 5-phase Feynman session and save a note to `~/ObsidianVault/Projects/[project-name]/Feynman Sessions/`.

### 3. Test the morning brief

```
/bc-brief
```

Claude should report new articles and spaced repetition reviews due today. (Requires BrainCache running.)

### 4. Test the vault sync

```
/bc-sync-vault
```

Claude should pull all notebook entries into `~/ObsidianVault/wiki/` as individual markdown files.

### 5. Test the auto-learn hook

Run a substantive session with 8+ tool calls, then end it. Claude should automatically offer to run `/learn-from-session` before closing.

---

## Folder Structure After Setup

```
~/
├── ObsidianVault/                          ← Obsidian vault
│   ├── Projects/
│   │   └── [project-name]/
│   │       └── Feynman Sessions/      ← /feynman saves here
│   ├── wiki/                          ← /bc-sync-vault writes here
│   └── Templates/
│       └── Daily Learning Template.md
│
├── BrainCache/                        ← separate repo (github.com/grimmsgadgets-cmyk/BrainCache)
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
Check that the `ObsidianVault/Projects/` path exists and that the path in `feynman.md` matches your actual home directory.

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

`BrainCache/config.yaml` — BrainCache runtime settings (model, poll interval, TTS/STT paths). See the [BrainCache repo](https://github.com/grimmsgadgets-cmyk/BrainCache) for full config reference.

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
│  Obsidian (ObsidianVault vault)      │
│  Projects/, wiki/, Templates/   │
└─────────────────────────────────┘
```

No data leaves your machine. No API keys. No accounts. No telemetry.
