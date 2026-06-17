/**
 * history.js — Chat session management via localStorage.
 *
 * J2 FIX: Sessions capped at MAX_SESSIONS (50). When the cap is exceeded,
 *          the oldest sessions (by updated_at) are pruned automatically.
 * J4 FIX: LS keys imported from config.js — no magic strings.
 * J4 FIX: No DOM manipulation here. renderSidebar() is the only UI concern
 *          and it only builds a well-defined list.
 */

import {
  LS_SESSIONS_KEY,
  LS_ACTIVE_KEY,
  MAX_HISTORY_TURNS,
  MAX_SESSIONS,
} from './config.js';
import { saveHistory, deleteHistory as apiDeleteHistory } from './api.js';

// ── localStorage I/O ──────────────────────────────────────────────────────────

function _load() {
  try {
    return JSON.parse(localStorage.getItem(LS_SESSIONS_KEY) || '{}');
  } catch {
    return {};
  }
}

function _save(sessions) {
  try {
    localStorage.setItem(LS_SESSIONS_KEY, JSON.stringify(sessions));
  } catch (err) {
    // QuotaExceededError — prune oldest session and retry once
    _pruneOldest(sessions, 5);
    try { localStorage.setItem(LS_SESSIONS_KEY, JSON.stringify(sessions)); }
    catch { /* give up — too full */ }
  }
}

/** Remove the N oldest sessions by updated_at. Mutates the sessions object. */
function _pruneOldest(sessions, count = 1) {
  const sorted = Object.values(sessions).sort((a, b) => a.updated_at - b.updated_at);
  sorted.slice(0, count).forEach(s => delete sessions[s.id]);
}

function _uid() {
  return 'sess-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

function _msgId() {
  return 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
}

function _titleFrom(text) {
  return (text || '').replace(/[^\w\s.,!?]/g, '').trim().split(/\s+/).slice(0, 8).join(' ')
      || 'New chat';
}

// ── Session CRUD ───────────────────────────────────────────────────────────────

export function createSession() {
  const sessions = _load();

  // J2: Enforce session cap — prune oldest if over limit
  const sessionCount = Object.keys(sessions).length;
  if (sessionCount >= MAX_SESSIONS) {
    _pruneOldest(sessions, sessionCount - MAX_SESSIONS + 1);
  }

  const id  = _uid();
  const now = Date.now();
  sessions[id] = { id, title: 'New conversation', created_at: now, updated_at: now, messages: [] };
  _save(sessions);
  setActiveSessionId(id);
  return sessions[id];
}

export function getSession(id) {
  return _load()[id] || null;
}

export function getActiveSessionId() {
  return localStorage.getItem(LS_ACTIVE_KEY) || null;
}

export function setActiveSessionId(id) {
  localStorage.setItem(LS_ACTIVE_KEY, id);
}

export function getAllSessions() {
  return Object.values(_load()).sort((a, b) => b.updated_at - a.updated_at);
}

export function deleteSession(id) {
  const sessions = _load();
  delete sessions[id];
  _save(sessions);

  if (getActiveSessionId() === id) {
    const remaining = Object.values(sessions);
    localStorage.setItem(LS_ACTIVE_KEY, remaining.length ? remaining[0].id : '');
  }

  apiDeleteHistory(id); // .catch() is inside apiDeleteHistory — always safe
}

export function updateSessionTitle(id, title) {
  const sessions = _load();
  if (!sessions[id]) return;
  sessions[id].title = title;
  sessions[id].updated_at = Date.now();
  _save(sessions);
}

// ── Messages ───────────────────────────────────────────────────────────────────

export function addMessage(sessionId, { sender, content, cipher, thinking_steps }) {
  const sessions = _load();
  if (!sessions[sessionId]) return null;

  const msg = {
    id: _msgId(),
    sender,
    content,
    timestamp: Date.now(),
    ...(cipher         ? { cipher }         : {}),
    ...(thinking_steps ? { thinking_steps } : {}),
  };

  sessions[sessionId].messages.push(msg);
  sessions[sessionId].updated_at = Date.now();

  // Auto-title from first user message
  if (sessions[sessionId].messages.length === 1 && sender === 'user') {
    sessions[sessionId].title = _titleFrom(content);
  }

  _save(sessions);

  // Non-blocking backend sync
  const s              = sessions[sessionId];
  const historySlice   = s.messages.slice(-MAX_HISTORY_TURNS).map(m => ({
    role: m.sender === 'user' ? 'user' : 'assistant',
    content: m.content,
  }));
  saveHistory(sessionId, s.title, historySlice); // .catch() inside saveHistory

  return msg;
}

export function getMessages(sessionId) {
  return _load()[sessionId]?.messages || [];
}

export function getHistoryForAPI(sessionId) {
  return getMessages(sessionId)
    .filter(m => m.content && (m.sender === 'user' || m.sender === 'assistant'))
    .slice(-MAX_HISTORY_TURNS * 2)
    .map(m => ({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.content }));
}

// ── Sidebar rendering ──────────────────────────────────────────────────────────

/**
 * Render the session list in the sidebar.
 * This is the ONLY function in this module that touches the DOM.
 */
export function renderSidebar(activeId, onSelect, onDelete) {
  const list = document.getElementById('session-list');
  if (!list) return;

  const sessions = getAllSessions();
  list.innerHTML = '';

  if (sessions.length === 0) {
    list.innerHTML = '<p class="sessions-empty">No conversations yet.<br>Start chatting!</p>';
    return;
  }

  sessions.forEach(session => {
    const item = document.createElement('div');
    item.className = 'session-item' + (session.id === activeId ? ' active' : '');
    item.dataset.id = session.id;
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.setAttribute('aria-label', `Open conversation: ${_esc(session.title)}`);
    item.setAttribute('aria-pressed', session.id === activeId ? 'true' : 'false');

    const dateStr  = _relativeDate(session.updated_at);
    const msgCount = session.messages.length;

    item.innerHTML = `
      <div class="session-dot" aria-hidden="true"></div>
      <div class="session-info">
        <div class="session-title">${_esc(session.title)}</div>
        <div class="session-meta">${dateStr} · ${msgCount} msg${msgCount !== 1 ? 's' : ''}</div>
      </div>
      <button
        class="session-delete"
        title="Delete this conversation"
        aria-label="Delete conversation: ${_esc(session.title)}"
      >✕</button>
    `;

    item.addEventListener('click', e => {
      if (e.target.closest('.session-delete')) return;
      onSelect(session.id);
    });

    item.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(session.id); }
    });

    item.querySelector('.session-delete').addEventListener('click', e => {
      e.stopPropagation();
      onDelete(session.id);
    });

    list.appendChild(item);
  });
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _relativeDate(ts) {
  const diff  = Date.now() - ts;
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7)   return `${days}d ago`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
