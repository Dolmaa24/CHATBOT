# AuraAI — Secure AI Chat

AuraAI is a security-first AI chatbot that runs AES-256-GCM encryption entirely inside your browser using the Web Crypto API — no external crypto libraries required. Every message is encrypted and HMAC-signed before it ever leaves your device.

Powered by Groq's free LPU inference engine with live streaming responses. Deployed on Vercel (frontend) and Render (backend) — total infrastructure cost: **$0**.

---

## Features

| Feature | Details |
|---|---|
| 🔐 Browser Encryption | AES-256-GCM + HMAC-SHA-512 + PBKDF2 on every message via Web Crypto API |
| ⚡ Streaming Responses | Words appear live as the AI types — no waiting for the full response |
| 🤖 Multi-Model | Llama 3.3 70B, Llama 3.1 8B, Mixtral 8x7B, Gemma 2 9B — all free via Groq |
| 👁️ Vision AI | Llama 4 Scout reads images — attach a photo and ask questions about it |
| 📁 File Upload | PDF, DOCX, TXT, CSV, MD — text extracted and sent as context |
| 🎤 Voice Input | Speak your message — converted to text in real time (browser-native) |
| 🔊 Text to Speech | Click 🔊 on any response to hear it read aloud; click ⏹ to stop |
| 💬 Chat History | All sessions saved in localStorage — no account needed |
| 🔄 Multiple Chats | New chat button, switch between past sessions in the sidebar |
| 🌙 Dark Mode | Full dark theme remembered across sessions |
| 🔬 Crypto Inspector | Click **Inspect** on any message to see IV, HMAC, ciphertext, fingerprint |
| 📊 Request Counter | Header shows remaining requests; resets every 15 minutes |
| 🛡️ Rate Limiting | 200 requests per 15 minutes per IP |
| 🔒 Secure Backend | Groq API key lives only on the server — never exposed to the browser |
| ♻️ Keep Alive | Backend self-pings every 10 minutes to prevent Render cold starts |

---

## Cryptographic Architecture

```
User types a message
        │
        ▼
┌─────────────────────────────────────┐
│  PBKDF2 Key Derivation              │
│  Random passphrase + salt (256-bit) │
│  100,000 iterations × SHA-512       │
│  → AES-256 key + HMAC-512 key       │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  AES-256-GCM Encryption             │
│  Fresh random 96-bit IV per message │
│  Authenticated encryption:          │
│  confidentiality + GCM auth tag     │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  HMAC-SHA-512 Integrity Signing     │
│  Computed over: IV || Ciphertext    │
│  Encrypt-then-MAC pattern           │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Envelope { v, alg, iv, ct,         │
│             hmac, fp, ts }          │
│  Stored in browser memory only      │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Backend Proxy (Render)             │
│  Plaintext forwarded to Groq        │
│  API key never visible to frontend  │
└─────────────────────────────────────┘
```

Keys are derived once per session and live only in browser memory — never written to disk, never sent to a server.

---

## AI Models

| Model | Speed | Best For |
|---|---|---|
| `llama-3.3-70b-versatile` | Fast | General chat, coding, analysis |
| `llama-3.1-8b-instant` | Ultra-fast | Quick Q&A, simple tasks |
| `mixtral-8x7b-32768` | Fast | Long context, multilingual |
| `gemma2-9b-it` | Fast | Concise, focused responses |
| `llama-4-scout-17b` | Fast | **Vision** — images & visual content |

All models are free via [Groq](https://console.groq.com) (14,400 requests/day).

---

## Project Structure

```
CHATBOT/
├── frontend/                  ← Deploy on Vercel
│   ├── index.html
│   ├── vercel.json
│   ├── styles/
│   │   ├── main.css           ← Full UI, dark mode, all components
│   │   └── animations.css
│   └── src/
│       ├── config.js          ← Model list, constants, backend URL
│       ├── crypto.js          ← AES-256-GCM + PBKDF2 + HMAC (Web Crypto API)
│       ├── api.js             ← Fetch wrappers: streaming SSE + upload + health
│       ├── app.js             ← Entry point: theme, sessions, model selector
│       ├── chat.js            ← Send pipeline: streaming, crypto inspector
│       ├── fileUpload.js      ← Images (base64/vision) + docs (server extract)
│       ├── history.js         ← localStorage session management
│       ├── thinkingSteps.js   ← Animated step-by-step thinking widget
│       └── voice.js           ← STT (SpeechRecognition) + TTS (SpeechSynthesis)
│
└── backend/                   ← Deploy on Render
    ├── server.js              ← Express proxy: streaming SSE, vision, rate limit
    ├── package.json
    ├── render.yaml
    └── .env.example
```

---

## Local Setup

### Prerequisites
- Node.js 18+
- A free Groq API key from [console.groq.com](https://console.groq.com/keys)

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/Dolmaa24/CHATBOT.git
cd CHATBOT

# 2. Install backend dependencies
cd backend
npm install

# 3. Create environment file
cp .env.example .env
```

Edit `backend/.env`:
```env
GROQ_API_KEY=gsk_your_key_here
FERNET_KEY=your_32_byte_base64_key
CORS_ORIGINS=http://localhost:5500,http://127.0.0.1:5500
GROQ_MODEL=llama-3.3-70b-versatile
```

Generate a `FERNET_KEY`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

```bash
# 4. Start the backend
node server.js
# ✅ AuraAI backend running on http://localhost:8000

# 5. Serve the frontend (in a new terminal)
cd ../frontend
npx serve . -p 5500
# Open http://localhost:5500
```

---

## Deployment

### Backend → Render (free)

1. Push repo to GitHub
2. Go to [render.com](https://render.com) → **New Web Service**
3. Connect your GitHub repo

| Setting | Value |
|---|---|
| Root Directory | `backend` |
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `node server.js` |

Add environment variables: `GROQ_API_KEY`, `FERNET_KEY`, `CORS_ORIGINS` (your Vercel URL), `RENDER_EXTERNAL_URL` (your Render URL).

### Frontend → Vercel (free)

1. Update `BACKEND_URL` in `frontend/src/config.js` with your Render URL
2. Go to [vercel.com](https://vercel.com) → **New Project** → import repo
3. Set **Root Directory** to `frontend` → Deploy

---

## Security Notes

**What is protected:**
- ✅ Groq API key never appears in frontend code
- ✅ Session encryption keys never leave browser memory
- ✅ Every message encrypted with a unique random 96-bit IV
- ✅ HMAC-SHA-512 verified before every decryption
- ✅ PBKDF2 at 100,000 iterations — brute-force infeasible
- ✅ Rate limiting — 200 requests / IP / 15 minutes
- ✅ CORS restricted to your frontend domain

**Honest limitations:**
- Keys are session-scoped — refreshing generates new keys (by design)
- The backend sees plaintext before forwarding to Groq — encryption is for transit and transparency demonstration
- No forward secrecy (would require ECDH for full P2P)

---

## Tech Stack

**Frontend:** Vanilla HTML + CSS + JS · Web Crypto API · Web Speech API · Plus Jakarta Sans + DM Sans

**Backend:** Node.js · Express · express-rate-limit · multer · pdf-parse · mammoth · dotenv

**Infrastructure:** Vercel (frontend) · Render (backend) · Groq (AI inference) — **Total cost: $0**

---

Built with Web Crypto API · Groq · Node.js · Express · Vercel · Render
