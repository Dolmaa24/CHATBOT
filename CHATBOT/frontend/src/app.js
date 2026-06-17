/**
 * app.js — Application entry point and orchestrator.
 * Handles theme, sessions, model selector, request counter, crypto inspector.
 */

import { LS_THEME_KEY, LS_MODEL_KEY, MODELS, DEFAULT_MODEL } from './config.js';
import { checkHealth, onRequestCounterUpdate }               from './api.js';
import { sendMessage, isBusy, renderHistory,
         setActiveModel, closeCryptoInspector }              from './chat.js';
import {
  createSession, getSession, getActiveSessionId, setActiveSessionId,
  getAllSessions, deleteSession, getMessages, renderSidebar,
} from './history.js';
import { initFileUpload, isUploading } from './fileUpload.js';
import { startListening, stopListening, isListening, STT_SUPPORTED } from './voice.js';

// ══════════════════════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════════════════════

const State = {
  sessionId:    null,
  theme:        'light',
  sidebarOpen:  false,
  sending:      false,
  activeModel:  DEFAULT_MODEL,
};

// ══════════════════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════════════════

async function init() {
  State.theme = document.documentElement.getAttribute('data-theme') || 'light';
  _syncThemeButton(false);

  // Session bootstrap
  let activeId = getActiveSessionId();
  if (!activeId || !getSession(activeId)) {
    const sess = createSession();
    activeId = sess.id;
  }
  State.sessionId = activeId;

  _refreshSidebar();
  _loadSession(activeId);
  _buildModelSelector();
  _bindEvents();

  // Pass onImageAttach callback so fileUpload.js can auto-switch model
  initFileUpload((isImage) => {
    const target = isImage ? 'meta-llama/llama-4-scout-17b-16e-instruct' : State.activeModel;
    _setModel(target, isImage); // don't persist auto-switch
  });

  // Request counter
  onRequestCounterUpdate(_updateRequestCounter);

  _pingBackend();
  document.getElementById('message-input')?.focus();
}

// ══════════════════════════════════════════════════════════════════════════════
// THEME
// ══════════════════════════════════════════════════════════════════════════════

function _syncThemeButton(animate) {
  const btn  = document.getElementById('btn-theme');
  const icon = btn?.querySelector('.theme-icon');
  if (icon) icon.textContent = State.theme === 'dark' ? '☀️' : '🌙';
  btn?.setAttribute('aria-label', State.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  if (animate && btn) {
    btn.classList.add('theme-toggling');
    setTimeout(() => btn.classList.remove('theme-toggling'), 500);
  }
}

function toggleTheme() {
  State.theme = State.theme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', State.theme);
  localStorage.setItem(LS_THEME_KEY, State.theme);
  _syncThemeButton(true);
}

// ══════════════════════════════════════════════════════════════════════════════
// MODEL SELECTOR
// ══════════════════════════════════════════════════════════════════════════════

function _buildModelSelector() {
  const select = document.getElementById('model-select');
  if (!select) return;

  // Restore last used model from localStorage
  const saved = localStorage.getItem(LS_MODEL_KEY);
  const initial = MODELS.find(m => m.id === saved)?.id || DEFAULT_MODEL;
  State.activeModel = initial;
  setActiveModel(initial);

  MODELS.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    opt.title = m.desc;
    if (m.id === initial) opt.selected = true;
    select.appendChild(opt);
  });
}

function _setModel(modelId, temporary = false) {
  const select = document.getElementById('model-select');
  if (select) select.value = modelId;
  setActiveModel(modelId);
  if (!temporary) {
    State.activeModel = modelId;
    localStorage.setItem(LS_MODEL_KEY, modelId);
  }
  // Update model desc tooltip
  const model = MODELS.find(m => m.id === modelId);
  const desc  = document.getElementById('model-desc');
  if (desc && model) desc.textContent = model.desc;
}

// ══════════════════════════════════════════════════════════════════════════════
// REQUEST COUNTER
// ══════════════════════════════════════════════════════════════════════════════

function _updateRequestCounter(remaining) {
  const counter = document.getElementById('req-counter');
  const label   = document.getElementById('req-remaining');
  if (!counter || !label) return;
  label.textContent = remaining;
  counter.style.display = 'flex';
  // Warn visually when low
  counter.classList.toggle('req-counter--warn', remaining <= 20);
}

// ══════════════════════════════════════════════════════════════════════════════
// SESSION MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

function _loadSession(id) {
  State.sessionId = id;
  setActiveSessionId(id);
  const session = getSession(id);
  const nameEl  = document.getElementById('header-session-name');
  if (nameEl) nameEl.textContent = session?.title || '';
  const chatArea = document.getElementById('chat-area');
  renderHistory(chatArea, getMessages(id));
}

function _switchSession(id) {
  if (id === State.sessionId) { _closeMobileSidebar(); return; }
  _loadSession(id);
  _refreshSidebar();
  _closeMobileSidebar();
}

function _newSession() {
  const sess = createSession();
  State.sessionId = sess.id;
  _refreshSidebar();
  _loadSession(sess.id);
  _closeMobileSidebar();
  document.getElementById('message-input')?.focus();
}

function _deleteSession(id) {
  deleteSession(id);
  const remaining = getAllSessions();
  if (remaining.length === 0) {
    _newSession();
  } else if (id === State.sessionId) {
    _loadSession(remaining[0].id);
  }
  _refreshSidebar();
  showToast('Conversation deleted', 'info');
}

function _refreshSidebar() {
  renderSidebar(State.sessionId, _switchSession, _deleteSession);
}

// ══════════════════════════════════════════════════════════════════════════════
// SEND
// ══════════════════════════════════════════════════════════════════════════════

async function _send() {
  if (State.sending || isBusy() || isUploading()) return;

  const input   = document.getElementById('message-input');
  const sendBtn = document.getElementById('btn-send');
  const text    = input?.value.trim();
  if (!text) return;

  State.sending = true;
  if (input)   { input.value = ''; input.style.height = 'auto'; }
  if (sendBtn) sendBtn.disabled = true;

  try {
    await sendMessage(State.sessionId, text);
    _refreshSidebar();
  } catch (err) {
    showToast(`Send failed: ${err.message}`, 'error');
  } finally {
    State.sending = false;
    if (sendBtn) sendBtn.disabled = !(input?.value.trim());
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// VOICE
// ══════════════════════════════════════════════════════════════════════════════

function _setVoiceState(state) {
  const btn         = document.getElementById('btn-voice');
  const voiceStatus = document.getElementById('voice-status');
  const labels = {
    idle:      { label: 'Start voice input', pressed: 'false', cls: '' },
    recording: { label: 'Stop recording',    pressed: 'true',  cls: 'btn-voice-rec' },
  };
  const cfg = labels[state] || labels.idle;
  btn?.setAttribute('aria-label',  cfg.label);
  btn?.setAttribute('aria-pressed', cfg.pressed);
  btn?.classList.toggle('btn-voice-rec', cfg.cls === 'btn-voice-rec');
  voiceStatus?.classList.toggle('visible', state === 'recording');
}

function _toggleVoice() {
  if (!STT_SUPPORTED) { showToast('Speech recognition requires Chrome or Edge.', 'warn'); return; }
  if (isListening()) { stopListening(); _setVoiceState('idle'); return; }
  const input = document.getElementById('message-input');
  const started = startListening({
    onInterim: t => { if (input) { input.value = t; _autoResize(input); } },
    onFinal:   t => {
      if (input) { input.value = t; _autoResize(input); }
      const sendBtn = document.getElementById('btn-send');
      if (sendBtn) sendBtn.disabled = !t;
    },
    onEnd:   () => _setVoiceState('idle'),
    onError: msg => { _setVoiceState('idle'); showToast(msg, 'error'); },
  });
  if (started) _setVoiceState('recording');
}

// ══════════════════════════════════════════════════════════════════════════════
// SIDEBAR (MOBILE)
// ══════════════════════════════════════════════════════════════════════════════

function _toggleMobileSidebar() {
  const sidebar  = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  State.sidebarOpen = !State.sidebarOpen;
  if (window.innerWidth <= 768) {
    sidebar?.classList.toggle('open', State.sidebarOpen);
    if (backdrop) backdrop.style.display = State.sidebarOpen ? 'block' : 'none';
  } else {
    document.getElementById('app')?.classList.toggle('sidebar-hidden');
  }
  document.getElementById('btn-sidebar-toggle')?.setAttribute('aria-expanded', String(State.sidebarOpen));
}

function _closeMobileSidebar() {
  if (window.innerWidth <= 768) {
    document.getElementById('sidebar')?.classList.remove('open');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (backdrop) backdrop.style.display = 'none';
    State.sidebarOpen = false;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// HEALTH CHECK
// ══════════════════════════════════════════════════════════════════════════════

async function _pingBackend() {
  const statusEl = document.getElementById('footer-status');
  try {
    const data = await checkHealth(status => {
      if (statusEl) statusEl.textContent = status;
    });
    if (statusEl) statusEl.textContent = `Connected · ${data.model || DEFAULT_MODEL}`;
    document.getElementById('enc-pill')?.style.setProperty('display', 'inline-flex');
  } catch {
    if (statusEl) statusEl.textContent = '⚠ Backend offline';
    showToast('Backend unreachable after 3 attempts. Check BACKEND_URL in config.js.', 'error');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// EVENT BINDINGS
// ══════════════════════════════════════════════════════════════════════════════

function _bindEvents() {
  document.getElementById('btn-new-chat')?.addEventListener('click', _newSession);
  document.getElementById('btn-sidebar-toggle')?.addEventListener('click', _toggleMobileSidebar);
  document.getElementById('sidebar-backdrop')?.addEventListener('click', _closeMobileSidebar);
  document.getElementById('btn-theme')?.addEventListener('click', toggleTheme);
  document.getElementById('btn-voice')?.addEventListener('click', _toggleVoice);
  document.getElementById('btn-send')?.addEventListener('click', _send);
  document.getElementById('btn-close-inspector')?.addEventListener('click', closeCryptoInspector);

  // Model selector
  document.getElementById('model-select')?.addEventListener('change', e => {
    _setModel(e.target.value);
    const model = MODELS.find(m => m.id === e.target.value);
    if (model) showToast(`Switched to ${model.label}`, 'info');
  });

  // Enter to send; Shift+Enter for newline
  document.getElementById('message-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _send(); }
  });

  document.getElementById('message-input')?.addEventListener('input', e => {
    _autoResize(e.target);
    const sendBtn = document.getElementById('btn-send');
    if (sendBtn) sendBtn.disabled = !e.target.value.trim();
  });

  // Time-based greeting
  const greetEl = document.getElementById('welcome-greeting');
  if (greetEl) {
    const h = new Date().getHours();
    greetEl.textContent = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }

  // Welcome cards / chips
  document.querySelectorAll('[data-prompt]').forEach(el => {
    el.addEventListener('click', () => {
      const input = document.getElementById('message-input');
      if (!input) return;
      input.value = el.dataset.prompt;
      input.focus();
      _autoResize(input);
      const sendBtn = document.getElementById('btn-send');
      if (sendBtn) sendBtn.disabled = false;
    });
  });

  // Close inspector when clicking outside panel
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeCryptoInspector();
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════════════════════════════════════════

export function showToast(message, type = 'info') {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const icons = { success: '✓', error: '✕', info: 'ℹ', warn: '⚠' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'assertive');
  toast.innerHTML = `<span aria-hidden="true">${icons[type] || 'ℹ'}</span> <span>${_esc(message)}</span>`;
  root.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}

// ══════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════════════════════════

function _autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

function _esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ══════════════════════════════════════════════════════════════════════════════
// BOOT
// ══════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', init);
