/**
 * config.js — Single source of truth for all runtime constants.
 */

const _IS_DEV = window.location.hostname === 'localhost'
             || window.location.hostname === '127.0.0.1';

export const BACKEND_URL = _IS_DEV
  ? 'http://localhost:8000'
  : 'https://your-auraai-backend.onrender.com';

export const API_ROUTES = {
  health:     '/health',
  chat:       '/api/chat',
  chatStream: '/api/chat/stream',
  upload:     '/api/upload',
  history:    '/api/history',
};

export const APP_VERSION = '3.0.0';

// ── AI Models ─────────────────────────────────────────────────────────────────
export const MODELS = [
  { id: 'llama-3.3-70b-versatile',                   label: 'Llama 3.3 70B',  desc: 'Best quality · general tasks'   },
  { id: 'llama-3.1-8b-instant',                       label: 'Llama 3.1 8B',   desc: 'Ultra-fast · simple Q&A'        },
  { id: 'mixtral-8x7b-32768',                         label: 'Mixtral 8x7B',   desc: 'Long context · multilingual'    },
  { id: 'gemma2-9b-it',                               label: 'Gemma 2 9B',     desc: 'Concise · focused responses'    },
  { id: 'meta-llama/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout',  desc: 'Vision · images & PDFs'         },
];

export const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
export const VISION_MODEL  = 'meta-llama/llama-4-scout-17b-16e-instruct';
export const GROQ_MODEL    = DEFAULT_MODEL; // backwards compat

// ── History limits ────────────────────────────────────────────────────────────
export const MAX_HISTORY_TURNS = 20;
export const MAX_SESSIONS      = 50;

// ── Animation timing ──────────────────────────────────────────────────────────
export const STEP_INTERVAL_MS     = 480;
export const CIPHER_DISPLAY_MS    = 700;
export const REVEAL_CHAR_DELAY_MS = 8;

// ── localStorage keys ─────────────────────────────────────────────────────────
export const LS_SESSIONS_KEY    = 'eai_sessions';
export const LS_ACTIVE_KEY      = 'eai_active_session';
export const LS_THEME_KEY       = 'eai_theme';
export const LS_SKIP_CIPHER_KEY = 'eai_skip_cipher';
export const LS_MODEL_KEY       = 'eai_model';

// ── Accessibility ─────────────────────────────────────────────────────────────
export const REDUCE_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Retry ─────────────────────────────────────────────────────────────────────
export const HEALTH_RETRY_ATTEMPTS = 3;
export const HEALTH_RETRY_DELAY_MS = 4000;
