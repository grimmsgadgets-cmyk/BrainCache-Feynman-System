#!/usr/bin/env python3
"""
Stop hook: auto-trigger /learn-from-session after substantive sessions.
Fires once per session. Skips quick/trivial sessions (< 8 tool calls).
"""
import sys, json, os, glob

try:
    data = json.loads(sys.stdin.read())
except Exception:
    print("auto-learn: could not parse stdin", file=sys.stderr)
    sys.exit(0)

session_id = data.get("session_id", "")
if not session_id:
    print("auto-learn: no session_id in hook data", file=sys.stderr)
    sys.exit(0)

# One-shot per session — don't loop
flag = f"/tmp/lfs-done-{session_id}"
if os.path.exists(flag):
    print(f"auto-learn: already ran for session {session_id[:8]}", file=sys.stderr)
    sys.exit(0)

# Find this session's transcript
pattern = os.path.expanduser(f"~/.claude/projects/**/{session_id}.jsonl")
files = glob.glob(pattern, recursive=True)
if not files:
    print(f"auto-learn: transcript not found for session {session_id[:8]}", file=sys.stderr)
    sys.exit(0)

# Count tool calls — only fire for substantive sessions
tool_call_count = 0
try:
    with open(files[0]) as f:
        for line in f:
            try:
                obj = json.loads(line)
                msg = obj.get("message", {})
                if msg.get("role") == "assistant":
                    for block in msg.get("content", []):
                        if isinstance(block, dict) and block.get("type") == "tool_use":
                            tool_call_count += 1
            except Exception:
                pass
except Exception as e:
    print(f"auto-learn: error reading transcript: {e}", file=sys.stderr)
    sys.exit(0)

if tool_call_count >= 8:
    open(flag, "w").close()
    print("/learn-from-session")
    sys.exit(2)

print(f"auto-learn: session too short ({tool_call_count} tool calls, need 8)", file=sys.stderr)
sys.exit(0)
