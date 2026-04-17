"""
main.py — FastAPI application entry point for BrainCache.
Stage 1: sources CRUD, manual polling, article feed,
Ollama status check.
"""

import asyncio
import io
import logging
import os
import re
import shlex
import tempfile
import uuid
import zipfile
from contextlib import asynccontextmanager
from typing import Optional

import yaml
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from fastapi import FastAPI, File, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import db
import scraper
import ollama_client
import session as session_module
import notebook as notebook_module
import tts
import stt

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Config loading
# ---------------------------------------------------------------------------

def _load_config() -> dict:
    config_path = os.path.join(os.path.dirname(__file__), "config.yaml")
    with open(config_path, "r") as f:
        raw = yaml.safe_load(f)
    # Expand env vars in all string values
    expanded = {}
    for k, v in raw.items():
        expanded[k] = os.path.expandvars(v) if isinstance(v, str) else v
    return expanded


_CONFIG = _load_config()
DB_PATH: str = _CONFIG["db_path"]


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db(DB_PATH)
    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, ollama_client.pull_model_if_needed)
    logger.info("BrainCache startup complete — DB: %s", DB_PATH)

    scheduler = AsyncIOScheduler()
    poll_hours = int(_CONFIG.get("poll_interval_hours", 6))
    scheduler.add_job(
        scheduled_poll,
        trigger=IntervalTrigger(hours=poll_hours),
        id="poll_all_sources",
        name="Poll all active sources",
        replace_existing=True,
    )
    scheduler.start()
    logger.info(
        "Scheduler started — polling every %d hours",
        poll_hours
    )
    app.state.scheduler = scheduler

    yield

    scheduler.shutdown(wait=False)
    logger.info("Scheduler stopped")


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="BrainCache", lifespan=lifespan)
app.mount("/static", StaticFiles(directory="static"), name="static")


# ---------------------------------------------------------------------------
# WebSocket connection manager
# ---------------------------------------------------------------------------

class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, message: dict):
        """Send JSON message to all connected clients.
        Remove dead connections silently."""
        disconnected = []
        for ws in self.active:
            try:
                await ws.send_json(message)
            except Exception:
                disconnected.append(ws)
        for ws in disconnected:
            self.disconnect(ws)


notification_manager = ConnectionManager()

# Lock that prevents concurrent poll runs (scheduler + manual) from
# inserting duplicate articles when a slow source overlaps the next tick.
_poll_lock = asyncio.Lock()


# ---------------------------------------------------------------------------
# Scheduled poll
# ---------------------------------------------------------------------------

async def scheduled_poll():
    """
    Called by APScheduler on the configured interval.
    Polls all active sources. Broadcasts new article
    counts to connected clients. Announces via TTS
    if available.
    """
    if _poll_lock.locked():
        logger.info("Scheduler: skipping poll — previous run still in progress")
        return

    logger.info("Scheduler: starting scheduled poll")
    async with _poll_lock:
        try:
            results = await asyncio.to_thread(scraper.poll_all_sources, DB_PATH)
            total = sum(results.values())
            new_by_source = {k: v for k, v in results.items() if v > 0}

            if total > 0:
                logger.info(
                    "Scheduler: %d new articles found — %s",
                    total, new_by_source
                )

                # Broadcast to all connected browser clients
                await notification_manager.broadcast({
                    "type": "new_articles",
                    "total": total,
                    "by_source": new_by_source
                })

                # Announce via Piper TTS (non-blocking)
                sources_text = ", ".join(
                    f"{count} from {name}"
                    for name, count in new_by_source.items()
                )
                announcement = f"New articles available: {sources_text}."
                asyncio.create_task(tts.speak_async(announcement, _CONFIG))
            else:
                logger.info("Scheduler: no new articles found")

        except Exception as exc:
            logger.exception("Scheduler: poll failed — %s", exc)
            await notification_manager.broadcast({
                "type": "poll_error",
                "message": str(exc)
            })


@app.get("/")
async def serve_index():
    return FileResponse("static/index.html")


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class SourceCreate(BaseModel):
    name: str
    url: str
    feed_type: str
    scrape_selector: Optional[str] = None


class SourceUpdate(BaseModel):
    name: Optional[str] = None
    url: Optional[str] = None
    feed_type: Optional[str] = None
    scrape_selector: Optional[str] = None
    is_active: Optional[int] = None


class NotebookCreate(BaseModel):
    term: str
    source_article_url: Optional[str] = None


class NotebookResolve(BaseModel):
    is_resolved: bool


class ArticleDismiss(BaseModel):
    url: str
    action: str  # "read" or "dismiss"


class ArticlePaste(BaseModel):
    title: str
    text: str
    url: Optional[str] = None


class NotebookReview(BaseModel):
    quality: int  # 0–5 (SM-2 quality rating)


# ---------------------------------------------------------------------------
# Routes — Sources
# ---------------------------------------------------------------------------

@app.get("/api/sources")
async def api_get_sources():
    return db.get_all_sources(DB_PATH)


@app.post("/api/sources", status_code=201)
async def api_create_source(body: SourceCreate):
    if body.feed_type not in ("rss", "scrape"):
        raise HTTPException(
            status_code=422,
            detail="feed_type must be 'rss' or 'scrape'",
        )
    if body.feed_type == "scrape" and not body.scrape_selector:
        raise HTTPException(
            status_code=422,
            detail="scrape_selector is required when feed_type is 'scrape'",
        )
    return db.insert_source(
        DB_PATH,
        name=body.name,
        url=body.url,
        feed_type=body.feed_type,
        scrape_selector=body.scrape_selector,
    )


@app.put("/api/sources/{source_id}")
async def api_update_source(source_id: int, body: SourceUpdate):
    existing = db.get_source_by_id(DB_PATH, source_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Source not found")
    updates = body.model_dump(exclude_none=True)
    if not updates:
        return existing
    return db.update_source(DB_PATH, source_id, **updates)


@app.delete("/api/sources/{source_id}", status_code=204)
async def api_delete_source(source_id: int):
    if not db.get_source_by_id(DB_PATH, source_id):
        raise HTTPException(status_code=404, detail="Source not found")
    db.delete_source(DB_PATH, source_id)


@app.post("/api/sources/{source_id}/poll")
async def api_poll_source(source_id: int):
    source = db.get_source_by_id(DB_PATH, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    new_count = await asyncio.to_thread(scraper.poll_source, source, DB_PATH)
    return {"new_articles": new_count}


@app.post("/api/sources/{source_id}/test")
async def api_test_source(source_id: int):
    source = db.get_source_by_id(DB_PATH, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    detected = scraper.test_source(source)
    return {"detected": detected}


# ---------------------------------------------------------------------------
# Routes — Articles
# ---------------------------------------------------------------------------

@app.get("/api/articles")
async def api_get_articles(source_id: Optional[int] = None):
    return db.get_all_articles(DB_PATH, source_id=source_id)


@app.get("/api/articles/search")
async def api_search_articles(q: Optional[str] = Query(default=None)):
    if not q or len(q) < 2:
        raise HTTPException(status_code=400, detail="q must be at least 2 characters")
    conn = db.get_connection(DB_PATH)
    rows = conn.execute(
        """
        SELECT a.*, s.name as source_name
        FROM articles a
        LEFT JOIN sources s ON a.source_id = s.id
        WHERE (a.title LIKE ? OR a.summary LIKE ?)
          AND (a.dismissed = 0 OR a.dismissed IS NULL)
        ORDER BY a.id DESC
        LIMIT 100
        """,
        (f"%{q}%", f"%{q}%"),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/articles/dismiss")
async def api_dismiss_article(body: ArticleDismiss):
    article = db.get_article_by_url(DB_PATH, body.url)
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    if body.action == "read":
        db.update_article_session_status(DB_PATH, body.url, "complete")
    elif body.action == "dismiss":
        conn = db.get_connection(DB_PATH)
        with conn:
            conn.execute(
                "UPDATE articles SET dismissed = 1 WHERE url = ?", (body.url,)
            )
        conn.close()
    else:
        raise HTTPException(status_code=400, detail="action must be 'read' or 'dismiss'")
    return {"url": body.url, "action": body.action}


@app.post("/api/articles/paste", status_code=201)
async def api_paste_article(body: ArticlePaste):
    title = body.title.strip()
    text = body.text.strip()
    if not title:
        raise HTTPException(status_code=400, detail="title is required")
    if len(text) < 50:
        raise HTTPException(status_code=400, detail="text must be at least 50 characters")
    article_url = (body.url or "").strip() or f"paste://{uuid.uuid4()}"
    article = db.insert_paste_article(DB_PATH, url=article_url, title=title, full_text=text)
    if article is None:
        # URL collision — return existing record
        article = db.get_article_by_url(DB_PATH, article_url)
    return article


@app.get("/api/session/status/{article_url:path}")
async def api_session_status(article_url: str):
    article = db.get_article_by_url(DB_PATH, article_url)
    if not article:
        return {"status": "not_found"}
    logs = db.get_session_logs_by_article(DB_PATH, article_url)
    return {
        "status": article["session_status"],
        "log_count": len(logs),
        "can_resume": (
            article["session_status"] == "in_progress"
            and len(logs) > 0
        ),
        "last_phase": logs[-1]["phase"] if logs else None,
        "article_title": article.get("title"),
    }


@app.get("/api/sessions/history")
async def api_sessions_history():
    conn = db.get_connection(DB_PATH)
    rows = conn.execute(
        """
        SELECT a.url, a.title, a.session_status,
               a.scraped_at, a.published_date,
               s.name as source_name,
               COUNT(sl.id) as response_count,
               MAX(sl.timestamp) as last_activity
        FROM articles a
        LEFT JOIN sources s ON a.source_id = s.id
        LEFT JOIN session_logs sl ON sl.article_url = a.url
        WHERE a.session_status != 'not_started'
        GROUP BY a.url
        ORDER BY last_activity DESC
        LIMIT 50
        """
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Routes — Poll all
# ---------------------------------------------------------------------------

@app.post("/api/poll")
async def api_poll_all():
    if _poll_lock.locked():
        return {"total": 0, "sources": {}, "note": "poll already in progress"}
    async with _poll_lock:
        counts = await asyncio.to_thread(scraper.poll_all_sources, DB_PATH)
    total = sum(counts.values())
    new_by_source = {k: v for k, v in counts.items() if v > 0}
    if total > 0:
        await notification_manager.broadcast({
            "type": "new_articles",
            "total": total,
            "by_source": new_by_source
        })
    return {"total": total, "sources": counts}


# ---------------------------------------------------------------------------
# Routes — Ollama status
# ---------------------------------------------------------------------------

@app.get("/api/ollama/status")
async def api_ollama_status():
    ready = ollama_client.check_ollama_ready()
    return {
        "ready": ready,
        "model": ollama_client.OLLAMA_MODEL,
        "host": ollama_client.OLLAMA_HOST,
    }


# ---------------------------------------------------------------------------
# Routes — Voice status
# ---------------------------------------------------------------------------

@app.get("/api/voice/status")
async def api_voice_status():
    return {
        "tts": {
            "available": tts.check_piper_available(_CONFIG),
            "binary": _CONFIG.get("piper_binary", ""),
            "model": _CONFIG.get("piper_model", ""),
        },
        "stt": {
            "available": stt.check_whisper_available(_CONFIG),
            "binary": _CONFIG.get("whisper_binary", ""),
            "model": _CONFIG.get("whisper_model", ""),
        },
    }


# ---------------------------------------------------------------------------
# Routes — Audio transcription
# ---------------------------------------------------------------------------

@app.post("/api/session/audio")
async def api_transcribe_audio(audio: UploadFile = File(...)):
    audio_bytes = await audio.read()
    content_type = audio.content_type or ""
    filename = audio.filename or ""

    tmp_wav = None
    tmp_webm = None
    try:
        is_webm = (
            "webm" in content_type
            or "ogg" in content_type
            or "opus" in content_type
            or filename.endswith(".webm")
            or filename.endswith(".ogg")
        )

        if is_webm:
            tmp_webm_file = tempfile.NamedTemporaryFile(suffix=".webm", delete=False)
            tmp_webm = tmp_webm_file.name
            tmp_webm_file.write(audio_bytes)
            tmp_webm_file.close()

            tmp_wav_file = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
            tmp_wav = tmp_wav_file.name
            tmp_wav_file.close()

            ok = stt.save_webm_as_wav(audio_bytes, tmp_wav)
            if not ok:
                return {"text": ""}
        else:
            tmp_wav_file = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
            tmp_wav = tmp_wav_file.name
            tmp_wav_file.write(audio_bytes)
            tmp_wav_file.close()

        text = await asyncio.to_thread(stt.transcribe_audio, tmp_wav, _CONFIG)
        return {"text": text}

    finally:
        for path in (tmp_wav, tmp_webm):
            if path:
                try:
                    os.unlink(path)
                except OSError:
                    pass


# ---------------------------------------------------------------------------
# WebSocket — Feynman session
# ---------------------------------------------------------------------------

@app.websocket("/ws/session")
async def ws_session(websocket: WebSocket):
    await websocket.accept()

    try:
        # Wait for start message
        msg = await websocket.receive_json()
        if msg.get("type") != "start":
            await websocket.send_json({"type": "error", "message": "Expected start message", "recoverable": False})
            return
        url = (msg.get("url") or "").strip()
        if not url:
            await websocket.send_json({"type": "error", "message": "URL is required", "recoverable": False})
            return
        if not url.startswith(("http://", "https://")):
            await websocket.send_json({"type": "error", "message": "URL must start with http:// or https://", "recoverable": False})
            return

        # 1. Fetch article full text — skip scraper if pre-populated (paste articles)
        existing = await asyncio.to_thread(db.get_article_by_url, DB_PATH, url)
        if existing and existing.get("full_text"):
            full_text = existing["full_text"]
            await asyncio.to_thread(db.update_article_session_status, DB_PATH, url, "in_progress")
        else:
            await websocket.send_json({"type": "status", "message": "Fetching article..."})
            try:
                full_text = await asyncio.to_thread(scraper.fetch_full_article_text, url)
            except Exception as exc:
                await websocket.send_json({"type": "error", "message": f"Failed to fetch article: {exc}", "recoverable": False})
                return
            if not full_text:
                await websocket.send_json({"type": "error", "message": "Article text is empty — cannot start session.", "recoverable": False})
                return
            await asyncio.to_thread(db.update_article_full_text, DB_PATH, url, full_text)
            await asyncio.to_thread(db.update_article_session_status, DB_PATH, url, "in_progress")

        # Get article metadata
        article = await asyncio.to_thread(db.get_article_by_url, DB_PATH, url)
        title = (article.get("title") or url) if article else url
        summary = (article.get("summary") or "") if article else ""

        # Generate pre-read prompt (recoverable)
        await websocket.send_json({"type": "status", "message": "Generating pre-read prompt..."})
        hypothesis_question = ""
        unknown_terms = []
        try:
            pre_read = await asyncio.to_thread(
                session_module.generate_pre_read_prompt, title, summary
            )
            hypothesis_question = pre_read.get("hypothesis_question", "")
            unknown_terms = pre_read.get("unknown_terms", [])
        except Exception as exc:
            logger.warning("Pre-read prompt generation failed: %s", exc)
            await websocket.send_json({
                "type": "error",
                "message": f"Pre-read prompt failed: {exc}",
                "recoverable": True,
            })
            hypothesis_question = f"Before reading — what do you already know about: {title}?"

        # Send pre-read phase
        await websocket.send_json({
            "type": "phase",
            "phase": "pre",
            "prompt": hypothesis_question,
        })
        asyncio.create_task(tts.speak_async(hypothesis_question, _CONFIG))

        # Send article text — client shows it locked until hypothesis submitted
        await websocket.send_json({
            "type": "article_text",
            "title": title,
            "text": full_text[:60000],
        })

        # Wait for pre-read response
        try:
            pre_msg = await asyncio.wait_for(websocket.receive_json(), timeout=300)
        except asyncio.TimeoutError:
            await websocket.send_json({"type": "error", "message": "Session timed out waiting for response.", "recoverable": False})
            return
        await asyncio.to_thread(
            db.insert_session_log,
            DB_PATH, url, "pre", hypothesis_question,
            pre_msg.get("text", ""),
        )

        # Generate notebook entries (recoverable per term)
        await websocket.send_json({"type": "status", "message": "Generating notebook entries..."})
        notebook_entries = []
        for term in unknown_terms:
            try:
                entry = await asyncio.to_thread(
                    notebook_module.generate_notebook_entry, DB_PATH, term, url
                )
                notebook_entries.append(entry)
            except Exception as exc:
                logger.warning("Notebook entry failed for '%s': %s", term, exc)
                await websocket.send_json({
                    "type": "error",
                    "message": f"Notebook entry for '{term}' failed: {exc}",
                    "recoverable": True,
                })
        await websocket.send_json({"type": "terms", "entries": notebook_entries})

        # Generate Socratic questions (fatal after retries)
        await websocket.send_json({"type": "status", "message": "Generating Socratic questions..."})
        try:
            questions = await asyncio.to_thread(
                session_module.generate_socratic_questions, full_text
            )
        except Exception as exc:
            logger.error("Socratic question generation failed: %s", exc)
            await websocket.send_json({"type": "error", "message": f"Socratic questions failed: {exc}", "recoverable": False})
            return

        # Send each question, wait for response, log
        for i, question in enumerate(questions):
            await websocket.send_json({
                "type": "question",
                "index": i,
                "total": len(questions),
                "text": question,
            })
            asyncio.create_task(tts.speak_async(question, _CONFIG))
            try:
                q_msg = await asyncio.wait_for(websocket.receive_json(), timeout=300)
            except asyncio.TimeoutError:
                await websocket.send_json({"type": "error", "message": "Session timed out waiting for response.", "recoverable": False})
                return
            await asyncio.to_thread(
                db.insert_session_log,
                DB_PATH, url, f"post_{i}", question,
                q_msg.get("text", ""),
            )

        # Generate session summary (recoverable)
        await websocket.send_json({"type": "status", "message": "Generating session summary..."})
        all_logs = await asyncio.to_thread(db.get_session_logs_by_article, DB_PATH, url)
        try:
            summary_data = await asyncio.to_thread(
                session_module.generate_session_summary, url, all_logs
            )
        except Exception as exc:
            logger.warning("Session summary generation failed: %s", exc)
            await websocket.send_json({
                "type": "error",
                "message": f"Summary generation failed: {exc}",
                "recoverable": True,
            })
            summary_data = {"strong_points": [], "gap_terms": [], "recommended_entries": []}
        await websocket.send_json({"type": "summary", "data": summary_data})

        # Mark complete
        await asyncio.to_thread(db.update_article_session_status, DB_PATH, url, "complete")
        asyncio.create_task(tts.speak_async("Session complete", _CONFIG))
        await websocket.send_json({"type": "complete"})

        # Extract and store entities in background (non-blocking)
        asyncio.create_task(_extract_and_store_entities(url, title, full_text))

    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected from session")
    except Exception as exc:
        logger.error("Session WebSocket error: %s", exc)
        try:
            await websocket.send_json({"type": "error", "message": str(exc), "recoverable": False})
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Entity extraction background task
# ---------------------------------------------------------------------------

async def _extract_and_store_entities(url: str, title: str, full_text: str) -> None:
    """
    Runs after session complete. Extracts named entities via LLM
    and upserts them into the entities + article_entities tables.
    Runs entirely in background — session is already marked complete.
    """
    try:
        entities = await asyncio.to_thread(
            session_module.extract_entities, title, full_text
        )
        for e in entities:
            await asyncio.to_thread(
                db.upsert_entity, DB_PATH, e["name"], e["type"], url
            )
        if entities:
            logger.info(
                "Entity extraction: stored %d entities for %s", len(entities), url
            )
    except Exception as exc:
        logger.warning("Entity extraction failed for %s: %s", url, exc)


# ---------------------------------------------------------------------------
# WebSocket — Notifications broadcast
# ---------------------------------------------------------------------------

@app.websocket("/ws/notifications")
async def notifications_ws(websocket: WebSocket):
    await notification_manager.connect(websocket)
    try:
        while True:
            # Keep connection alive — receive and discard
            # any client messages (heartbeats etc)
            try:
                await asyncio.wait_for(
                    websocket.receive_text(),
                    timeout=30
                )
            except asyncio.TimeoutError:
                # Normal — just means no message in 30s, loop again
                pass
    except WebSocketDisconnect:
        notification_manager.disconnect(websocket)
    except Exception:
        notification_manager.disconnect(websocket)


# ---------------------------------------------------------------------------
# Routes — Scheduler status
# ---------------------------------------------------------------------------

@app.get("/api/scheduler/status")
async def scheduler_status():
    sched = getattr(app.state, "scheduler", None)
    if not sched:
        return {"running": False, "jobs": []}

    jobs = []
    for job in sched.get_jobs():
        next_run = job.next_run_time
        jobs.append({
            "id": job.id,
            "name": job.name,
            "next_run": next_run.isoformat() if next_run else None,
        })

    return {
        "running": sched.running,
        "poll_interval_hours": _CONFIG.get("poll_interval_hours", 6),
        "jobs": jobs
    }


# ---------------------------------------------------------------------------
# Routes — Notebook
# ---------------------------------------------------------------------------

@app.post("/api/notebook", status_code=200)
async def api_create_notebook_entry(body: NotebookCreate):
    term = body.term.strip()
    if not term:
        raise HTTPException(status_code=400, detail="term is required")
    entry = await asyncio.to_thread(
        notebook_module.generate_notebook_entry,
        DB_PATH, term, body.source_article_url,
    )
    return entry


@app.get("/api/notebook")
async def api_get_notebook():
    return db.get_all_notebook_entries(DB_PATH)


@app.get("/api/notebook/export")
async def api_export_notebook():
    entries = db.get_all_notebook_entries(DB_PATH)
    lines = [
        "# BrainCache — I Don't Know Notebook",
        f"Exported: {db.now_iso()}",
        f"Total entries: {len(entries)}",
        "",
        "---",
        "",
    ]
    unresolved = [e for e in entries if not e["is_resolved"]]
    resolved   = [e for e in entries if e["is_resolved"]]

    if unresolved:
        lines.append("## Unresolved\n")
        for e in unresolved:
            lines.append(f"### {e['term']}")
            if e.get("mitre_reference"):
                lines.append(f"**MITRE:** {e['mitre_reference']}")
            if e.get("hypothesis_prompt"):
                lines.append(f"\n**Hypothesis prompt:**")
                lines.append(e["hypothesis_prompt"])
            if e.get("plain_explanation"):
                lines.append(f"\n**Explanation:**")
                lines.append(e["plain_explanation"])
            if e.get("socratic_questions"):
                lines.append(f"\n**Socratic questions:**")
                qs = e["socratic_questions"]
                if isinstance(qs, list):
                    for i, q in enumerate(qs, 1):
                        lines.append(f"{i}. {q}")
            if e.get("resolution_target"):
                lines.append(f"\n**Resolve when you can say:**")
                lines.append(f"*{e['resolution_target']}*")
            if e.get("source_article_url"):
                lines.append(f"\n*Source: {e['source_article_url']}*")
            lines.append("\n---\n")

    if resolved:
        lines.append("## Resolved\n")
        for e in resolved:
            lines.append(f"### ~~{e['term']}~~")
            lines.append(f"*Resolved: {e.get('resolved_at', 'unknown')}*")
            if e.get("plain_explanation"):
                lines.append(e["plain_explanation"])
            lines.append("\n---\n")

    content = "\n".join(lines)
    return Response(
        content=content,
        media_type="text/markdown",
        headers={
            "Content-Disposition": 'attachment; filename="braincache-notebook.md"'
        },
    )


@app.get("/api/notebook/export/obsidian")
async def api_export_notebook_obsidian():
    entries = db.get_all_notebook_entries(DB_PATH)

    # Build lookup for wikilink insertion
    term_map = {e["term"].lower(): e["term"] for e in entries}

    def insert_wikilinks(text: str) -> str:
        if not text:
            return text
        # Longest terms first to avoid partial replacements
        for lower, orig in sorted(term_map.items(), key=lambda x: -len(x[0])):
            # Only linkify the first occurrence and skip if already linked
            text = re.sub(
                r'(?<!\[\[)\b' + re.escape(orig) + r'\b(?!\]\])',
                f'[[{orig}]]',
                text,
                count=1,
                flags=re.IGNORECASE,
            )
        return text

    def entry_to_md(entry: dict) -> str:
        tags = ["braincache", "cybersecurity"]
        if entry.get("mitre_reference"):
            tags.append("mitre")
        if entry.get("is_resolved"):
            tags.append("resolved")
        lines = [
            "---",
            f"tags: [{', '.join(tags)}]",
            f'term: "{entry["term"]}"',
        ]
        if entry.get("mitre_reference"):
            lines.append(f'mitre: "{entry["mitre_reference"]}"')
        lines.append(f'resolved: {"true" if entry["is_resolved"] else "false"}')
        lines.append(f'created: "{entry.get("created_at", "")}"')
        if entry.get("source_article_url"):
            lines.append(f'source: "{entry["source_article_url"]}"')
        lines += ["---", "", f"# {entry['term']}"]

        if entry.get("mitre_reference"):
            lines += ["", f"> **MITRE:** {entry['mitre_reference']}"]

        if entry.get("plain_explanation"):
            lines += ["", "## Explanation", "", insert_wikilinks(entry["plain_explanation"])]

        if entry.get("hypothesis_prompt"):
            lines += ["", "## Hypothesis Prompt", "", f"*{entry['hypothesis_prompt']}*"]

        qs = entry.get("socratic_questions") or []
        if isinstance(qs, list) and qs:
            lines += ["", "## Socratic Questions", ""]
            for i, q in enumerate(qs, 1):
                lines.append(f"{i}. {q}")

        if entry.get("resolution_target"):
            lines += ["", "## Resolution Target", "",
                      f"> *You should be able to say: {entry['resolution_target']}*"]

        if entry.get("source_article_url"):
            lines += ["", "---", f"*Source: {entry['source_article_url']}*"]

        return "\n".join(lines)

    def make_index(entries: list) -> str:
        unresolved = [e for e in entries if not e["is_resolved"]]
        resolved = [e for e in entries if e["is_resolved"]]
        lines = [
            "---",
            "tags: [braincache, index]",
            f'generated: "{db.now_iso()}"',
            "---",
            "",
            "# BrainCache — I Don't Know Notebook",
            "",
            f"*{len(entries)} entries · exported {db.now_iso()[:10]}*",
            "",
        ]
        if unresolved:
            lines += ["## Unresolved", ""]
            for e in unresolved:
                mitre = f" · `{e['mitre_reference']}`" if e.get("mitre_reference") else ""
                lines.append(f"- [[{e['term']}]]{mitre}")
        if resolved:
            lines += ["", "## Resolved", ""]
            for e in resolved:
                lines.append(f"- ~~[[{e['term']}]]~~")
        return "\n".join(lines)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for entry in entries:
            safe = re.sub(r'[<>:"/\\|?*]', '_', entry["term"])
            zf.writestr(f"BrainCache/{safe}.md", entry_to_md(entry))
        zf.writestr("BrainCache/BrainCache Index.md", make_index(entries))
    buf.seek(0)

    return Response(
        content=buf.read(),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="braincache-obsidian.zip"'},
    )


@app.get("/api/notebook/due")
async def api_notebook_due():
    return db.get_due_notebook_entries(DB_PATH)


@app.get("/api/notebook/sr-stats")
async def api_notebook_sr_stats():
    return db.get_sr_stats(DB_PATH)


@app.post("/api/notebook/{entry_id}/review")
async def api_review_notebook_entry(entry_id: int, body: NotebookReview):
    if body.quality < 0 or body.quality > 5:
        raise HTTPException(status_code=400, detail="quality must be 0–5")
    entry = db.apply_sm2_review(DB_PATH, entry_id, body.quality)
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    return entry


@app.put("/api/notebook/{entry_id}/resolve")
async def api_resolve_notebook_entry(entry_id: int, body: NotebookResolve):
    entry = db.update_notebook_entry_resolved(DB_PATH, entry_id, body.is_resolved)
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    return entry


@app.delete("/api/notebook/{entry_id}", status_code=204)
async def api_delete_notebook_entry(entry_id: int):
    deleted = db.delete_notebook_entry(DB_PATH, entry_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Entry not found")


# ---------------------------------------------------------------------------
# Routes — Morning Brief
# ---------------------------------------------------------------------------

@app.get("/api/morning-brief")
async def api_morning_brief():
    conn = db.get_connection(DB_PATH)

    new_articles = conn.execute(
        """
        SELECT a.id, a.url, a.title, a.summary, a.published_date,
               a.scraped_at, a.source_id, s.name as source_name
        FROM articles a
        LEFT JOIN sources s ON a.source_id = s.id
        WHERE a.session_status = 'not_started'
          AND (a.dismissed = 0 OR a.dismissed IS NULL)
        ORDER BY a.scraped_at DESC
        LIMIT 5
        """
    ).fetchall()

    last_session = conn.execute(
        """
        SELECT a.url, a.title, s.name as source_name,
               MAX(sl.timestamp) as last_activity,
               COUNT(sl.id) as response_count
        FROM articles a
        LEFT JOIN sources s ON a.source_id = s.id
        LEFT JOIN session_logs sl ON sl.article_url = a.url
        WHERE a.session_status = 'complete'
        GROUP BY a.url
        ORDER BY last_activity DESC
        LIMIT 1
        """
    ).fetchone()

    conn.close()

    due_reviews = db.get_due_notebook_entries(DB_PATH)

    return {
        "new_articles": [dict(r) for r in new_articles],
        "due_review_count": len(due_reviews),
        "last_session": dict(last_session) if last_session else None,
    }


# ---------------------------------------------------------------------------
# Routes — Entity tracking
# ---------------------------------------------------------------------------

@app.get("/api/entities")
async def api_get_entities():
    return db.get_entities_with_article_counts(DB_PATH)


@app.get("/api/entities/{entity_id}/articles")
async def api_get_entity_articles(entity_id: int):
    return db.get_entity_articles(DB_PATH, entity_id)
