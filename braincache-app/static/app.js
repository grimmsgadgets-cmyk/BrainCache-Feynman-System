// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  sources: [],
  articles: [],
  unseenCount: 0,
  voiceEnabled: false,
  recording: false,
  historyData: [],
};

// ---------------------------------------------------------------------------
// Bookshelf constants
// ---------------------------------------------------------------------------
const BOOK_COLORS = [
  '#6b2030', // deep crimson
  '#1e3a20', // forest green
  '#1a2545', // navy
  '#4a3010', // dark ochre
  '#22304a', // slate blue
  '#4a1228', // burgundy
  '#303820', // olive
  '#13303a', // teal
  '#2a1a40', // purple
  '#3a1e08', // dark brown
];

function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

let historyViewMode = 'shelf';

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// API fetch helper
// ---------------------------------------------------------------------------
async function apiFetch(path, options = {}) {
  const resp = await fetch(path, options);
  if (!resp.ok) {
    let msg = `HTTP ${resp.status}`;
    try {
      const body = await resp.json();
      msg = body.detail || body.message || msg;
    } catch {}
    throw new Error(msg);
  }
  if (resp.status === 204) return null;
  return resp.json();
}

// ---------------------------------------------------------------------------
// Toast — elaborate botanical sprig SVG, slides in from right
// ---------------------------------------------------------------------------
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;

  const c = type === 'error' ? '#f87171' : type === 'success' ? '#4ade80' : '#c8a96e';
  let sprig;

  if (type === 'success') {
    // Upright healthy sprig: stem, two flanking leaves, bud at tip
    sprig = `<svg class="toast-leaf" viewBox="0 0 9 11" width="9" height="11" fill="none">
      <path d='M4.5 10.5 C4.5 8 4.5 4 4.5 1' stroke='${c}' stroke-width='0.9' stroke-linecap='round'/>
      <path d='M4.5 7.5 C2.5 6.5 1 4.5 2 3 C3 3.5 4.5 5.5 4.5 7.5' stroke='${c}' stroke-width='0.7' fill='none' stroke-linecap='round'/>
      <path d='M4.5 6 C6.5 5 8 3 7 1.5 C6 2 4.5 4 4.5 6' stroke='${c}' stroke-width='0.7' fill='none' stroke-linecap='round'/>
      <circle cx='4.5' cy='0.8' r='0.95' fill='${c}'/>
    </svg>`;
  } else if (type === 'error') {
    // Wilted drooping sprig
    sprig = `<svg class="toast-leaf" viewBox="0 0 9 11" width="9" height="11" fill="none">
      <path d='M2.5 1 C3.5 2.5 5.5 4.5 6.5 6 C7.5 7.5 6.5 9.5 5.5 10.5' stroke='${c}' stroke-width='0.9' fill='none' stroke-linecap='round'/>
      <path d='M4.5 4.5 C6 5.5 7.5 6.5 7.5 8.5' stroke='${c}' stroke-width='0.7' fill='none' stroke-linecap='round'/>
      <path d='M3.5 3.5 C1.5 4.5 0.5 6 1 8' stroke='${c}' stroke-width='0.7' fill='none' stroke-linecap='round'/>
      <circle cx='2.5' cy='1' r='0.8' fill='${c}' opacity='0.6'/>
    </svg>`;
  } else {
    // Info: horizontal sprig pointing right, leaves along stem, bud tip
    sprig = `<svg class="toast-leaf" viewBox="0 0 10 9" width="10" height="9" fill="none">
      <path d='M1 6 C3 5 6 4.5 9 4.5' stroke='${c}' stroke-width='0.9' stroke-linecap='round'/>
      <path d='M3.5 6 C3 4.5 3.5 2.5 5 2 C5.5 3 5 5 3.5 6' stroke='${c}' stroke-width='0.7' fill='none' stroke-linecap='round'/>
      <path d='M6 5 C5.5 3.5 6 1.5 7.5 1 C8 2 7.5 4 6 5' stroke='${c}' stroke-width='0.7' fill='none' stroke-linecap='round'/>
      <circle cx='9' cy='4.5' r='0.9' fill='${c}'/>
    </svg>`;
  }

  el.innerHTML = `${sprig}<span>${esc(message)}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, 5000);
}

// ---------------------------------------------------------------------------
// Tab navigation — with page-turn fade
// ---------------------------------------------------------------------------
function switchTab(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const view = document.getElementById('view-' + name);
  // Force animation replay by removing and re-adding active
  view.classList.add('active');
  document.querySelector(`[data-tab="${name}"]`).classList.add('active');
  if (name === 'brief') loadMorningBrief();
  if (name === 'actors') loadActors();
  if (name === 'heatmap') loadHeatmap();
}

// ---------------------------------------------------------------------------
// Feed badge
// ---------------------------------------------------------------------------
function updateFeedBadge() {
  const badge = document.getElementById('feed-badge');
  if (state.unseenCount > 0) {
    badge.textContent = state.unseenCount;
    badge.classList.add('visible');
  } else {
    badge.classList.remove('visible');
  }
}

// ---------------------------------------------------------------------------
// Open in session
// ---------------------------------------------------------------------------
function openInSession(url) {
  document.getElementById('session-url').value = url;
  switchTab('session');
}

// ---------------------------------------------------------------------------
// Ollama status — drives flower petal color
// ---------------------------------------------------------------------------
async function checkOllamaStatus() {
  const petals = document.querySelectorAll('#ollama-flower .petal');
  const label  = document.getElementById('ollama-label');
  try {
    const data = await apiFetch('/api/ollama/status');
    const color = data.ready ? '#4ade80' : '#f87171';
    petals.forEach(p => p.setAttribute('fill', color));
    label.textContent = data.model || 'unknown';
  } catch {
    petals.forEach(p => p.setAttribute('fill', '#f87171'));
    label.textContent = 'unavailable';
  }
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------
async function loadSchedulerStatus() {
  const bar = document.getElementById('scheduler-status-bar');
  const nextRunEl = document.getElementById('scheduler-next-run');
  const intervalEl = document.getElementById('scheduler-interval');
  if (!bar) return;
  try {
    const data = await apiFetch('/api/scheduler/status');
    if (!data.running) {
      nextRunEl.textContent = 'Scheduler not running';
      nextRunEl.style.color = 'var(--warn)';
      if (intervalEl) intervalEl.textContent = '';
      return;
    }
    nextRunEl.style.color = 'var(--text)';
    const job = (data.jobs || []).find(j => j.id === 'poll_all_sources');
    if (job && job.next_run) {
      const d = new Date(job.next_run);
      nextRunEl.textContent = d.toLocaleString();
    } else {
      nextRunEl.textContent = '—';
    }
    if (intervalEl) {
      intervalEl.textContent = `Poll interval: ${data.poll_interval_hours}h`;
    }
  } catch {
    nextRunEl.textContent = '—';
  }
}

async function loadSources() {
  try {
    const sources = await apiFetch('/api/sources');
    state.sources = sources;
    renderSources();
    populateSourceFilter();
    loadSchedulerStatus();
  } catch (err) {
    showToast('Failed to load sources: ' + err.message, 'error');
  }
}

function populateSourceFilter() {
  const sel = document.getElementById('source-filter');
  const current = sel.value;
  sel.innerHTML = '<option value="">All Sources</option>';
  state.sources.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = esc(s.name);
    sel.appendChild(opt);
  });
  sel.value = current;
}

function renderSources() {
  const tbody = document.getElementById('sources-tbody');
  if (!state.sources.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="color:var(--muted);text-align:center;padding:32px">No sources configured.</td></tr>';
    return;
  }
  tbody.innerHTML = state.sources.map(s => {
    const typeBadge = s.feed_type === 'rss'
      ? `<span class="badge badge-rss">RSS</span>`
      : `<span class="badge badge-scrape">SCRAPE</span>`;
    const statusBtnLabel = s.is_active ? 'Active' : 'Inactive';
    const statusBtnStyle = s.is_active
      ? 'color:var(--success);border-color:var(--success)'
      : 'color:var(--muted)';
    const lastPolled = s.last_polled_at ? fmtDate(s.last_polled_at) : 'Never';
    const errorIndicator = s.last_error
      ? `<span class="src-error-indicator" title="${esc(s.last_error)}">
           <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
             <path d="M6 1L11 10H1L6 1Z" stroke="#fbbf24" stroke-width="1.2" fill="none" stroke-linejoin="round"/>
             <line x1="6" y1="5" x2="6" y2="7.5" stroke="#fbbf24" stroke-width="1.1" stroke-linecap="round"/>
             <circle cx="6" cy="9" r="0.65" fill="#fbbf24"/>
           </svg>
           <span class="src-error-tooltip">${esc(s.last_error)}</span>
         </span>`
      : '';
    return `
      <tr>
        <td>${esc(s.name)}</td>
        <td class="td-url" title="${esc(s.url)}">${esc(s.url)}</td>
        <td>${typeBadge}</td>
        <td>
          <button class="btn sm" style="${statusBtnStyle}"
            onclick="toggleSourceActive(${s.id}, ${s.is_active})">
            ${statusBtnLabel}
          </button>
        </td>
        <td style="color:var(--muted);font-size:11px">
          ${esc(lastPolled)}${errorIndicator}
        </td>
        <td class="td-actions">
          <button class="btn sm" onclick="pollSource(${s.id})">Poll</button>
          <button class="btn sm" onclick="testSource(${s.id})">Test</button>
          <button class="btn sm danger" onclick="deleteSource(${s.id})">Delete</button>
          <span id="poll-result-${s.id}" class="poll-result"></span>
        </td>
      </tr>`;
  }).join('');
}

async function toggleSourceActive(id, currentActive) {
  try {
    await apiFetch(`/api/sources/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: currentActive ? 0 : 1 }),
    });
    await loadSources();
  } catch (err) {
    showToast('Failed to update source: ' + err.message, 'error');
  }
}

async function pollSource(id) {
  const el = document.getElementById(`poll-result-${id}`);
  if (el) el.textContent = '…';
  try {
    const data = await apiFetch(`/api/sources/${id}/poll`, { method: 'POST' });
    if (el) {
      el.className = 'poll-result';
      el.textContent = `+${data.new_articles} new`;
    }
    await loadArticles();
  } catch (err) {
    if (el) {
      el.className = 'poll-result error';
      el.textContent = 'Error';
    }
    showToast('Poll failed: ' + err.message, 'error');
  }
}

async function testSource(id) {
  try {
    const data = await apiFetch(`/api/sources/${id}/test`, { method: 'POST' });
    showToast(`Detected ${data.detected} article(s).`, 'info');
  } catch (err) {
    showToast('Test failed: ' + err.message, 'error');
  }
}

async function deleteSource(id) {
  if (!confirm('Delete this source?')) return;
  try {
    await apiFetch(`/api/sources/${id}`, { method: 'DELETE' });
    await loadSources();
    showToast('Source deleted.', 'success');
  } catch (err) {
    showToast('Delete failed: ' + err.message, 'error');
  }
}

function toggleSelectorField() {
  const type = document.getElementById('new-type').value;
  document.getElementById('selector-field').style.display =
    type === 'scrape' ? 'flex' : 'none';
}

async function addSource() {
  const name     = document.getElementById('new-name').value.trim();
  const url      = document.getElementById('new-url').value.trim();
  const feedType = document.getElementById('new-type').value;
  const selector = document.getElementById('new-selector').value.trim();

  if (!name) { showToast('Name is required.', 'error'); return; }
  if (!url)  { showToast('URL is required.', 'error'); return; }
  if (feedType === 'scrape' && !selector) {
    showToast('CSS Selector is required for Scrape sources.', 'error');
    return;
  }

  try {
    await apiFetch('/api/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name, url,
        feed_type: feedType,
        scrape_selector: feedType === 'scrape' ? selector : null,
      }),
    });
    document.getElementById('new-name').value = '';
    document.getElementById('new-url').value  = '';
    document.getElementById('new-selector').value = '';
    await loadSources();
    showToast('Source added.', 'success');
  } catch (err) {
    showToast('Failed to add source: ' + err.message, 'error');
  }
}

// ---------------------------------------------------------------------------
// Articles
// ---------------------------------------------------------------------------
async function loadArticles() {
  const sourceId = document.getElementById('source-filter').value;
  const path = sourceId ? `/api/articles?source_id=${sourceId}` : '/api/articles';
  try {
    const articles = await apiFetch(path);
    state.articles = articles;
    state.unseenCount = articles.filter(a => a.session_status === 'not_started').length;
    updateFeedBadge();
    renderArticles();
  } catch (err) {
    showToast('Failed to load articles: ' + err.message, 'error');
  }
}

function filterArticles() {
  loadArticles();
}

function renderArticles() {
  const list = document.getElementById('article-list');
  if (!state.articles.length) {
    list.innerHTML = '<div class="empty-state">No articles found. Poll a source to get started.</div>';
    return;
  }

  const sourceTypeMap = {};
  state.sources.forEach(s => { sourceTypeMap[s.id] = s.feed_type; });

  list.innerHTML = state.articles.map(a => {
    const feedType = sourceTypeMap[a.source_id] || 'rss';
    const typeBadge = feedType === 'scrape'
      ? `<span class="badge badge-scrape">SCRAPE</span>`
      : `<span class="badge badge-rss">RSS</span>`;

    let statusBadge = '';
    if (a.session_status === 'in_progress') {
      statusBadge = `<span class="badge badge-ip">In Progress</span>`;
    } else if (a.session_status === 'complete') {
      statusBadge = `<span class="badge badge-done">Complete</span>`;
    } else {
      statusBadge = `<span class="badge badge-ns">Not Started</span>`;
    }

    const summary = a.summary
      ? `<div class="card-summary">${esc(a.summary)}</div>` : '';

    const urlJson = JSON.stringify(a.url);
    const rot = (((a.id * 7919 + 1234) % 700) - 350) / 1000;
    return `
      <div class="article-card" id="article-card-${a.id}" style="--card-rot:${rot}deg" onclick="openInSession(${urlJson})">
        <div class="card-top">
          <div class="card-title">${esc(a.title || a.url)}</div>
          ${typeBadge}
          <span id="article-status-badge-${a.id}">${statusBadge}</span>
        </div>
        <div class="card-meta">
          <span>${esc(a.source_name || '')}</span>
          ${a.published_date ? `<span>${fmtDate(a.published_date)}</span>` : ''}
        </div>
        ${summary}
        <div class="article-card-actions" onclick="event.stopPropagation()">
          <button class="btn sm" onclick="openInSession(${urlJson})">Study</button>
          <button class="btn sm" onclick="markArticle(${urlJson}, 'read', ${a.id})">Mark Read</button>
          <button class="btn sm danger" onclick="dismissArticle(${urlJson}, ${a.id})">Dismiss</button>
        </div>
      </div>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// Poll all
// ---------------------------------------------------------------------------
async function pollAll() {
  showToast('Polling all sources…', 'info');
  try {
    const data = await apiFetch('/api/poll', { method: 'POST' });
    showToast(`Poll complete. ${data.total} new article(s).`, 'success');
    await Promise.all([loadSources(), loadArticles()]);
  } catch (err) {
    showToast('Poll failed: ' + err.message, 'error');
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Notifications WebSocket
// ---------------------------------------------------------------------------
let notificationWs = null
let notificationReconnectTimer = null
let notificationHeartbeat = null

function connectNotifications() {
  if (notificationWs &&
      notificationWs.readyState === WebSocket.OPEN) {
    return
  }

  const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  notificationWs = new WebSocket(
    wsProto + '//' + location.host + '/ws/notifications'
  )

  notificationWs.onopen = () => {
    clearTimeout(notificationReconnectTimer)
    clearInterval(notificationHeartbeat)
    notificationHeartbeat = setInterval(() => {
      if (notificationWs.readyState === WebSocket.OPEN) {
        notificationWs.send('ping')
      }
    }, 25000)
  }

  notificationWs.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      handleNotification(msg)
    } catch (_) {}
  }

  notificationWs.onclose = () => {
    // Reconnect after 5 seconds
    notificationReconnectTimer = setTimeout(
      connectNotifications, 5000
    )
  }

  notificationWs.onerror = () => {
    notificationWs.close()
  }
}

function handleNotification(msg) {
  if (msg.type === 'new_articles') {
    // Update unseen count
    state.unseenCount = (state.unseenCount || 0)
                        + msg.total
    updateFeedBadge()

    // Reload articles silently if Feed tab is active
    const feedActive = document.getElementById('view-feed')
      ?.classList.contains('active')
    if (feedActive) {
      loadArticles()
    }

    // Show Art Nouveau styled toast
    const sourceLines = Object.entries(msg.by_source)
      .map(([name, count]) =>
        `${count} new — ${name}`)
      .join('\n')
    showToast(
      `${msg.total} new article${msg.total !== 1
        ? 's' : ''} found\n${sourceLines}`,
      'success'
    )
  }

  if (msg.type === 'poll_error') {
    showToast(
      `Scheduled poll error: ${msg.message}`,
      'error'
    )
  }
}

async function init() {
  await Promise.all([loadSources(), loadArticles()]);
  checkOllamaStatus();
  checkVoiceStatus();
  loadNotebook();
  loadHistory();
  loadSRStats();
  loadMorningBrief();
  setInterval(checkOllamaStatus, 30000);
  setInterval(checkVoiceStatus, 30000);
  connectNotifications();
}

document.addEventListener('DOMContentLoaded', init);

// Parchment parallax — subtle vertical drift on the noise overlay as you scroll
window.addEventListener('scroll', function() {
  document.documentElement.style.setProperty(
    '--parchment-y',
    (-window.scrollY * 0.04).toFixed(1) + 'px'
  );
}, { passive: true });

// ---------------------------------------------------------------------------
// Session — WebSocket client
// ---------------------------------------------------------------------------
let sessionState = {
  ws: null,
  phase: null,
  questionIndex: 0,
  totalQuestions: 4,
  url: null,
  articleTitle: '',
  notebookEntries: [],
};

async function startSession() {
  const urlInput = document.getElementById('session-url');
  const url = urlInput.value.trim();
  if (!url) { showToast('Please enter an article URL.', 'error'); return; }

  // Check for in-progress session
  try {
    const statusRes = await apiFetch(`/api/session/status/${encodeURIComponent(url)}`);
    if (statusRes.can_resume) {
      const resume = confirm(
        `You have an unfinished session for:\n"${statusRes.article_title || url}"\n\nResume where you left off?`
      );
      // Either way, open the WebSocket — session state managed server-side.
      void resume; // acknowledged
    }
  } catch (_) {
    // Non-fatal — proceed without resume check
  }

  sessionState.url = url;
  sessionState.phase = null;
  sessionState.questionIndex = 0;

  document.getElementById('session-panel').style.display = 'flex';
  document.getElementById('session-start-btn').disabled = true;
  document.getElementById('session-prompt-wrap').style.display = 'none';
  document.getElementById('session-response-area').style.display = 'none';
  document.getElementById('session-terms-panel').style.display = 'none';
  document.getElementById('session-summary-panel').style.display = 'none';
  document.getElementById('session-divider-1').style.display = 'none';
  document.getElementById('session-divider-2').style.display = 'none';
  document.getElementById('session-warnings').innerHTML = '';
  setLoader(true, 'Connecting…');
  setPhaseIndicator(null);

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  sessionState.ws = new WebSocket(`${protocol}//${location.host}/ws/session`);

  sessionState.ws.onopen = () => {
    sessionState.ws.send(JSON.stringify({ type: 'start', url }));
  };

  sessionState.ws.onmessage = (event) => {
    try { handleSessionMessage(JSON.parse(event.data)); }
    catch { showToast('Session protocol error.', 'error'); }
  };

  sessionState.ws.onerror = () => {
    showToast('WebSocket connection failed.', 'error');
    document.getElementById('session-start-btn').disabled = false;
    setLoader(false, '');
  };
}

function setLoader(on, text) {
  const loader = document.getElementById('botanical-loader');
  const statusEl = document.getElementById('session-status');
  if (loader) loader.style.display = on ? 'flex' : 'none';
  statusEl.textContent = text || '';
  if (on) statusEl.classList.add('loading');
  else     statusEl.classList.remove('loading');
}

function handleSessionMessage(msg) {
  const statusEl = document.getElementById('session-status');
  switch (msg.type) {

    case 'status':
      setLoader(true, msg.message);
      break;

    case 'phase': {
      setLoader(false, '');
      sessionState.phase = msg.phase;
      if (msg.phase === 'pre') setPhaseIndicator('pre');
      document.getElementById('session-question-counter').textContent = '';
      const prePromptEl = document.getElementById('session-prompt-text');
      prePromptEl.textContent = msg.prompt;
      prePromptEl.classList.remove('ink-reveal');
      void prePromptEl.offsetWidth;
      prePromptEl.classList.add('ink-reveal');
      document.getElementById('session-prompt-wrap').style.display = 'block';
      const taP = document.getElementById('session-response-input');
      taP.placeholder = 'Speak your hypothesis here...';
      taP.value = '';
      document.getElementById('session-response-area').style.display = 'flex';
      // Show flag-term widget as soon as session is live
      const flagWidget = document.getElementById('session-flag-term');
      if (flagWidget) flagWidget.style.display = 'flex';
      taP.focus();
      break;
    }

    case 'article_text': {
      sessionState.articleTitle = msg.title || '';
      document.getElementById('session-article-title').textContent = msg.title || '';
      document.getElementById('session-article-text').textContent = msg.text || '';
      document.getElementById('session-article-panel').style.display = 'block';
      document.getElementById('session-divider-1').style.display = 'block';
      enterReaderMode(msg.title || '', msg.text || '');
      break;
    }

    case 'terms':
      setLoader(false, '');
      setPhaseIndicator('read');
      sessionState.notebookEntries = msg.entries || [];
      renderSessionTerms(msg.entries);
      document.getElementById('session-terms-panel').style.display = 'block';
      document.getElementById('session-divider-2').style.display = 'block';
      break;

    case 'question':
      setLoader(false, '');
      sessionState.phase = 'post';
      sessionState.questionIndex = msg.index;
      sessionState.totalQuestions = msg.total;
      setPhaseIndicator('interrogate');
      document.getElementById('session-question-counter').textContent =
        `Question ${msg.index + 1} of ${msg.total}`;
      const postPromptEl = document.getElementById('session-prompt-text');
      postPromptEl.textContent = msg.text;
      postPromptEl.classList.remove('ink-reveal');
      void postPromptEl.offsetWidth;
      postPromptEl.classList.add('ink-reveal');
      document.getElementById('session-prompt-wrap').style.display = 'block';
      const taQ = document.getElementById('session-response-input');
      taQ.placeholder = 'Your answer...';
      taQ.value = '';
      document.getElementById('session-response-area').style.display = 'flex';
      taQ.focus();
      break;

    case 'summary':
      setLoader(false, '');
      setPhaseIndicator('summary');
      document.getElementById('session-response-area').style.display = 'none';
      document.getElementById('session-prompt-wrap').style.display = 'none';
      showDebrief(msg.data);
      break;

    case 'complete':
      if (sessionState.url) {
        const art = state.articles.find(a => a.url === sessionState.url);
        if (art) {
          art.session_status = 'complete';
          state.unseenCount = state.articles.filter(a => a.session_status === 'not_started').length;
          updateFeedBadge();
        }
      }
      document.getElementById('session-start-btn').disabled = false;
      break;

    case 'error':
      if (msg.recoverable) {
        showSessionWarning(msg.message);
      } else {
        setLoader(false, '');
        showToast('Session error: ' + msg.message, 'error');
        resetSessionUI();
      }
      break;
  }
}

function submitResponse() {
  const ta = document.getElementById('session-response-input');
  const value = ta.value.trim();
  if (!value) { showToast('Please enter a response before submitting.', 'error'); return; }
  if (!sessionState.ws || sessionState.ws.readyState !== WebSocket.OPEN) {
    showToast('Connection lost. Please start a new session.', 'error');
    return;
  }
  let message;
  if (sessionState.phase === 'pre') {
    message = { type: 'response', phase: 'pre', text: value };
  } else if (sessionState.phase === 'post') {
    message = { type: 'response', phase: 'post', index: sessionState.questionIndex, text: value };
  }
  if (message) {
    const wasPrePhase = sessionState.phase === 'pre';
    sessionState.ws.send(JSON.stringify(message));
    ta.value = '';
    document.getElementById('session-response-area').style.display = 'none';
    document.getElementById('session-prompt-wrap').style.display = 'none';
    if (wasPrePhase) {
      const panel = document.getElementById('session-article-panel');
      if (panel) panel.classList.remove('locked');
    }
    setLoader(true, 'Processing…');
  }
}

function setPhaseIndicator(phase) {
  const phases = ['pre', 'read', 'interrogate', 'summary'];
  const idx = phases.indexOf(phase);
  phases.forEach((p, i) => {
    const dot = document.getElementById(`phase-dot-${p}`);
    if (!dot) return;
    dot.classList.remove('active', 'done');
    if (phase === null) return;
    if (i < idx) dot.classList.add('done');
    else if (i === idx) dot.classList.add('active');
  });
}

function renderSessionTerms(entries) {
  document.getElementById('session-terms-list').innerHTML = entries.map(e => {
    const mitre = e.mitre_reference
      ? `<span class="term-card-mitre">${esc(e.mitre_reference)}</span>` : '';
    return `
      <div class="session-term-card">
        <div class="term-card-name">${esc(e.term)}</div>
        <div class="term-card-explanation">${esc(e.plain_explanation || '')}</div>
        ${mitre}
      </div>`;
  }).join('');
}

function renderSessionSummary(data) {
  const strong = data.strong_points || [];
  const gaps   = data.gap_terms || [];
  const study  = data.recommended_entries || [];
  const li = (arr) => arr.length
    ? arr.map(s => `<li>${esc(s)}</li>`).join('')
    : '<li style="opacity:0.45">None identified</li>';
  document.getElementById('summary-strong-list').innerHTML = li(strong);
  document.getElementById('summary-gaps-list').innerHTML   = li(gaps);
  document.getElementById('summary-study-list').innerHTML  = li(study);
}

function resetSession() {
  if (sessionState.ws) { try { sessionState.ws.close(); } catch {} }
  sessionState = { ws: null, phase: null, questionIndex: 0, totalQuestions: 4, url: null, articleTitle: '', notebookEntries: [] };
  const debriefEl = document.getElementById('debrief-overlay');
  if (debriefEl) { debriefEl.style.display = 'none'; debriefEl.classList.remove('entering', 'exiting'); }
  document.getElementById('session-url').value = '';
  document.getElementById('session-panel').style.display = 'none';
  document.getElementById('session-start-btn').disabled = false;
  const articlePanel = document.getElementById('session-article-panel');
  if (articlePanel) { articlePanel.style.display = 'none'; articlePanel.classList.add('locked'); }
  const flagWidget = document.getElementById('session-flag-term');
  if (flagWidget) flagWidget.style.display = 'none';
  setLoader(false, '');
  // Close reader mode if still open
  const overlay = document.getElementById('reader-overlay');
  if (overlay && overlay.style.display !== 'none') {
    overlay.style.display = 'none';
    _readerCleanup();
  }
}

// ---------------------------------------------------------------------------
// Reader Mode — Stage 4
// ---------------------------------------------------------------------------
let _readerScrollHandler = null;

function _readerCleanup() {
  const area = document.getElementById('reader-scroll-area');
  if (area && _readerScrollHandler) {
    area.removeEventListener('scroll', _readerScrollHandler);
    _readerScrollHandler = null;
  }
}

function enterReaderMode(title, text) {
  const overlay = document.getElementById('reader-overlay');
  const titleEl = document.getElementById('reader-title');
  const bodyEl  = document.getElementById('reader-body');
  const fill    = document.getElementById('reader-progress-fill');
  const area    = document.getElementById('reader-scroll-area');

  titleEl.textContent = title;
  bodyEl.textContent  = text;
  fill.style.width    = '0%';
  area.scrollTop      = 0;

  // Scroll-based progress bar
  _readerCleanup();
  _readerScrollHandler = function() {
    const scrollable = area.scrollHeight - area.clientHeight;
    const pct = scrollable > 0 ? (area.scrollTop / scrollable) * 100 : 100;
    fill.style.width = Math.min(pct, 100) + '%';
  };
  area.addEventListener('scroll', _readerScrollHandler, { passive: true });

  overlay.style.display = 'flex';
  overlay.classList.remove('exiting');
  overlay.classList.add('entering');
  overlay.addEventListener('animationend', () => overlay.classList.remove('entering'), { once: true });
}

function exitReaderMode() {
  const overlay = document.getElementById('reader-overlay');
  overlay.classList.remove('entering');
  overlay.classList.add('exiting');
  overlay.addEventListener('animationend', () => {
    overlay.style.display = 'none';
    overlay.classList.remove('exiting');
    _readerCleanup();
  }, { once: true });
}

document.addEventListener('keydown', function(e) {
  // Ctrl+Enter — submit current session response
  if (e.ctrlKey && e.key === 'Enter') {
    const sessionActive = document.getElementById('view-session')?.classList.contains('active');
    if (sessionActive) {
      e.preventDefault();
      submitResponse();
    }
  }

  // Space — start/stop recording (session voice mode)
  if (e.key === ' ' &&
      e.target.tagName !== 'TEXTAREA' &&
      e.target.tagName !== 'INPUT') {
    const sessionActive = document.getElementById('view-session')?.classList.contains('active');
    if (sessionActive && state.voiceEnabled) {
      e.preventDefault();
      if (state.recording) {
        stopRecording();
      } else {
        startRecording();
      }
    }
  }

  // Escape — dismiss active toast
  if (e.key === 'Escape') {
    const toasts = document.querySelectorAll('.toast');
    if (toasts.length > 0) {
      toasts[toasts.length - 1].remove();
    }
  }
});

// ---------------------------------------------------------------------------
// Notebook
// ---------------------------------------------------------------------------
let notebookData = [];

async function loadNotebook() {
  try {
    notebookData = await apiFetch('/api/notebook');
    renderNotebook();
    loadSRStats();
  } catch (err) {
    showToast('Failed to load notebook: ' + err.message, 'error');
  }
}

function filterAndSortNotebook(entries, searchTerm, sortBy) {
  let result = entries;
  if (searchTerm && searchTerm.length >= 2) {
    const lower = searchTerm.toLowerCase();
    result = result.filter(e =>
      (e.term || '').toLowerCase().includes(lower) ||
      (e.plain_explanation || '').toLowerCase().includes(lower)
    );
  }
  switch (sortBy) {
    case 'alpha':
      result = [...result].sort((a, b) => (a.term || '').localeCompare(b.term || ''));
      break;
    case 'recent':
      result = [...result].sort((a, b) => (b.created_at || '') < (a.created_at || '') ? -1 : 1);
      break;
    case 'resolved_recent':
      result = [...result].sort((a, b) => (b.resolved_at || '') < (a.resolved_at || '') ? -1 : 1);
      break;
    default: // unresolved_first
      result = [...result].sort((a, b) => a.is_resolved - b.is_resolved);
  }
  return result;
}

function onNotebookSearch() { renderNotebook(); }
function onNotebookSort() {
  const sortBy = document.getElementById('notebook-sort')?.value || 'unresolved_first';
  localStorage.setItem('braincache_notebook_sort', sortBy);
  renderNotebook();
}

function renderNotebook() {
  const searchTerm = document.getElementById('notebook-search')?.value || '';
  const sortEl = document.getElementById('notebook-sort');
  const storedSort = localStorage.getItem('braincache_notebook_sort') || 'unresolved_first';
  if (sortEl && !sortEl.dataset.initialized) {
    sortEl.value = storedSort;
    sortEl.dataset.initialized = '1';
  }
  const sortBy = sortEl ? sortEl.value : storedSort;

  const filtered = filterAndSortNotebook(notebookData, searchTerm, sortBy);
  const unresolved = filtered.filter(e => !e.is_resolved);
  const resolved   = filtered.filter(e =>  e.is_resolved);
  const totalUnresolved = notebookData.filter(e => !e.is_resolved).length;
  const totalResolved   = notebookData.filter(e =>  e.is_resolved).length;
  document.getElementById('notebook-stats').textContent =
    `${totalUnresolved} unresolved · ${totalResolved} resolved`;
  document.getElementById('notebook-unresolved').innerHTML = unresolved.length
    ? unresolved.map(renderNotebookCard).join('')
    : `<div class="notebook-empty"><p>Your notebook is clear.</p></div>`;
  document.getElementById('notebook-resolved').innerHTML =
    resolved.map(renderNotebookCard).join('');
}

function renderNotebookCard(e) {
  const resolvedClass = e.is_resolved ? ' resolved' : '';
  const mitre = e.mitre_reference
    ? `<span class="nb-card-mitre">${esc(e.mitre_reference)}</span>` : '';
  const questions = e.socratic_questions || [];
  const qBlock = questions.length ? `
    <div>
      <button class="questions-toggle" onclick="toggleQuestions(${e.id})">Show questions</button>
      <ul class="card-questions-list collapsed" id="card-questions-${e.id}">
        ${questions.map((q,i) => `<li data-num="${i+1}">${esc(q)}</li>`).join('')}
      </ul>
    </div>` : '';
  const resolveBtn = e.is_resolved
    ? `<button class="btn sm" onclick="resolveEntry(${e.id},true)">Unresolve</button>`
    : `<button class="btn sm ghost-success" onclick="resolveEntry(${e.id},false)">Mark Resolved</button>`;
  const resolvedAt = (e.is_resolved && e.resolved_at)
    ? `<div class="nb-card-resolved-at">Resolved ${fmtDate(e.resolved_at)}</div>` : '';
  return `
    <div class="notebook-card${resolvedClass}" id="nb-card-${e.id}">
      <div class="nb-card-term">${esc(e.term)}</div>
      ${e.hypothesis_prompt ? `
        <div>
          <div class="card-field-label">Hypothesis</div>
          <div class="nb-card-hypothesis">${esc(e.hypothesis_prompt)}</div>
        </div>` : ''}
      ${e.plain_explanation ? `
        <div>
          <div class="card-field-label">Explanation</div>
          <div class="nb-card-explanation">${esc(e.plain_explanation)}</div>
        </div>` : ''}
      ${mitre}
      ${qBlock}
      ${e.resolution_target ? `
        <div>
          <div class="card-field-label">Resolve when you can say:</div>
          <div class="nb-card-resolution">${esc(e.resolution_target)}</div>
        </div>` : ''}
      ${resolvedAt}
      <div class="nb-card-actions">
        ${resolveBtn}
        <button class="btn sm danger" onclick="deleteEntry(${e.id})">Delete</button>
      </div>
    </div>`;
}

function toggleQuestions(id) {
  const list = document.getElementById(`card-questions-${id}`);
  if (!list) return;
  const btn = list.previousElementSibling;
  const wasCollapsed = list.classList.contains('collapsed');
  list.classList.toggle('collapsed', !wasCollapsed);
  if (btn) btn.textContent = wasCollapsed ? 'Hide questions' : 'Show questions';
}

async function resolveEntry(id, currentlyResolved) {
  try {
    await apiFetch(`/api/notebook/${id}/resolve`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_resolved: !currentlyResolved }),
    });
    await loadNotebook();
  } catch (err) {
    showToast('Failed to update entry: ' + err.message, 'error');
  }
}

async function deleteEntry(id) {
  if (!confirm('Remove this entry from your notebook?')) return;
  try {
    await apiFetch(`/api/notebook/${id}`, { method: 'DELETE' });
    await loadNotebook();
    showToast('Entry removed.', 'success');
  } catch (err) {
    showToast('Failed to delete entry: ' + err.message, 'error');
  }
}

async function addTerm() {
  const input = document.getElementById('notebook-term-input');
  const term = input.value.trim();
  if (!term) { showToast('Please enter a term.', 'error'); return; }

  const existing = notebookData.find(e => e.term.toLowerCase() === term.toLowerCase());
  if (existing) {
    showToast('Already in notebook', 'info');
    const card = document.getElementById(`nb-card-${existing.id}`);
    if (card) {
      card.style.borderColor = 'var(--accent)';
      setTimeout(() => { card.style.borderColor = ''; }, 1500);
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    return;
  }

  const btn = document.querySelector('.notebook-add-row .btn');
  if (btn) btn.disabled = true;
  try {
    await apiFetch('/api/notebook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term }),
    });
    input.value = '';
    await loadNotebook();
    showToast(`"${esc(term)}" added to notebook.`, 'success');
  } catch (err) {
    showToast('Failed to add term: ' + err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Voice status
// ---------------------------------------------------------------------------
async function checkVoiceStatus() {
  try {
    const data = await apiFetch('/api/voice/status');
    state.ttsAvailable = data.tts.available;
    state.sttAvailable = data.stt.available;

    const ttsColor = data.tts.available ? '#4ade80' : '#f87171';
    const sttColor = data.stt.available ? '#4ade80' : '#f87171';
    document.querySelectorAll('#tts-flower .tts-petal').forEach(p => p.setAttribute('fill', ttsColor));
    document.querySelectorAll('#stt-flower .stt-petal').forEach(p => p.setAttribute('fill', sttColor));

    // Show voice toggle if at least one voice component is available
    const toggleRow = document.getElementById('voice-toggle-row');
    if (toggleRow) {
      if (data.tts.available || data.stt.available) {
        toggleRow.classList.remove('voice-hidden');
        // Set default toggle state from localStorage; default on if STT available
        const stored = localStorage.getItem('braincache_voice_enabled');
        const defaultOn = stored !== null ? stored === 'true' : data.stt.available;
        const checkbox = document.getElementById('voice-toggle-input');
        if (checkbox) {
          checkbox.checked = defaultOn;
          applyVoiceToggle(defaultOn);
        }
      } else {
        toggleRow.classList.add('voice-hidden');
      }
    }

    // If MediaRecorder not supported, force text mode
    if (!window.MediaRecorder) {
      const toggleRow2 = document.getElementById('voice-toggle-row');
      if (toggleRow2) toggleRow2.classList.add('voice-hidden');
      applyVoiceToggle(false);
      if (data.stt.available) {
        showToast('Voice input not supported in this browser. Using text mode.', 'error');
      }
    }
  } catch {
    state.ttsAvailable = false;
    state.sttAvailable = false;
    document.querySelectorAll('#tts-flower .tts-petal').forEach(p => p.setAttribute('fill', '#f87171'));
    document.querySelectorAll('#stt-flower .stt-petal').forEach(p => p.setAttribute('fill', '#f87171'));
  }
}

function onVoiceToggle() {
  const checkbox = document.getElementById('voice-toggle-input');
  const enabled = checkbox ? checkbox.checked : false;
  localStorage.setItem('braincache_voice_enabled', String(enabled));
  applyVoiceToggle(enabled);
}

function applyVoiceToggle(enabled) {
  state.voiceEnabled = !!(enabled && window.MediaRecorder);
  const textarea = document.getElementById('session-response-input');
  const voiceArea = document.getElementById('voice-record-area');
  const footer = document.querySelector('.session-response-footer');
  if (!textarea || !voiceArea) return;
  if (state.voiceEnabled) {
    textarea.style.display = 'none';
    voiceArea.style.display = 'flex';
    if (footer) footer.style.display = 'none';
  } else {
    textarea.style.display = '';
    voiceArea.style.display = 'none';
    if (footer) footer.style.display = '';
  }
}

// ---------------------------------------------------------------------------
// Voice recording
// ---------------------------------------------------------------------------
let voiceRecorder = {
  mediaRecorder: null,
  chunks: [],
  recording: false,
};

function toggleRecording() {
  if (voiceRecorder.recording) {
    stopRecording();
  } else {
    startRecording();
  }
}

function startRecording() {
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    showToast('Voice input not supported in this browser. Using text mode.', 'error');
    applyVoiceToggle(false);
    return;
  }
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : '';
    const options = mimeType ? { mimeType } : {};
    voiceRecorder.chunks = [];
    voiceRecorder.mediaRecorder = new MediaRecorder(stream, options);
    voiceRecorder.mediaRecorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) voiceRecorder.chunks.push(e.data);
    };
    voiceRecorder.mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      uploadAndTranscribe();
    };
    voiceRecorder.mediaRecorder.start();
    voiceRecorder.recording = true;
    state.recording = true;

    const wrap = document.getElementById('mic-button-wrap');
    const statusEl = document.getElementById('mic-status-text');
    if (wrap) wrap.classList.add('recording');
    if (statusEl) { statusEl.textContent = 'Recording…'; statusEl.classList.remove('processing'); }
    document.getElementById('voice-transcription-wrap').style.display = 'none';
  }).catch(err => {
    showToast('Microphone access denied.', 'error');
  });
}

function stopRecording() {
  if (!voiceRecorder.mediaRecorder || !voiceRecorder.recording) return;
  voiceRecorder.recording = false;
  state.recording = false;
  voiceRecorder.mediaRecorder.stop();

  const wrap = document.getElementById('mic-button-wrap');
  const statusEl = document.getElementById('mic-status-text');
  if (wrap) wrap.classList.remove('recording');
  if (statusEl) { statusEl.textContent = 'Transcribing'; statusEl.classList.add('processing'); }
}

async function uploadAndTranscribe() {
  const statusEl = document.getElementById('mic-status-text');
  try {
    const blob = new Blob(voiceRecorder.chunks, { type: 'audio/webm' });
    const formData = new FormData();
    formData.append('audio', blob, 'recording.webm');
    const resp = await fetch('/api/session/audio', { method: 'POST', body: formData });
    if (!resp.ok) throw new Error('Upload failed');
    const data = await resp.json();
    const text = (data.text || '').trim();

    if (statusEl) { statusEl.textContent = ''; statusEl.classList.remove('processing'); }
    if (text) {
      document.getElementById('voice-transcription-display').textContent = text;
      document.getElementById('voice-transcription-wrap').style.display = 'block';
    } else {
      showToast('No speech detected. Try again.', 'error');
    }
  } catch (err) {
    if (statusEl) { statusEl.textContent = ''; statusEl.classList.remove('processing'); }
    showToast('Transcription failed. Switching to text mode.', 'error');
    applyVoiceToggle(false);
    const checkbox = document.getElementById('voice-toggle-input');
    if (checkbox) checkbox.checked = false;
  }
}

function submitVoiceResponse() {
  const display = document.getElementById('voice-transcription-display');
  const text = display ? display.textContent.trim() : '';
  if (!text) { showToast('No transcription to submit.', 'error'); return; }
  const ta = document.getElementById('session-response-input');
  if (ta) ta.value = text;
  submitResponse();
}

function reRecord() {
  document.getElementById('voice-transcription-wrap').style.display = 'none';
  document.getElementById('voice-transcription-display').textContent = '';
  document.getElementById('mic-status-text').textContent = '';
  startRecording();
}

function editTranscription() {
  const display = document.getElementById('voice-transcription-display');
  const text = display ? display.textContent.trim() : '';
  applyVoiceToggle(false);
  const checkbox = document.getElementById('voice-toggle-input');
  if (checkbox) checkbox.checked = false;
  const ta = document.getElementById('session-response-input');
  if (ta) { ta.value = text; ta.focus(); }
}

// ---------------------------------------------------------------------------
// Quick-add term from session (Stage 3)
// ---------------------------------------------------------------------------
async function quickAddTerm() {
  const input = document.getElementById('flag-term-input');
  const term = (input ? input.value : '').trim();
  if (!term) { showToast('Enter a term to flag.', 'error'); return; }

  const existing = notebookData.find(e => e.term.toLowerCase() === term.toLowerCase());
  if (existing) {
    showToast(`"${esc(term)}" already in notebook.`, 'info');
    if (input) input.value = '';
    return;
  }

  const btn = document.querySelector('.session-flag-term .btn');
  if (btn) btn.disabled = true;
  try {
    await apiFetch('/api/notebook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        term,
        source_article_url: sessionState.url || null,
      }),
    });
    if (input) input.value = '';
    await loadNotebook();
    showToast(`"${esc(term)}" flagged to notebook.`, 'success');
  } catch (err) {
    showToast('Failed to flag term: ' + err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Session UI helpers
// ---------------------------------------------------------------------------
function resetSessionUI() {
  document.getElementById('session-start-btn').disabled = false;
  setLoader(false, '');
  const overlay = document.getElementById('reader-overlay');
  if (overlay && overlay.style.display !== 'none') {
    overlay.style.display = 'none';
    _readerCleanup();
  }
  const debriefEl = document.getElementById('debrief-overlay');
  if (debriefEl && debriefEl.style.display !== 'none') {
    debriefEl.style.display = 'none';
    debriefEl.classList.remove('entering', 'exiting');
  }
}

function showSessionWarning(message) {
  const container = document.getElementById('session-warnings');
  if (!container) return;
  const c = 'var(--warn)';
  const el = document.createElement('div');
  el.className = 'session-warning';
  el.innerHTML = `<svg viewBox="0 0 9 11" width="9" height="11" fill="none" style="flex-shrink:0">
    <path d='M2.5 1 C3.5 2.5 5.5 4.5 6.5 6 C7.5 7.5 6.5 9.5 5.5 10.5' stroke='${c}' stroke-width='0.9' fill='none' stroke-linecap='round'/>
    <path d='M4.5 4.5 C6 5.5 7.5 6.5 7.5 8.5' stroke='${c}' stroke-width='0.7' fill='none' stroke-linecap='round'/>
    <path d='M3.5 3.5 C1.5 4.5 0.5 6 1 8' stroke='${c}' stroke-width='0.7' fill='none' stroke-linecap='round'/>
  </svg><span>${esc(message)}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, 8000);
}

// ---------------------------------------------------------------------------
// Article dismiss / mark read
// ---------------------------------------------------------------------------
async function markArticle(url, action, articleId) {
  try {
    await apiFetch('/api/articles/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, action }),
    });
    if (action === 'read') {
      const badge = document.getElementById(`article-status-badge-${articleId}`);
      if (badge) badge.innerHTML = `<span class="badge badge-done">Complete</span>`;
      showToast('Marked as read.', 'success');
    }
  } catch (err) {
    showToast('Failed: ' + err.message, 'error');
  }
}

async function dismissArticle(url, articleId) {
  try {
    await apiFetch('/api/articles/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, action: 'dismiss' }),
    });
    const card = document.getElementById(`article-card-${articleId}`);
    if (card) {
      card.style.transition = 'opacity 0.3s';
      card.style.opacity = '0';
      setTimeout(() => card.remove(), 300);
    }
    showToast('Article dismissed.', 'success');
  } catch (err) {
    showToast('Failed: ' + err.message, 'error');
  }
}

// ---------------------------------------------------------------------------
// Feed search
// ---------------------------------------------------------------------------
let feedSearchTimer = null;

function onFeedSearch(value) {
  clearTimeout(feedSearchTimer);
  feedSearchTimer = setTimeout(async () => {
    const countEl = document.getElementById('feed-search-count');
    if (!value || value.length < 2) {
      if (countEl) countEl.style.display = 'none';
      renderArticles();
      return;
    }
    try {
      const results = await apiFetch(`/api/articles/search?q=${encodeURIComponent(value)}`);
      if (countEl) {
        countEl.textContent = `${results.length} result${results.length !== 1 ? 's' : ''} for '${esc(value)}'`;
        countEl.style.display = 'block';
      }
      const list = document.getElementById('article-list');
      if (!results.length) {
        list.innerHTML = '<div class="empty-state">No articles match your search.</div>';
        return;
      }
      const sourceTypeMap = {};
      state.sources.forEach(s => { sourceTypeMap[s.id] = s.feed_type; });
      list.innerHTML = results.map(a => {
        const feedType = sourceTypeMap[a.source_id] || 'rss';
        const typeBadge = feedType === 'scrape'
          ? `<span class="badge badge-scrape">SCRAPE</span>`
          : `<span class="badge badge-rss">RSS</span>`;
        let statusBadge = '';
        if (a.session_status === 'in_progress') statusBadge = `<span class="badge badge-ip">In Progress</span>`;
        else if (a.session_status === 'complete') statusBadge = `<span class="badge badge-done">Complete</span>`;
        else statusBadge = `<span class="badge badge-ns">Not Started</span>`;
        const summary = a.summary ? `<div class="card-summary">${esc(a.summary)}</div>` : '';
        const urlJson = JSON.stringify(a.url);
        const rot = (((a.id * 7919 + 1234) % 700) - 350) / 1000;
        return `
          <div class="article-card" id="article-card-${a.id}" style="--card-rot:${rot}deg" onclick="openInSession(${urlJson})">
            <div class="card-top">
              <div class="card-title">${esc(a.title || a.url)}</div>
              ${typeBadge}
              <span id="article-status-badge-${a.id}">${statusBadge}</span>
            </div>
            <div class="card-meta">
              <span>${esc(a.source_name || '')}</span>
              ${a.published_date ? `<span>${fmtDate(a.published_date)}</span>` : ''}
            </div>
            ${summary}
            <div class="article-card-actions" onclick="event.stopPropagation()">
              <button class="btn sm" onclick="openInSession(${urlJson})">Study</button>
              <button class="btn sm" onclick="markArticle(${urlJson}, 'read', ${a.id})">Mark Read</button>
              <button class="btn sm danger" onclick="dismissArticle(${urlJson}, ${a.id})">Dismiss</button>
            </div>
          </div>`;
      }).join('');
    } catch (err) {
      showToast('Search failed: ' + err.message, 'error');
    }
  }, 400);
}

// ---------------------------------------------------------------------------
// Session History
// ---------------------------------------------------------------------------
async function loadHistory() {
  try {
    const sessions = await apiFetch('/api/sessions/history');
    const completed = sessions.filter(s => s.session_status === 'complete').length;
    const badge = document.getElementById('history-badge');
    if (badge) {
      badge.textContent = completed;
      badge.classList.toggle('visible', completed > 0);
    }
    const subheading = document.getElementById('history-subheading');
    if (subheading) subheading.textContent = `${completed} session${completed !== 1 ? 's' : ''} completed`;
    renderHistory(sessions);
  } catch (err) {
    showToast('Failed to load history: ' + err.message, 'error');
  }
}

function switchHistoryView(mode) {
  historyViewMode = mode;
  document.getElementById('hvt-shelf').classList.toggle('active', mode === 'shelf');
  document.getElementById('hvt-list').classList.toggle('active', mode === 'list');
  renderHistory(state.historyData);
}

function renderHistoryShelf(sessions) {
  const list = document.getElementById('history-list');
  if (!sessions.length) {
    list.innerHTML = `<div class="empty-state">No sessions completed yet. Start one from the Feed.</div>`;
    return;
  }

  const spines = sessions.map(s => {
    const h = hashStr(s.url || s.title || '');
    const color = BOOK_COLORS[h % BOOK_COLORS.length];
    const height = 130 + ((h >> 4) % 46); // 130–175px, stable per URL
    const title = s.title || s.url || 'Untitled';
    const lastActivity = s.last_activity ? fmtDate(s.last_activity) : '—';
    const urlJson = JSON.stringify(s.url);
    const isComplete = s.session_status === 'complete';

    return `
      <div class="book-spine${isComplete ? '' : ' book-spine-ip'}"
           style="--book-color:${color};--book-h:${height}px"
           onclick="openInSession(${urlJson})"
           role="button"
           tabindex="0"
           aria-label="${esc(title)}">
        <div class="book-spine-inner">
          <span class="book-title-text">${esc(title)}</span>
        </div>
        <div class="book-tooltip">
          <div class="book-tooltip-title">${esc(title)}</div>
          ${s.source_name ? `<div class="book-tooltip-meta">${esc(s.source_name)}</div>` : ''}
          <div class="book-tooltip-meta">${lastActivity}</div>
          <div class="book-tooltip-meta">${s.response_count || 0} responses</div>
          <div class="book-tooltip-actions">
            <button class="btn sm primary" onclick="event.stopPropagation();openInSession(${urlJson})">Re-study</button>
          </div>
        </div>
      </div>`;
  }).join('');

  list.innerHTML = `
    <div class="bookshelf">
      <div class="bookshelf-books">${spines}</div>
      <div class="shelf-board">
        <div class="shelf-board-front"></div>
        <div class="shelf-board-edge"></div>
      </div>
    </div>`;
}

function renderHistory(sessions) {
  state.historyData = sessions;
  if (historyViewMode === 'shelf') {
    renderHistoryShelf(sessions);
    return;
  }
  const list = document.getElementById('history-list');
  if (!list) return;
  if (!sessions.length) {
    list.innerHTML = `<div class="empty-state">No sessions completed yet. Start one from the Feed.</div>`;
    return;
  }
  list.innerHTML = sessions.map(s => {
    const statusBadge = s.session_status === 'complete'
      ? `<span class="badge badge-done">Complete</span>`
      : `<span class="badge badge-ip">In Progress</span>`;
    const lastActivity = s.last_activity ? fmtDate(s.last_activity) : '—';
    const urlJson = JSON.stringify(s.url);
    return `
      <div class="history-card">
        <div class="history-card-title">${esc(s.title || s.url)}</div>
        <div class="history-card-meta">
          ${s.source_name ? `<span class="badge badge-rss">${esc(s.source_name)}</span>` : ''}
          ${s.published_date ? `<span class="history-card-detail">${fmtDate(s.published_date)}</span>` : ''}
          ${statusBadge}
        </div>
        <div class="history-card-detail">${s.response_count || 0} responses logged · Last activity: ${lastActivity}</div>
        <div class="history-card-actions">
          <a class="btn sm" href="${esc(s.url)}" target="_blank" rel="noopener">View Article</a>
          <button class="btn sm primary" onclick="openInSession(${urlJson})">Re-study</button>
        </div>
      </div>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// Debrief overlay — Stage 6
// ---------------------------------------------------------------------------
let _debriefNotebookMap = {};

async function showDebrief(data) {
  const overlay = document.getElementById('debrief-overlay');
  if (!overlay) return;

  // Article title
  document.getElementById('debrief-article-title').textContent = sessionState.articleTitle || '';

  // Strengths
  const strong = data.strong_points || [];
  document.getElementById('debrief-strong-list').innerHTML = strong.length
    ? strong.map(s => `<li>${esc(s)}</li>`).join('')
    : '<li class="debrief-empty">None identified</li>';

  // Fetch notebook entries for gap term lookup (non-fatal)
  _debriefNotebookMap = {};
  try {
    const resp = await fetch('/api/notebook');
    if (resp.ok) {
      const entries = await resp.json();
      entries.forEach(e => {
        if (e.term) _debriefNotebookMap[e.term.toLowerCase()] = e;
      });
    }
  } catch (_) {}

  // Knowledge Gaps — clickable if notebook entry exists
  const gaps = data.gap_terms || [];
  document.getElementById('debrief-gaps-list').innerHTML = gaps.length
    ? gaps.map((g, i) => {
        const entry = _debriefNotebookMap[g.toLowerCase()];
        const hasEntry = !!entry;
        const previewHtml = hasEntry ? `
          <div class="debrief-gap-preview" id="debrief-gap-preview-${i}" style="display:none">
            ${_renderGapPreview(entry)}
          </div>` : '';
        return `
          <li class="debrief-gap-item${hasEntry ? ' has-entry' : ''}"
              ${hasEntry ? `onclick="toggleGapTermPreview(this,${i})"` : ''}>
            <div class="debrief-gap-row">
              <span class="debrief-gap-term">${esc(g)}</span>
              ${hasEntry ? '<span class="debrief-gap-expand-icon" aria-hidden="true">▾</span>' : ''}
            </div>
            ${previewHtml}
          </li>`;
      }).join('')
    : '<li class="debrief-empty">None identified</li>';

  // Terms Added to Notebook
  const terms = sessionState.notebookEntries || [];
  document.getElementById('debrief-terms-list').innerHTML = terms.length
    ? terms.map(e => `
        <div class="session-term-card">
          <div class="term-card-name">${esc(e.term)}</div>
          <div class="term-card-explanation">${esc(e.plain_explanation || '')}</div>
          ${e.mitre_reference ? `<span class="term-card-mitre">${esc(e.mitre_reference)}</span>` : ''}
        </div>`).join('')
    : '<div class="debrief-empty">No terms auto-added this session</div>';

  // Show overlay
  overlay.style.display = 'flex';
  overlay.classList.remove('entering', 'exiting');
  void overlay.offsetWidth;
  overlay.classList.add('entering');

  // Wax seal stamp
  setTimeout(() => {
    const seal = document.getElementById('debrief-wax-seal');
    if (seal) {
      seal.classList.remove('debrief-stamp');
      void seal.offsetWidth;
      seal.classList.add('debrief-stamp');
    }
  }, 350);
}

function _renderGapPreview(entry) {
  const explanation = entry.plain_explanation
    ? `<div class="debrief-preview-field">
        <div class="card-field-label">Explanation</div>
        <div class="nb-card-explanation">${esc(entry.plain_explanation)}</div>
       </div>` : '';
  const resolve = entry.resolution_target
    ? `<div class="debrief-preview-field">
        <div class="card-field-label">Resolved when you can say</div>
        <div class="nb-card-hypothesis">${esc(entry.resolution_target)}</div>
       </div>` : '';
  const mitre = entry.mitre_reference
    ? `<span class="nb-card-mitre" style="margin-top:6px;display:inline-block">${esc(entry.mitre_reference)}</span>` : '';
  return `<div class="debrief-gap-preview-card">${explanation}${resolve}${mitre}</div>`;
}

function toggleGapTermPreview(li, idx) {
  const preview = document.getElementById(`debrief-gap-preview-${idx}`);
  const icon = li.querySelector('.debrief-gap-expand-icon');
  if (!preview) return;
  const isOpen = preview.style.display !== 'none';
  preview.style.display = isOpen ? 'none' : 'block';
  if (icon) icon.textContent = isOpen ? '▾' : '▴';
  li.classList.toggle('open', !isOpen);
}

function closeDebrief() {
  const overlay = document.getElementById('debrief-overlay');
  if (!overlay) return;
  overlay.classList.remove('entering');
  overlay.classList.add('exiting');
  setTimeout(() => {
    overlay.style.display = 'none';
    overlay.classList.remove('exiting');
  }, 220);
  resetSession();
}

// ---------------------------------------------------------------------------
// Spaced Repetition — SM-2 review queue
// ---------------------------------------------------------------------------
let reviewState = {
  queue: [],
  currentIndex: 0,
  reviewedCount: 0,
};

async function loadSRStats() {
  try {
    const stats = await apiFetch('/api/notebook/sr-stats');
    updateNotebookBadge(stats.due_count);
    updateReviewBanner(stats.due_count);
  } catch (_) {}
}

function updateNotebookBadge(dueCount) {
  const badge = document.getElementById('notebook-badge');
  if (!badge) return;
  if (dueCount > 0) {
    badge.textContent = dueCount;
    badge.classList.add('visible');
  } else {
    badge.classList.remove('visible');
  }
}

function updateReviewBanner(dueCount) {
  const label = document.getElementById('review-due-label');
  const btn   = document.getElementById('review-start-btn');
  if (!label || !btn) return;
  if (dueCount > 0) {
    label.textContent = `${dueCount} term${dueCount !== 1 ? 's' : ''} due for review`;
    label.style.color = 'var(--accent)';
    btn.disabled = false;
  } else {
    label.textContent = 'All caught up — nothing due for review';
    label.style.color = 'var(--muted)';
    btn.disabled = true;
  }
}

async function startReview() {
  try {
    const queue = await apiFetch('/api/notebook/due');
    if (!queue.length) {
      showToast('Nothing due for review right now.', 'info');
      return;
    }
    reviewState.queue = queue;
    reviewState.currentIndex = 0;
    reviewState.reviewedCount = 0;

    const overlay = document.getElementById('review-overlay');
    overlay.style.display = 'flex';

    document.getElementById('review-complete').style.display = 'none';
    document.getElementById('review-card').style.display = 'block';
    document.getElementById('review-reveal-row').style.display = 'flex';
    document.getElementById('review-rating-row').style.display = 'none';

    renderReviewCard(queue[0]);
  } catch (err) {
    showToast('Failed to load review queue: ' + err.message, 'error');
  }
}

function renderReviewCard(entry) {
  const total = reviewState.queue.length;
  const idx   = reviewState.currentIndex + 1;
  document.getElementById('review-progress-text').textContent = `${idx} of ${total}`;
  document.getElementById('review-card-term').textContent = entry.term || '';

  const expEl  = document.getElementById('review-card-explanation');
  const mitreEl = document.getElementById('review-card-mitre');
  const resEl  = document.getElementById('review-card-resolution');

  // Pre-populate but hide until revealed
  expEl.textContent  = entry.plain_explanation || '';
  expEl.style.display = 'none';
  mitreEl.textContent = entry.mitre_reference ? `MITRE: ${entry.mitre_reference}` : '';
  mitreEl.style.display = 'none';
  resEl.textContent  = entry.resolution_target ? `Resolve when: ${entry.resolution_target}` : '';
  resEl.style.display = 'none';

  document.getElementById('review-card-hint').style.display = 'block';
  document.getElementById('review-reveal-row').style.display = 'flex';
  document.getElementById('review-rating-row').style.display = 'none';

  // Animate card in
  const card = document.getElementById('review-card');
  card.classList.remove('review-card-enter');
  void card.offsetWidth;
  card.classList.add('review-card-enter');
}

function revealReviewCard() {
  const entry = reviewState.queue[reviewState.currentIndex];
  if (!entry) return;

  const expEl   = document.getElementById('review-card-explanation');
  const mitreEl = document.getElementById('review-card-mitre');
  const resEl   = document.getElementById('review-card-resolution');

  if (entry.plain_explanation) expEl.style.display = 'block';
  if (entry.mitre_reference)   mitreEl.style.display = 'block';
  if (entry.resolution_target) resEl.style.display = 'block';

  document.getElementById('review-card-hint').style.display = 'none';
  document.getElementById('review-reveal-row').style.display = 'none';
  document.getElementById('review-rating-row').style.display = 'flex';
}

async function submitReview(quality) {
  const entry = reviewState.queue[reviewState.currentIndex];
  if (!entry) return;

  // Disable buttons while request is in flight
  document.querySelectorAll('.review-rating-btn').forEach(b => b.disabled = true);

  try {
    await apiFetch(`/api/notebook/${entry.id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quality }),
    });
    reviewState.reviewedCount++;
    reviewState.currentIndex++;

    if (reviewState.currentIndex >= reviewState.queue.length) {
      // All done
      showReviewComplete();
    } else {
      renderReviewCard(reviewState.queue[reviewState.currentIndex]);
    }
  } catch (err) {
    showToast('Review submission failed: ' + err.message, 'error');
    document.querySelectorAll('.review-rating-btn').forEach(b => b.disabled = false);
  }
}

function showReviewComplete() {
  document.getElementById('review-card').style.display = 'none';
  document.getElementById('review-reveal-row').style.display = 'none';
  document.getElementById('review-rating-row').style.display = 'none';
  document.getElementById('review-progress-text').textContent = '';

  const count = reviewState.reviewedCount;
  document.getElementById('review-complete-count').textContent =
    `${count} term${count !== 1 ? 's' : ''} reviewed`;
  document.getElementById('review-complete').style.display = 'flex';
}

function closeReviewMode() {
  document.getElementById('review-overlay').style.display = 'none';
  reviewState = { queue: [], currentIndex: 0, reviewedCount: 0 };
  loadNotebook();
  loadSRStats();
}

// ---------------------------------------------------------------------------
// Paste Article modal
// ---------------------------------------------------------------------------

function openPasteModal() {
  document.getElementById('paste-title').value = '';
  document.getElementById('paste-url').value = '';
  document.getElementById('paste-text').value = '';
  document.getElementById('paste-submit-btn').disabled = false;
  document.getElementById('paste-modal-overlay').style.display = 'flex';
  setTimeout(() => document.getElementById('paste-title').focus(), 50);
}

function closePasteModal() {
  document.getElementById('paste-modal-overlay').style.display = 'none';
}

function closePasteModalOnBackdrop(event) {
  if (event.target === document.getElementById('paste-modal-overlay')) {
    closePasteModal();
  }
}

async function submitPasteArticle() {
  const title = document.getElementById('paste-title').value.trim();
  const url   = document.getElementById('paste-url').value.trim();
  const text  = document.getElementById('paste-text').value.trim();

  if (!title) { showToast('Title is required.', 'error'); return; }
  if (text.length < 50) { showToast('Article text must be at least 50 characters.', 'error'); return; }

  const btn = document.getElementById('paste-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Starting…';

  try {
    const article = await apiFetch('/api/articles/paste', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, text, url: url || null }),
    });
    closePasteModal();
    // Navigate to Session tab and start immediately
    document.getElementById('session-url').value = article.url;
    switchTab('session');
    startSession();
  } catch (err) {
    showToast(`Failed to create article: ${err.message}`, 'error');
    btn.disabled = false;
    btn.textContent = 'Start Session';
  }
}

// ---------------------------------------------------------------------------
// Morning Brief
// ---------------------------------------------------------------------------
async function loadMorningBrief() {
  try {
    const data = await apiFetch('/api/morning-brief');
    renderMorningBrief(data);
  } catch (err) {
    const el = document.getElementById('brief-content');
    if (el) el.innerHTML = `<div class="empty-state" style="color:var(--danger)">Failed to load brief: ${esc(err.message)}</div>`;
  }
}

function renderMorningBrief(data) {
  // Date header
  const dateEl = document.getElementById('brief-date');
  if (dateEl) {
    const now = new Date();
    dateEl.textContent = now.toLocaleDateString(undefined, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  const el = document.getElementById('brief-content');
  if (!el) return;

  const { new_articles, due_review_count, last_session } = data;

  // ── Section 1: New Articles ──────────────────────────────────────────────
  let articlesHtml = '';
  if (!new_articles.length) {
    articlesHtml = '<p class="brief-empty">No unread articles. Poll a source to get started.</p>';
  } else {
    articlesHtml = new_articles.map(a => {
      const urlJson = JSON.stringify(a.url);
      const meta = [a.source_name, a.published_date ? fmtDate(a.published_date) : null]
        .filter(Boolean).join(' · ');
      return `
        <div class="brief-article-row">
          <div class="brief-article-info">
            <div class="brief-article-title">${esc(a.title || a.url)}</div>
            ${meta ? `<div class="brief-article-meta">${esc(meta)}</div>` : ''}
          </div>
          <button class="btn sm primary" onclick="openInSession(${urlJson})">Study</button>
        </div>`;
    }).join('');
  }

  // ── Section 2: Reviews Due ───────────────────────────────────────────────
  let reviewsHtml = '';
  if (due_review_count === 0) {
    reviewsHtml = '<p class="brief-empty">All caught up — no reviews due today.</p>';
  } else {
    reviewsHtml = `
      <div class="brief-review-row">
        <div class="brief-review-count">
          <span class="brief-review-number">${due_review_count}</span>
          <span class="brief-review-label">term${due_review_count !== 1 ? 's' : ''} due for review</span>
        </div>
        <button class="btn sm primary" onclick="switchTab('notebook'); startReview()">Start Review</button>
      </div>`;
  }

  // ── Section 3: Last Session ──────────────────────────────────────────────
  let lastSessionHtml = '';
  if (!last_session || !last_session.last_activity) {
    lastSessionHtml = '<p class="brief-empty">No completed sessions yet.</p>';
  } else {
    const when = new Date(last_session.last_activity);
    const whenStr = when.toLocaleDateString(undefined, {
      month: 'short', day: 'numeric'
    }) + ' at ' + when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    lastSessionHtml = `
      <div class="brief-last-session">
        <div class="brief-last-session-title">${esc(last_session.title || last_session.url)}</div>
        <div class="brief-last-session-meta">
          ${last_session.source_name ? esc(last_session.source_name) + ' · ' : ''}${esc(whenStr)}
          · ${last_session.response_count} response${last_session.response_count !== 1 ? 's' : ''}
        </div>
        <button class="btn sm" onclick="switchTab('history')" style="margin-top:10px">View History</button>
      </div>`;
  }

  el.innerHTML = `
    <div class="brief-section">
      <div class="brief-section-heading">
        <svg class="brief-section-ornament" viewBox="0 0 120 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M0 7 C10 3 20 11 30 7 C40 3 50 11 60 7" stroke="var(--gold-line)" stroke-width="0.75" fill="none"/>
          <circle cx="64" cy="7" r="2" fill="var(--gold-line)" opacity="0.7"/>
          <path d="M68 7 C78 3 88 11 98 7 C108 3 118 11 120 7" stroke="var(--gold-line)" stroke-width="0.75" fill="none"/>
        </svg>
        <span>Unread Articles</span>
        <svg class="brief-section-ornament" viewBox="0 0 120 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M0 7 C10 3 20 11 30 7 C40 3 50 11 60 7" stroke="var(--gold-line)" stroke-width="0.75" fill="none"/>
          <circle cx="64" cy="7" r="2" fill="var(--gold-line)" opacity="0.7"/>
          <path d="M68 7 C78 3 88 11 98 7 C108 3 118 11 120 7" stroke="var(--gold-line)" stroke-width="0.75" fill="none"/>
        </svg>
      </div>
      <div class="brief-section-body">${articlesHtml}</div>
    </div>

    <div class="brief-section">
      <div class="brief-section-heading">
        <svg class="brief-section-ornament" viewBox="0 0 120 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M0 7 C10 3 20 11 30 7 C40 3 50 11 60 7" stroke="var(--gold-line)" stroke-width="0.75" fill="none"/>
          <circle cx="64" cy="7" r="2" fill="var(--gold-line)" opacity="0.7"/>
          <path d="M68 7 C78 3 88 11 98 7 C108 3 118 11 120 7" stroke="var(--gold-line)" stroke-width="0.75" fill="none"/>
        </svg>
        <span>Notebook Reviews</span>
        <svg class="brief-section-ornament" viewBox="0 0 120 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M0 7 C10 3 20 11 30 7 C40 3 50 11 60 7" stroke="var(--gold-line)" stroke-width="0.75" fill="none"/>
          <circle cx="64" cy="7" r="2" fill="var(--gold-line)" opacity="0.7"/>
          <path d="M68 7 C78 3 88 11 98 7 C108 3 118 11 120 7" stroke="var(--gold-line)" stroke-width="0.75" fill="none"/>
        </svg>
      </div>
      <div class="brief-section-body">${reviewsHtml}</div>
    </div>

    <div class="brief-section">
      <div class="brief-section-heading">
        <svg class="brief-section-ornament" viewBox="0 0 120 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M0 7 C10 3 20 11 30 7 C40 3 50 11 60 7" stroke="var(--gold-line)" stroke-width="0.75" fill="none"/>
          <circle cx="64" cy="7" r="2" fill="var(--gold-line)" opacity="0.7"/>
          <path d="M68 7 C78 3 88 11 98 7 C108 3 118 11 120 7" stroke="var(--gold-line)" stroke-width="0.75" fill="none"/>
        </svg>
        <span>Last Session</span>
        <svg class="brief-section-ornament" viewBox="0 0 120 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M0 7 C10 3 20 11 30 7 C40 3 50 11 60 7" stroke="var(--gold-line)" stroke-width="0.75" fill="none"/>
          <circle cx="64" cy="7" r="2" fill="var(--gold-line)" opacity="0.7"/>
          <path d="M68 7 C78 3 88 11 98 7 C108 3 118 11 120 7" stroke="var(--gold-line)" stroke-width="0.75" fill="none"/>
        </svg>
      </div>
      <div class="brief-section-body">${lastSessionHtml}</div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Actors / Entity Tracker
// ---------------------------------------------------------------------------
const ENTITY_TYPE_META = {
  threat_actor: { label: 'Threat Actors', icon: '⚑' },
  malware:      { label: 'Malware & Tools', icon: '⬡' },
  technique:    { label: 'Techniques', icon: '◈' },
  cve:          { label: 'CVEs', icon: '⬗' },
};

let _actorsData = [];
let _actorArticlesCache = {};

async function loadActors() {
  const container = document.getElementById('actors-content');
  try {
    _actorsData = await apiFetch('/api/entities');
    renderActors();
  } catch (err) {
    container.innerHTML = `<div class="empty-state">Failed to load entity data: ${esc(err.message)}</div>`;
  }
}

function renderActors() {
  const container = document.getElementById('actors-content');
  if (!_actorsData.length) {
    container.innerHTML = `<div class="empty-state">No entities tracked yet. Complete sessions to start building the entity graph.</div>`;
    return;
  }

  // Group by type
  const groups = { threat_actor: [], malware: [], technique: [], cve: [] };
  for (const e of _actorsData) {
    if (groups[e.type]) groups[e.type].push(e);
  }

  let html = '';
  for (const [type, meta] of Object.entries(ENTITY_TYPE_META)) {
    const entities = groups[type];
    if (!entities.length) continue;
    html += `
    <div class="actors-group">
      <div class="actors-group-heading">
        <div class="actors-group-line"></div>
        <span class="actors-type-icon">${meta.icon}</span>
        <span>${meta.label}</span>
        <div class="actors-group-line"></div>
      </div>
      <div class="actors-entity-list">
        ${entities.map(e => renderActorCard(e)).join('')}
      </div>
    </div>`;
  }
  container.innerHTML = html;
}

function renderActorCard(entity) {
  const recurring = entity.article_count >= 2;
  const badgeClass = recurring ? 'actor-count-badge multi' : 'actor-count-badge';
  const cardClass = recurring ? 'actor-card recurring' : 'actor-card';
  const articleLabel = entity.article_count === 1 ? '1 session' : `${entity.article_count} sessions`;
  return `
  <div>
    <div class="${cardClass}" onclick="toggleActorArticles(${entity.id}, this)">
      <span class="actor-name">${esc(entity.name)}</span>
      <span class="${badgeClass}">${articleLabel}</span>
    </div>
    <div class="actor-articles-panel" id="actor-panel-${entity.id}">
      <div class="empty-state" style="font-size:11px;padding:6px 0">Loading…</div>
    </div>
  </div>`;
}

async function toggleActorArticles(entityId, cardEl) {
  const panel = document.getElementById(`actor-panel-${entityId}`);
  if (panel.classList.contains('open')) {
    panel.classList.remove('open');
    return;
  }
  panel.classList.add('open');

  if (_actorArticlesCache[entityId]) {
    renderActorArticles(entityId, _actorArticlesCache[entityId]);
    return;
  }

  try {
    const articles = await apiFetch(`/api/entities/${entityId}/articles`);
    _actorArticlesCache[entityId] = articles;
    renderActorArticles(entityId, articles);
  } catch (err) {
    panel.innerHTML = `<span style="font-size:11px;color:var(--muted)">Failed to load: ${esc(err.message)}</span>`;
  }
}

function renderActorArticles(entityId, articles) {
  const panel = document.getElementById(`actor-panel-${entityId}`);
  if (!articles.length) {
    panel.innerHTML = `<span style="font-size:11px;color:var(--muted)">No sessions found.</span>`;
    return;
  }
  panel.innerHTML = articles.map(a => {
    const dateStr = a.seen_at ? fmtDate(a.seen_at) : '';
    return `<span>
      <a class="actor-article-link" data-url="${esc(a.url)}"
         onclick="openInSession(this.dataset.url)"
         title="${esc(a.url)}">${esc(a.title || a.url)}</a>
      ${dateStr ? `<span class="actor-article-date">${dateStr}</span>` : ''}
    </span>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// Heatmap — technique coverage
// ---------------------------------------------------------------------------
let _heatmapArticlesCache = {};

async function loadHeatmap() {
  const container = document.getElementById('heatmap-content');
  try {
    const [entities, notebook] = await Promise.all([
      apiFetch('/api/entities'),
      apiFetch('/api/notebook'),
    ]);
    const techniques = entities.filter(e => e.type === 'technique');
    const mitreEntries = notebook.filter(e => e.mitre_reference && e.mitre_reference.trim());
    renderHeatmap(techniques, mitreEntries);
  } catch (err) {
    container.innerHTML = `<div class="empty-state">Failed to load: ${esc(err.message)}</div>`;
  }
}

function heatColor(count, maxCount) {
  // Returns a CSS color on a parchment→amber→gold heat scale
  if (maxCount <= 0) return 'var(--parchment-dark)';
  const t = Math.min(count / Math.max(maxCount, 1), 1);
  // Low: dim parchment border, High: bright gold
  const opacity = 0.15 + t * 0.75;
  // Background fill shifts from near-transparent to warm amber
  const r = Math.round(40 + t * 160);
  const g = Math.round(30 + t * 90);
  const b = Math.round(10 + t * 10);
  return `rgba(${r},${g},${b},${opacity})`;
}

function heatBorder(count, maxCount) {
  const t = Math.min(count / Math.max(maxCount, 1), 1);
  const opacity = 0.2 + t * 0.65;
  return `rgba(200, 169, 110, ${opacity})`;
}

function renderHeatmap(techniques, mitreEntries) {
  const container = document.getElementById('heatmap-content');

  if (!techniques.length) {
    container.innerHTML = `<div class="empty-state">No techniques tracked yet. Complete sessions to populate coverage.</div>`;
    const sec = document.getElementById('heatmap-mitre-section');
    if (sec) sec.style.display = 'none';
    return;
  }

  // Sort by article_count desc, then name asc
  const sorted = [...techniques].sort((a, b) =>
    b.article_count - a.article_count || a.name.localeCompare(b.name)
  );
  const maxCount = sorted[0].article_count || 1;

  const cells = sorted.map(e => {
    const bg = heatColor(e.article_count, maxCount);
    const border = heatBorder(e.article_count, maxCount);
    const heatClass = e.article_count >= 3 ? 'heatmap-cell hot' :
                      e.article_count >= 2 ? 'heatmap-cell warm' : 'heatmap-cell';
    const countLabel = e.article_count === 1 ? '1 session' : `${e.article_count} sessions`;
    return `
      <div class="${heatClass}" style="--cell-bg:${bg};--cell-border:${border}"
           onclick="toggleHeatmapPanel(${e.id}, this)"
           title="${esc(e.name)} — ${countLabel}">
        <span class="heatmap-cell-name">${esc(e.name)}</span>
        <span class="heatmap-cell-count">${e.article_count}</span>
        <div class="heatmap-cell-panel" id="heatmap-panel-${e.id}"></div>
      </div>`;
  }).join('');

  container.innerHTML = `<div class="heatmap-grid">${cells}</div>`;

  // MITRE references section
  const mitreSection = document.getElementById('heatmap-mitre-section');
  const mitreList = document.getElementById('heatmap-mitre-list');
  if (mitreEntries.length && mitreSection && mitreList) {
    mitreSection.style.display = 'block';
    mitreList.innerHTML = mitreEntries.map(e => `
      <div class="heatmap-mitre-row">
        <span class="heatmap-mitre-id">${esc(e.mitre_reference)}</span>
        <span class="heatmap-mitre-term">${esc(e.term)}</span>
        ${!e.is_resolved
          ? `<button class="btn sm" onclick="switchTab('notebook')" style="margin-left:auto">Review</button>`
          : `<span class="badge" style="margin-left:auto;color:var(--success);border-color:var(--success);font-size:10px">resolved</span>`}
      </div>`
    ).join('');
  } else if (mitreSection) {
    mitreSection.style.display = 'none';
  }
}

async function toggleHeatmapPanel(entityId, cellEl) {
  // Close any other open panels
  document.querySelectorAll('.heatmap-cell-panel.open').forEach(p => {
    if (p.id !== `heatmap-panel-${entityId}`) {
      p.classList.remove('open');
      p.closest('.heatmap-cell').classList.remove('expanded');
    }
  });

  const panel = document.getElementById(`heatmap-panel-${entityId}`);
  if (!panel) return;

  if (panel.classList.contains('open')) {
    panel.classList.remove('open');
    cellEl.classList.remove('expanded');
    return;
  }

  panel.classList.add('open');
  cellEl.classList.add('expanded');

  if (_heatmapArticlesCache[entityId]) {
    renderHeatmapArticles(entityId, _heatmapArticlesCache[entityId]);
    return;
  }

  panel.innerHTML = '<span style="font-size:10px;color:var(--muted)">Loading…</span>';
  try {
    const articles = await apiFetch(`/api/entities/${entityId}/articles`);
    _heatmapArticlesCache[entityId] = articles;
    renderHeatmapArticles(entityId, articles);
  } catch {
    panel.innerHTML = '<span style="font-size:10px;color:var(--muted)">Failed to load.</span>';
  }
}

function renderHeatmapArticles(entityId, articles) {
  const panel = document.getElementById(`heatmap-panel-${entityId}`);
  if (!articles.length) {
    panel.innerHTML = '<span style="font-size:10px;color:var(--muted)">No linked sessions.</span>';
    return;
  }
  panel.innerHTML = articles.map(a =>
    `<a class="heatmap-article-link" onclick="openInSession(${JSON.stringify(a.url)})"
        title="${esc(a.url)}">${esc(a.title || a.url)}</a>`
  ).join('');
}
