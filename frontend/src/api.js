/**
 * api.js — Fetch wrappers for the AuraAI backend.
 * Includes non-streaming chat, SSE streaming chat, file upload, and health.
 */

import {
  BACKEND_URL,
  API_ROUTES,
  HEALTH_RETRY_ATTEMPTS,
  HEALTH_RETRY_DELAY_MS,
} from './config.js';

// ── Custom error ───────────────────────────────────────────────────────────────

export class APIError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name   = 'APIError';
    this.status = status;
  }
}

// ── Request counter (tracks RateLimit-Remaining from response headers) ─────────

let _requestsRemaining = null;
let _onCounterUpdate   = null;

export function onRequestCounterUpdate(cb) { _onCounterUpdate = cb; }
export function getRequestsRemaining()     { return _requestsRemaining; }

function _readRateLimitHeader(headers) {
  const remaining = headers.get('RateLimit-Remaining') ?? headers.get('X-RateLimit-Remaining');
  if (remaining !== null) {
    _requestsRemaining = parseInt(remaining, 10);
    _onCounterUpdate?.(_requestsRemaining);
  }
}

// ── Core request wrapper ───────────────────────────────────────────────────────

async function _request(path, opts = {}, timeout = 90_000) {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeout);
  const url        = `${BACKEND_URL}${path}`;

  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(timer);
    _readRateLimitHeader(res.headers);

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try { const err = await res.json(); detail = err.detail || err.error || err.message || detail; }
      catch { /* ignore */ }
      throw new APIError(detail, res.status);
    }

    return await res.json();
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError')   throw new APIError('Request timed out.', 408);
    if (err instanceof APIError)     throw err;
    throw new APIError(`Network error: ${err.message}`, 0);
  }
}

// ── Health check with cold-start retry ────────────────────────────────────────

export async function checkHealth(onStatusUpdate) {
  for (let attempt = 1; attempt <= HEALTH_RETRY_ATTEMPTS; attempt++) {
    try {
      onStatusUpdate?.(`Connecting… (attempt ${attempt}/${HEALTH_RETRY_ATTEMPTS})`);
      return await _request(API_ROUTES.health, {}, 15_000);
    } catch (err) {
      if (attempt < HEALTH_RETRY_ATTEMPTS) {
        onStatusUpdate?.('Backend waking up… (Render cold start ~30s)');
        await _sleep(HEALTH_RETRY_DELAY_MS);
      } else {
        throw err;
      }
    }
  }
}

// ── Chat — non-streaming (fallback) ───────────────────────────────────────────

export async function sendChat(payload) {
  return _request(API_ROUTES.chat, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  }, 90_000);
}

// ── Chat — streaming SSE ───────────────────────────────────────────────────────

/**
 * Stream a chat response via SSE.
 *
 * @param {object}   payload              - Same shape as sendChat payload
 * @param {object}   handlers
 * @param {function} handlers.onToken     - called with each text token string
 * @param {function} handlers.onDone      - called with { model } when stream ends
 * @param {function} handlers.onError     - called with APIError on failure
 * @returns {{ abort: function }}         - call abort() to cancel mid-stream
 */
export function sendChatStream(payload, { onToken, onDone, onError } = {}) {
  const controller = new AbortController();

  (async () => {
    let res;
    try {
      res = await fetch(`${BACKEND_URL}${API_ROUTES.chatStream}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal:  controller.signal,
      });
    } catch (err) {
      if (err.name !== 'AbortError') onError?.(new APIError(`Network error: ${err.message}`, 0));
      return;
    }

    _readRateLimitHeader(res.headers);

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try { const e = await res.json(); detail = e.error || e.detail || detail; } catch {}
      onError?.(new APIError(detail, res.status));
      return;
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          try {
            const parsed = JSON.parse(raw);
            if (parsed.error) { onError?.(new APIError(parsed.error)); return; }
            if (parsed.token) { onToken?.(parsed.token); }
            if (parsed.done)  { onDone?.({ model: parsed.model }); return; }
          } catch { /* malformed chunk */ }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') onError?.(new APIError(err.message));
    }

    onDone?.({});
  })();

  return { abort: () => controller.abort() };
}

// ── File upload ───────────────────────────────────────────────────────────────

export async function uploadFile(file) {
  const form = new FormData();
  form.append('file', file);
  return _request(API_ROUTES.upload, { method: 'POST', body: form }, 120_000);
}

// ── History ───────────────────────────────────────────────────────────────────

export async function saveHistory(sessionId, title, messages) {
  return _request(API_ROUTES.history, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ session_id: sessionId, title, messages }),
  }).catch(() => {});
}

export async function fetchHistory(sessionId) {
  return _request(`${API_ROUTES.history}/${sessionId}`);
}

export async function deleteHistory(sessionId) {
  return _request(`${API_ROUTES.history}/${sessionId}`, { method: 'DELETE' }).catch(() => {});
}

// ── Utility ───────────────────────────────────────────────────────────────────

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
