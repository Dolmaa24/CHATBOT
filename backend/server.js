/**
 * AuraAI Backend — Groq API Proxy
 * Node.js + Express. Streaming SSE + vision + multi-model.
 */

require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const crypto    = require('crypto');
const multer    = require('multer');
const path      = require('path');

const app  = express();
const PORT = process.env.PORT || 8000;

// ── Middleware ─────────────────────────────────────────────────────────────────

app.use(express.json({ limit: '50mb' }));

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5500,http://127.0.0.1:5500')
  .split(',').map(o => o.trim());

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept', 'Authorization'],
  exposedHeaders: ['RateLimit-Remaining', 'RateLimit-Limit', 'RateLimit-Reset'],
}));

// 200 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) =>
    res.status(429).json({ error: 'Rate limit reached — 200 requests per 15 minutes.' }),
});
app.use('/api/', limiter);

// ── Allowed models ────────────────────────────────────────────────────────────

const ALLOWED_MODELS = new Set([
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'mixtral-8x7b-32768',
  'gemma2-9b-it',
  'meta-llama/llama-4-scout-17b-16e-instruct',
]);

const DEFAULT_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

function _resolveModel(requested) {
  if (requested && ALLOWED_MODELS.has(requested)) return requested;
  return DEFAULT_MODEL;
}

// ── System prompt ──────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are AuraAI, a smart and friendly AI assistant inside an encrypted chat app powered by Groq.
Be helpful, warm, and conversational. Answer clearly and concisely. For code, use proper formatting.
When analyzing files, images, or documents, be thorough — describe text, tables, charts, and key content.`;

// ── Message builder (handles text + vision) ────────────────────────────────────

function buildMessages(body) {
  const { message, history = [], file_text, file_name, image_base64, image_mime } = body;
  const msgs = [{ role: 'system', content: SYSTEM_PROMPT }, ...history];

  if (image_base64) {
    // Vision: send image as base64 data URL alongside the text prompt
    msgs.push({
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: { url: `data:${image_mime || 'image/jpeg'};base64,${image_base64}` },
        },
        { type: 'text', text: message || 'Describe this image in detail.' },
      ],
    });
  } else if (file_text) {
    msgs.push({
      role: 'user',
      content: `[File: ${file_name || 'document'}]\n\n${file_text}\n\n---\n\n${message}`,
    });
  } else {
    msgs.push({ role: 'user', content: message });
  }

  return msgs;
}

// ── Server-side AES-256-CBC encryption (for /api/chat non-streaming) ───────────

function _encryptResponse(text) {
  try {
    const rawKey = process.env.FERNET_KEY || '';
    const key    = rawKey
      ? crypto.createHash('sha256').update(rawKey).digest()
      : crypto.randomBytes(32);
    const iv      = crypto.randomBytes(16);
    const cipher  = crypto.createCipheriv('aes-256-cbc', key, iv);
    let   enc     = cipher.update(text, 'utf8', 'base64');
    enc          += cipher.final('base64');
    const mac     = crypto.createHmac('sha256', key)
      .update(iv.toString('base64') + enc).digest('base64');
    return Buffer.from(JSON.stringify({ iv: iv.toString('base64'), data: enc, mac })).toString('base64');
  } catch {
    return Buffer.from(text).toString('base64');
  }
}

// ── Health check ───────────────────────────────────────────────────────────────

app.get('/health', (req, res) => res.json({
  status:     'ok',
  service:    'AuraAI',
  version:    '3.0.0',
  model:      DEFAULT_MODEL,
  encryption: 'AES-256-GCM (client) + AES-256-CBC (server)',
  streaming:  true,
}));

app.get('/', (req, res) => res.json({ service: 'AuraAI Backend', version: '3.0.0', health: '/health' }));

// Lightweight ping endpoint — used by UptimeRobot / external keep-warm services
app.get('/ping', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ── Chat — non-streaming (fallback) ───────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) return res.status(500).json({ error: 'GROQ_API_KEY not configured' });
  if (!req.body.message) return res.status(400).json({ error: 'message is required' });

  const model    = _resolveModel(req.body.model);
  const messages = buildMessages(req.body);

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
      body:    JSON.stringify({
        model,
        max_tokens: parseInt(process.env.GROQ_MAX_TOKENS || '2048'),
        stream:     false,
        messages,
      }),
    });

    if (!groqRes.ok) {
      const err = await groqRes.json();
      return res.status(groqRes.status).json({ error: err.error?.message || 'Groq API error' });
    }

    const data = await groqRes.json();
    const text = data.choices?.[0]?.message?.content || '';
    res.json({ response: text, ciphertext: _encryptResponse(text), model: data.model, thinking_steps: [] });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Chat stream — Server-Sent Events ─────────────────────────────────────────

app.post('/api/chat/stream', async (req, res) => {
  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) return res.status(500).json({ error: 'GROQ_API_KEY not configured' });
  if (!req.body.message) return res.status(400).json({ error: 'message is required' });

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable Nginx buffering on Render
  res.flushHeaders();

  const model    = _resolveModel(req.body.model);
  const messages = buildMessages(req.body);

  const write = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
      body:    JSON.stringify({
        model,
        max_tokens: parseInt(process.env.GROQ_MAX_TOKENS || '2048'),
        stream:     true,
        messages,
      }),
    });

    if (!groqRes.ok) {
      const err = await groqRes.json();
      write({ error: err.error?.message || 'Groq API error' });
      res.end();
      return;
    }

    const reader  = groqRes.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = '';
    let   resolvedModel = model;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // hold incomplete line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') {
          write({ done: true, model: resolvedModel });
          res.end();
          return;
        }
        try {
          const chunk = JSON.parse(raw);
          if (chunk.model) resolvedModel = chunk.model;
          const token = chunk.choices?.[0]?.delta?.content;
          if (token) write({ token });
        } catch { /* malformed chunk — skip */ }
      }
    }

    write({ done: true, model: resolvedModel });
    res.end();
  } catch (err) {
    console.error('Stream error:', err.message);
    write({ error: err.message });
    res.end();
  }
});

// ── File upload ────────────────────────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 },
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const { originalname, buffer } = req.file;
  const ext = path.extname(originalname).toLowerCase();

  try {
    let extracted_text = '';

    if (ext === '.pdf') {
      const pdfParse = require('pdf-parse');
      extracted_text = (await pdfParse(buffer)).text;
    } else if (['.docx', '.doc'].includes(ext)) {
      const mammoth  = require('mammoth');
      extracted_text = (await mammoth.extractRawText({ buffer })).value;
    } else if (['.txt', '.md', '.csv'].includes(ext)) {
      extracted_text = buffer.toString('utf8');
    } else {
      return res.status(400).json({ error: `Unsupported file type: ${ext}` });
    }

    const words = extracted_text.trim().split(/\s+/).filter(Boolean);
    res.json({
      extracted_text: extracted_text.slice(0, 50_000),
      char_count:     extracted_text.length,
      word_count:     words.length,
      filename:       originalname,
    });
  } catch (err) {
    console.error('Upload error:', err.message);
    res.status(500).json({ error: `Failed to parse file: ${err.message}` });
  }
});

// ── History stubs ──────────────────────────────────────────────────────────────

app.post('/api/history',      (req, res) => res.json({ ok: true }));
app.get('/api/history/:id',   (req, res) => res.json({ messages: [] }));
app.delete('/api/history/:id',(req, res) => res.json({ ok: true }));

// ── Start ──────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`✅ AuraAI backend running on http://localhost:${PORT}`);
  if (!process.env.GROQ_API_KEY) console.warn('⚠  GROQ_API_KEY not set');
  if (!process.env.FERNET_KEY)   console.warn('⚠  FERNET_KEY not set — using random key');
});

// ── Keep Render warm ──────────────────────────────────────────────────────────

const RENDER_URL = process.env.RENDER_EXTERNAL_URL || null;
if (RENDER_URL) {
  setInterval(async () => {
    try { await fetch(`${RENDER_URL}/`); console.log('🏓 Keep-alive ping sent'); }
    catch (e) { console.warn('⚠ Keep-alive failed:', e.message); }
  }, 10 * 60 * 1000);
}
