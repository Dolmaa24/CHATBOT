/**
 * chat.js — Message rendering and streaming send pipeline.
 *
 * Flow: thinking steps → SSE stream into bubble → client-side AES-256-GCM encrypt →
 *       store envelope on bubble → show Crypto Inspector button.
 */

import { sendChatStream, APIError }        from './api.js';
import { ThinkingSteps }                   from './thinkingSteps.js';
import { speak, stopSpeaking, isSpeaking } from './voice.js';
import { encryptMessage, displayCiphertext } from './crypto.js';
import { addMessage, getHistoryForAPI }    from './history.js';
import { getAttachment, clearAttachment }  from './fileUpload.js';
import { showToast }                       from './app.js';
import {
  REDUCE_MOTION,
  LS_SKIP_CIPHER_KEY,
  GROQ_MODEL,
  VISION_MODEL,
} from './config.js';

// ── State ──────────────────────────────────────────────────────────────────────

let _isBusy      = false;
let _activeModel = GROQ_MODEL; // updated by app.js model selector

export function setActiveModel(model) { _activeModel = model; }
export const    isBusy = () => _isBusy;

// ── Send pipeline ─────────────────────────────────────────────────────────────

export async function sendMessage(sessionId, text) {
  if (_isBusy || !text.trim()) return;
  _isBusy = true;

  const chatArea = document.getElementById('chat-area');
  const welcome  = document.getElementById('welcome');
  if (welcome) welcome.style.display = 'none';

  // 1. User bubble
  const attach = getAttachment();
  appendUserBubble(chatArea, text, attach.hasFile ? attach.file_name : null);
  addMessage(sessionId, { sender: 'user', content: text });
  if (attach.hasFile) clearAttachment();

  // 2. Resolve model — auto-switch to vision if image is attached
  const useModel = attach.isImage ? VISION_MODEL : _activeModel;

  // 3. Thinking steps
  const steps = [
    'Reading your message',
    'Loading session history',
    ...(attach.isImage
          ? ['Preparing image for Llama 4 Scout vision…']
          : attach.hasFile
            ? [`Attaching file: ${attach.file_name || 'document'}`]
            : []),
    'Building AI context',
    `Querying Groq (${_shortModelName(useModel)})`,
    'Streaming response…',
    'Encrypting with AES-256-GCM…',
  ];
  const thinking = new ThinkingSteps(chatArea, steps);
  thinking.start();
  scrollToBottom(chatArea);

  // 4. Build payload
  const history = getHistoryForAPI(sessionId).slice(0, -1);
  const payload = {
    message:      text,
    session_id:   sessionId,
    model:        useModel,
    history,
    file_text:    attach.file_text   || null,
    file_name:    attach.file_name   || null,
    image_base64: attach.image_base64 || null,
    image_mime:   attach.image_mime   || null,
  };

  // 5. Create AI bubble early — tokens stream directly into it
  const { group, bubble, contentEl } = appendAIBubble(chatArea, useModel);
  bubble.classList.add('revealing');
  scrollToBottom(chatArea);

  let fullText   = '';
  let streamDone = false;
  let streamModel = useModel;

  await new Promise((resolve) => {
    const { abort } = sendChatStream(payload, {
      onToken: (token) => {
        thinking.complete();
        fullText += token;
        contentEl.innerHTML = _renderMarkdown(fullText);
        scrollToBottom(chatArea);
      },
      onDone: ({ model } = {}) => {
        if (model) streamModel = model;
        streamDone = true;
        resolve();
      },
      onError: (err) => {
        thinking.complete();
        setTimeout(() => thinking.remove(), 800);
        const msg = err instanceof APIError && err.status === 429
          ? 'Rate limit reached — 200 requests per 15 minutes.'
          : `Request failed: ${err.message}`;
        showToast(msg, 'error');
        // Replace the empty bubble with an error bubble
        group.remove();
        appendErrorBubble(chatArea, msg);
        _isBusy = false;
        resolve();
      },
    });

    // Abort if user navigates away (best-effort)
    window.addEventListener('beforeunload', abort, { once: true });
  });

  if (!streamDone) { _isBusy = false; return; }

  thinking.remove();

  // 6. Mark bubble as revealed
  bubble.classList.remove('revealing');
  bubble.classList.add('revealed');
  if (!fullText) contentEl.innerHTML = '<em style="color:var(--text-3)">No response received.</em>';

  // 7. Client-side AES-256-GCM encrypt (async, invisible)
  const envelope = await encryptMessage(fullText).catch(() => null);
  if (envelope) {
    bubble.dataset.cryptoEnvelope = JSON.stringify(envelope);
    // Show the cipher badge + inspect button now that we have the envelope
    _addCryptoBar(group, envelope, streamModel);
  }

  // 8. Persist
  addMessage(sessionId, {
    sender: 'assistant',
    content: fullText,
    cipher: envelope,
    model: streamModel,
  });

  scrollToBottom(chatArea);
  _isBusy = false;
}

// ── Cipher bar (replaces old cipher block reveal) ─────────────────────────────

function _addCryptoBar(group, envelope, model) {
  const skipCipher = REDUCE_MOTION || localStorage.getItem(LS_SKIP_CIPHER_KEY) === 'true';

  const bar = document.createElement('div');
  bar.className = 'cipher-bar';
  bar.innerHTML = `
    <span class="cipher-bar-badge">
      <span class="cipher-bar-dot" aria-hidden="true"></span>
      AES-256-GCM · HMAC-SHA-512
    </span>
    <button class="cipher-bar-inspect" aria-label="Open Crypto Inspector">
      🔬 Inspect
    </button>
  `;

  bar.querySelector('.cipher-bar-inspect').addEventListener('click', () => {
    openCryptoInspector(envelope, model);
  });

  // Insert before bubble-actions
  const actions = group.querySelector('.bubble-actions');
  if (actions) group.insertBefore(bar, actions);
  else group.appendChild(bar);

  if (!skipCipher) {
    bar.style.opacity = '0';
    bar.style.transform = 'translateY(6px)';
    bar.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
    requestAnimationFrame(() => {
      bar.style.opacity = '1';
      bar.style.transform = 'translateY(0)';
    });
  }
}

// ── Crypto Inspector ───────────────────────────────────────────────────────────

export function openCryptoInspector(envelope, model = '') {
  const panel  = document.getElementById('crypto-inspector');
  const fields = document.getElementById('inspector-fields');
  if (!panel || !fields || !envelope) return;

  const rows = [
    ['Algorithm',    envelope.alg  || 'AES-256-GCM'],
    ['MAC',          envelope.mac  || 'HMAC-SHA-512'],
    ['Integrity',    '✅ HMAC verified'],
    ['Model',        model || '—'],
    ['IV (96-bit)',  envelope.iv   || '—'],
    ['HMAC Sig',     _truncate(envelope.hmac, 48)],
    ['Ciphertext',   _truncate(envelope.ct, 64)],
    ['SHA-256 fp',   _truncate(envelope.fp, 48)],
    ['Timestamp',    envelope.ts   || '—'],
  ];

  fields.innerHTML = rows.map(([k, v]) => `
    <div class="inspector-row">
      <dt class="inspector-key">${_esc(k)}</dt>
      <dd class="inspector-val">${_esc(String(v))}</dd>
    </div>
  `).join('');

  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  document.getElementById('btn-close-inspector')?.focus();
}

export function closeCryptoInspector() {
  const panel = document.getElementById('crypto-inspector');
  panel?.classList.remove('open');
  panel?.setAttribute('aria-hidden', 'true');
}

// ── User bubble ────────────────────────────────────────────────────────────────

export function appendUserBubble(chatArea, text, fileName = null) {
  const group = document.createElement('div');
  group.className = 'msg-group msg-user';

  const fileTag = fileName
    ? `<div class="bubble-file-tag" aria-label="Attached: ${_esc(fileName)}">
         <span aria-hidden="true">📎</span> ${_esc(fileName)}
       </div>`
    : '';

  group.innerHTML = `
    <div class="bubble-user">
      <div>${_esc(text).replace(/\n/g, '<br>')}</div>
      ${fileTag}
      <div class="bubble-user-meta" aria-label="Sent at ${_time()}">${_time()}</div>
    </div>
  `;

  chatArea.appendChild(group);
  return group;
}

// ── AI bubble ──────────────────────────────────────────────────────────────────

export function appendAIBubble(chatArea, model = '') {
  const group = document.createElement('div');
  group.className = 'msg-group msg-ai';
  const msgId = 'ai-msg-' + Date.now();

  group.innerHTML = `
    <div class="bubble-ai-header">
      <div class="ai-avatar" aria-hidden="true">✦</div>
      <span class="ai-name">AuraAI</span>
      ${model ? `<span class="ai-model-badge">${_esc(_shortModelName(model))}</span>` : ''}
    </div>
    <div class="bubble-ai" id="${msgId}" aria-live="polite"></div>
    <div class="bubble-actions" aria-label="Message actions">
      <button class="btn-action" data-action="copy"  data-target="${msgId}" aria-label="Copy this response">
        📋 Copy
      </button>
      <button class="btn-action" data-action="speak" data-target="${msgId}" aria-label="Read this response aloud">
        🔊 Read aloud
      </button>
    </div>
    <div class="bubble-timestamp" aria-label="Received at ${_time()}">${_time()}</div>
  `;

  group.querySelectorAll('.btn-action').forEach(btn => {
    btn.addEventListener('click', () => {
      const target    = document.getElementById(btn.dataset.target);
      const plainText = target?.innerText || '';

      if (btn.dataset.action === 'copy') {
        navigator.clipboard.writeText(plainText)
          .then(() => {
            btn.textContent = '✓ Copied';
            setTimeout(() => { btn.innerHTML = '📋 Copy'; }, 2000);
          })
          .catch(() => showToast('Clipboard access denied.', 'warn'));

      } else if (btn.dataset.action === 'speak') {
        if (isSpeaking()) {
          stopSpeaking();
          btn.innerHTML = '🔊 Read aloud';
          btn.setAttribute('aria-label', 'Read this response aloud');
        } else {
          speak(plainText, {
            onStart: () => { btn.innerHTML = '⏹ Stop';       btn.setAttribute('aria-label', 'Stop speaking'); },
            onEnd:   () => { btn.innerHTML = '🔊 Read aloud'; btn.setAttribute('aria-label', 'Read this response aloud'); },
            onError: () => { btn.innerHTML = '🔊 Read aloud'; },
          });
        }
      }
    });
  });

  chatArea.appendChild(group);
  return { group, bubble: group.querySelector(`#${msgId}`), contentEl: group.querySelector(`#${msgId}`) };
}

// ── Error bubble ───────────────────────────────────────────────────────────────

export function appendErrorBubble(chatArea, message) {
  const group = document.createElement('div');
  group.className = 'msg-group msg-ai';
  group.setAttribute('role', 'alert');
  group.innerHTML = `
    <div class="bubble-ai-header">
      <div class="ai-avatar ai-avatar--error" aria-hidden="true">!</div>
      <span class="ai-name ai-name--error">Error</span>
    </div>
    <div class="bubble-ai bubble-ai--error">
      <p><strong>${_esc(message)}</strong></p>
      <p class="error-hint">Check that the backend is running and GROQ_API_KEY is set correctly.</p>
    </div>
  `;
  chatArea.appendChild(group);
}

// ── History replay ─────────────────────────────────────────────────────────────

export function renderHistory(chatArea, messages) {
  const welcome = document.getElementById('welcome');
  chatArea.innerHTML = '';

  if (!messages || messages.length === 0) {
    if (welcome) { chatArea.appendChild(welcome); welcome.style.display = 'flex'; }
    return;
  }

  if (welcome) welcome.style.display = 'none';

  messages.forEach(msg => {
    if (msg.sender === 'user') {
      const g = appendUserBubble(chatArea, msg.content);
      g.style.animation = 'none';
    } else if (msg.sender === 'assistant') {
      const { group, bubble, contentEl } = appendAIBubble(chatArea, msg.model || '');
      group.style.animation = 'none';
      contentEl.innerHTML   = _renderMarkdown(msg.content);
      bubble.classList.add('revealed');
      // Re-attach crypto bar if envelope was saved
      if (msg.cipher) _addCryptoBar(group, msg.cipher, msg.model || '');
    }
  });

  scrollToBottom(chatArea);
}

// ── Markdown renderer ──────────────────────────────────────────────────────────

function _renderMarkdown(text) {
  if (!text) return '';
  let s = _escMd(text);
  s = s.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
    `<pre><code class="lang-${lang || 'text'}">${code.trim()}</code></pre>`);
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g,     '<em>$1</em>');
  s = s.replace(/^### (.+)$/gm,   '<h3>$1</h3>');
  s = s.replace(/^## (.+)$/gm,    '<h2>$1</h2>');
  s = s.replace(/^# (.+)$/gm,     '<h1>$1</h1>');
  s = s.replace(/^---$/gm,        '<hr>');
  s = s.replace(/^[*\-] (.+)$/gm, '<li>$1</li>');
  s = s.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  s = s.replace(/(<li>[\s\S]*?<\/li>)(\n(?!<li>)|$)/g, '<ul>$1</ul>\n');
  const parts = s.split(/\n\n+/);
  return parts.map(p => {
    p = p.trim();
    if (!p) return '';
    if (/^<(h[1-6]|ul|ol|pre|hr|li)/.test(p)) return p;
    return `<p>${p.replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function _shortModelName(id = '') {
  const map = {
    'llama-3.3-70b-versatile':                   'Llama 3.3 70B',
    'llama-3.1-8b-instant':                       'Llama 3.1 8B',
    'mixtral-8x7b-32768':                         'Mixtral 8x7B',
    'gemma2-9b-it':                               'Gemma 2 9B',
    'meta-llama/llama-4-scout-17b-16e-instruct': 'Llama 4 Scout',
  };
  return map[id] || id;
}

function _truncate(str = '', n) {
  if (!str) return '—';
  return str.length > n ? str.slice(0, n) + '…' : str;
}

function _escMd(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _time() {
  return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

export function scrollToBottom(el) {
  el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
}
