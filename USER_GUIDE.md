# EncryptedAI — Complete User Guide
### From zero to deployed production AI chatbot

**For first-year CS students with no prior deployment experience.**
Every step is written plainly. If a step fails, there is a troubleshooting note.

---

## Part 0 — Prerequisites Checklist

Before starting, confirm you have:
- A computer running Windows 10/11, macOS 12+, or Ubuntu 22+
- A free [Groq account](https://console.groq.com/) to get your API key
- A free [GitHub account](https://github.com) to push the project
- A free [Vercel account](https://vercel.com) (sign up with GitHub)
- A free [Render account](https://render.com) (sign up with GitHub)
- Stable internet (needed for API calls during testing)

---

## Part 1 — Install Python 3.11

### macOS
```bash
# Install Homebrew if you don't have it
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Python 3.11
brew install python@3.11

# Confirm version
python3.11 --version
# Expected output: Python 3.11.x
```

### Windows
1. Visit https://www.python.org/downloads/release/python-3119/
2. Download **Windows installer (64-bit)**
3. Run the installer — **check "Add Python to PATH"** before clicking Install
4. Open PowerShell and run:
   ```powershell
   python --version
   # Expected: Python 3.11.x
   ```

### Ubuntu / Debian
```bash
sudo apt update
sudo apt install python3.11 python3.11-venv python3.11-pip -y
python3.11 --version
```

> **macOS image/OCR only**: Install Tesseract for PDF image OCR:
> ```bash
> brew install tesseract
> ```
> On Ubuntu: `sudo apt install tesseract-ocr -y`

---

## Part 2 — Install Node.js (optional, for live-server)

You only need Node if you want to use `live-server` for the frontend.
The simpler Python HTTP server described in Part 6 works without Node.

If you want live-server:
1. Visit https://nodejs.org and download **LTS** (e.g., 20.x)
2. Install and confirm: `node --version` → should show `v20.x.x`
3. Install live-server: `npm install -g live-server`

---

## Part 3 — Clone or Unzip the Project

### Option A: Clone from GitHub (recommended)
```bash
git clone https://github.com/YOUR_USERNAME/minor-project-chatbot.git
cd minor-project-chatbot
```

### Option B: Unzip
```bash
unzip minor-project-chatbot.zip
cd minor-project-chatbot
```

You should now have this folder structure:
```
minor-project-chatbot/
├── backend/
│   ├── main.py
│   ├── requirements.txt
│   ├── .env.example
│   ├── render.yaml
│   ├── services/
│   ├── routers/
│   ├── middleware/
│   └── models/
├── frontend/
│   ├── index.html
│   ├── css/
│   └── js/
├── .gitignore
├── vercel.json
└── USER_GUIDE.md
```

---

## Part 4 — Set Up the Backend Environment

### Step 4.1 — Create a virtual environment
```bash
# Navigate to the backend folder
cd minor-project-chatbot/backend

# Create a virtual environment named "venv"
python3.11 -m venv venv

# Activate it:
# macOS / Linux:
source venv/bin/activate

# Windows:
venv\Scripts\activate

# You should now see (venv) at the beginning of your terminal prompt
```

> **What is a virtual environment?**
> It's an isolated Python installation for this project.
> It prevents version conflicts with other Python projects on your system.

### Step 4.2 — Create your .env file
```bash
# Still inside the backend/ folder
cp .env.example .env
```

Now open `.env` in any text editor (VS Code, Notepad, nano).

You need to fill in **two values**:

**1. GROQ_API_KEY**
- Go to https://console.groq.com/keys
- Click "Create API Key"
- Copy the key (it starts with `gsk_`)
- Replace `gsk_your_groq_api_key_here` in .env with your real key

**2. FERNET_KEY**
- Run this command (with venv activated):
  ```bash
  python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
  ```
- Copy the output (it looks like `abc123XYZ...`, 44 characters)
- Replace `your_fernet_key_here` in .env with this value

**3. CORS_ORIGINS** — leave as-is for now (you'll update it after Vercel deploy)

Your .env should look like:
```
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
FERNET_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
CORS_ORIGINS=http://localhost:5500,http://127.0.0.1:5500,http://localhost:3000
GROQ_MODEL=llama3-70b-8192
GROQ_MAX_TOKENS=2048
APP_ENV=development
TRUST_PROXY=0
```

> **IMPORTANT**: Never share your `.env` file or commit it to git.
> The `.gitignore` already excludes it — but double-check before pushing.

### Step 4.3 — Install Python dependencies
```bash
# Make sure (venv) is active!
pip install -r requirements.txt
```

This installs all libraries: FastAPI, Groq, cryptography, PyMuPDF, etc.
It may take 1–3 minutes on first install.

---

## Part 5 — Run the Backend Locally

```bash
# Still in backend/, venv active
python main.py
```

You should see:
```
INFO:     Started server process [xxxxx]
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
INFO:     EncryptedAI backend started. CORS origins: [...]
INFO:     ✓ All required environment variables present.
```

### Step 5.1 — Confirm /health responds
Open a **new** terminal window and run:
```bash
curl http://localhost:8000/health
```

Expected response:
```json
{
  "status": "ok",
  "service": "EncryptedAI",
  "version": "2.0.0",
  "model": "llama3-70b-8192",
  "encryption": "Fernet (AES-128-CBC + HMAC-SHA256)"
}
```

> **Troubleshooting**:
> - If `curl` fails: ensure the backend is running in the other terminal
> - If you see `GROQ_API_KEY not set`: re-check your .env file
> - If `import magic` fails: run `pip install python-magic`
> - On macOS, if `magic` errors: `brew install libmagic`
> - On Windows: `pip install python-magic-bin` instead of `python-magic`

---

## Part 6 — Open the Frontend Locally

### Option A: Python HTTP server (no installation needed)
```bash
# Open a new terminal, navigate to the frontend folder
cd minor-project-chatbot/frontend
python3 -m http.server 5500
```
Open your browser and go to: **http://localhost:5500**

### Option B: VS Code Live Server
1. Install the "Live Server" extension in VS Code
2. Open the `frontend/` folder in VS Code
3. Right-click `index.html` → "Open with Live Server"
4. Browser opens automatically at http://127.0.0.1:5500

### Option C: live-server (Node)
```bash
cd minor-project-chatbot/frontend
live-server --port=5500
```

> **Use Chrome or Edge** — voice input (speech recognition) requires a
> Chromium-based browser. Firefox does not support the Web Speech API.

You should see the EncryptedAI welcome screen with the golden ✦ logo.

The footer status bar should show **"Connected · llama3-70b-8192"**
within a few seconds (this means the frontend connected to the backend).

---

## Part 7 — Test a Text Chat End-to-End

1. Click the input bar at the bottom of the screen
2. Type: `What is AES encryption?`
3. Press **Enter** (or click the gold arrow button)

You should see:
1. Your message appears as a user bubble (right-aligned)
2. A **thinking steps timeline** appears, showing steps completing one-by-one
3. A **cipher block** appears (dark background, orange monospace text)
   — this is the actual Fernet-encrypted ciphertext from the backend
4. The cipher block dissolves, and the AI response appears character-by-character
5. The response is in the AI bubble (left-aligned) with "Copy" and "Read aloud" buttons

> **If the backend is offline**, you'll see a red error bubble in the chat and a toast notification at the bottom right.

---

## Part 8 — Test File Upload

### Upload a PDF:
1. Click the **📎 paperclip icon** in the input bar
2. Select any PDF file from your computer
3. A gold file chip appears at the top of the input area with the filename and character count
4. Type: `Summarise this document for me`
5. Press Enter

The AI will answer using the full text extracted from your PDF.

### Upload a DOCX:
Same steps — select a .docx file instead. python-docx extracts all paragraphs.

### Upload an image (OCR):
Select a .png or .jpg. The backend uses Tesseract OCR to extract any text visible in the image.

> **Troubleshooting**:
> - "File too large": max 50 MB — compress the file
> - "Unsupported file type": only PDF, DOCX, PNG, JPG, GIF, TXT, CSV are allowed
> - OCR returns empty: the image may not contain machine-readable text

---

## Part 9 — Test Voice Input and Text-to-Speech

### Voice-to-Text (STT):
1. Click the **🎤 microphone button** in the input bar
2. The button turns red and "Listening…" appears above the input bar
3. Speak your message clearly
4. The text appears in the input box as you speak
5. Click microphone again to stop, or wait for automatic end-of-speech detection
6. The text is pre-filled — press Enter to send

### Text-to-Speech (TTS):
1. After an AI response appears, hover over the bubble
2. Click **🔊 Read aloud** button
3. The AI response is spoken in a clear English voice
4. The button shows "🔊 Speaking…" while active

> **Voice requires Chrome or Edge**. If you're using Safari or Firefox, you'll see
> a toast message: "Speech recognition requires Chrome or Edge."

---

## Part 10 — Demonstrate the Crypto Layer

### What to show your internship manager:

**Step 1: Open Browser DevTools**
Press `F12` (Windows) or `Cmd+Opt+I` (macOS)

**Step 2: Go to the Network tab**
Click "Network" at the top of DevTools, then click "Fetch/XHR" sub-filter.

**Step 3: Send a chat message**
Type any message and hit Enter. You'll see a request to `/api/chat` appear.

**Step 4: Click the `/api/chat` request**
Then click the "Response" tab in the details panel. You'll see:
```json
{
  "ciphertext": "gAAAAABl...long base64 string...",
  "response": "Here is the AI response in plain English...",
  "thinking_steps": ["Reading your message", "..."],
  "model": "llama3-70b-8192"
}
```

The `ciphertext` field is the actual **Fernet token** (AES-128-CBC encrypted),
and `response` is the decrypted text. In the UI, the ciphertext is displayed
first in the dark cipher block, then dissolved into the plaintext.

**What to explain to your manager:**
> "The backend encrypts every AI response with AES-128-CBC (Fernet format, which also
> includes HMAC-SHA256 authentication to prevent tampering). The frontend displays the
> ciphertext before 'decrypting' it visually. The Groq API key never leaves the server.
> Files are parsed in-memory — nothing touches disk. Rate limiting is enforced at 200
> requests/minute per IP using a sliding window algorithm."

---

## Part 11 — Deploy Frontend to Vercel

### Step 11.1 — Push your project to GitHub
```bash
cd minor-project-chatbot

# Initialize git if not done
git init
git add .
git commit -m "feat: initial EncryptedAI implementation"

# Create a repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/minor-project-chatbot.git
git push -u origin main
```

### Step 11.2 — Deploy to Vercel
1. Go to https://vercel.com and click **"Add New Project"**
2. Click **"Import Git Repository"** — select your GitHub repo
3. In the configuration screen:
   - **Framework Preset**: Other (not Next.js, not CRA)
   - **Root Directory**: Click "Edit" → type `frontend` → click Continue
   - **Build Command**: leave **empty** (it's a static site — no build step)
   - **Output Directory**: leave **empty**
4. Click **"Deploy"**

Vercel builds in ~10 seconds. You'll get a URL like:
`https://minor-project-chatbot-abc123.vercel.app`

> Take a screenshot of the Vercel dashboard showing "✓ Deployment successful" with your URL.

---

## Part 12 — Deploy Backend to Render

### Step 12.1 — Create a Render Web Service
1. Go to https://render.com → click **"New +"** → **"Web Service"**
2. Connect your GitHub repo
3. Configure the service:
   - **Name**: `encryptedai-backend`
   - **Root Directory**: `backend`
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Instance Type**: Free

### Step 12.2 — Set Environment Variables
In the Render dashboard, scroll to **"Environment Variables"** and add:

| Key | Value |
|---|---|
| `GROQ_API_KEY` | your real Groq key (`gsk_...`) |
| `FERNET_KEY` | your generated Fernet key |
| `CORS_ORIGINS` | your Vercel URL (from Part 11) |
| `GROQ_MODEL` | `llama3-70b-8192` |
| `GROQ_MAX_TOKENS` | `2048` |
| `APP_ENV` | `production` |
| `TRUST_PROXY` | `1` |

> For `CORS_ORIGINS`, use your exact Vercel URL, e.g.:
> `https://minor-project-chatbot-abc123.vercel.app`
> No trailing slash.

### Step 12.3 — Deploy
Click **"Create Web Service"**. Render will:
1. Pull your code from GitHub
2. Run `pip install -r requirements.txt` (2–5 minutes on first deploy)
3. Start the server

Once done, you get a URL like: `https://encryptedai-backend.onrender.com`

**Test it**: Visit `https://encryptedai-backend.onrender.com/health` in your browser.
You should see the `{"status": "ok"}` JSON response.

> **Render free tier cold starts**: The server sleeps after 15 minutes of inactivity.
> The first request after sleep takes 20–30 seconds. The frontend shows
> "Backend waking up…" and retries automatically up to 3 times.

---

## Part 13 — Connect Frontend to Production Backend

### Step 13.1 — Update config.js
Open `frontend/js/config.js` and replace the placeholder:
```javascript
: 'https://your-encryptedai-backend.onrender.com'; // ← replace this before deploy
```
with your actual Render URL:
```javascript
: 'https://encryptedai-backend.onrender.com'; // ← your real URL
```

Also update `vercel.json` — find the line with `your-encryptedai-backend.onrender.com`
in the CSP header and replace it with your real Render URL.

### Step 13.2 — Redeploy frontend
```bash
git add frontend/js/config.js vercel.json
git commit -m "config: set production backend URL"
git push
```

Vercel auto-deploys on every push. Wait 30 seconds, then visit your Vercel URL.
The footer status should show **"Connected · llama3-70b-8192"**.

---

## Part 14 — Presenting to Your Internship Manager

### The 3-Minute Demo Script

**Open the app** at your Vercel URL and say:

> *"This is EncryptedAI, a full-stack AI chatbot I built from scratch.
> The frontend is pure HTML, CSS, and JavaScript — no frameworks.
> The backend is Python FastAPI, deployed on Render."*

**Demo the encryption:**
> *"Every AI response is Fernet-encrypted on the server before it's sent.
> Watch — I'll send a message now."*
> — Type a message, send it, and point to the cipher block dissolving into text.
> *"That orange text was the actual ciphertext. AES-128-CBC with HMAC-SHA256.
> Then it decrypts to readable text right in front of you."*

**Demo file upload:**
> *"I can upload any PDF or Word document and ask questions about it."*
> — Upload a PDF, ask "summarise this document."

**Demo voice:**
> *"Voice input and text-to-speech — all browser-native, no external API."*
> — Click the mic, say something, send it, then click "Read aloud."

**Show DevTools:**
> *"In the Network tab you can see the raw ciphertext in the API response.
> The Groq API key never leaves the server. Files are parsed in-memory — nothing touches disk.
> Rate limiting at 200 requests/minute prevents abuse."*

### What Makes This Impressive

| Feature | Why It's Impressive |
|---|---|
| End-to-end encryption display | Visualises a real security concept |
| No-framework frontend | Shows fundamental web skills |
| asyncio file parsing | Production-grade: heavy I/O doesn't block the event loop |
| Magic-byte MIME validation | Prevents file-type spoofing attacks |
| Secure rate limiting | Sliding window + proxy-aware IP extraction |
| Prompt injection hardening | User input never interpolated into system prompt |
| Session cap + QuotaExceeded handling | localStorage won't silently crash |
| prefers-reduced-motion | Accessibility-aware animations |
| WCAG AA contrast | Both themes pass minimum contrast ratios |
| Render cold-start retry | Graceful degradation, not a blank error screen |

---

## Appendix A — Common Errors

| Error | Cause | Fix |
|---|---|---|
| `ModuleNotFoundError: magic` | python-magic not installed | `pip install python-magic` (macOS: also `brew install libmagic`) |
| `GROQ_API_KEY not set` | .env not loaded or missing | Check .env exists in `backend/`, venv is active |
| CORS error in browser console | CORS_ORIGINS missing frontend URL | Add your Vercel URL to CORS_ORIGINS in Render env vars |
| Voice button does nothing | Browser doesn't support Web Speech API | Use Chrome or Edge |
| Backend shows 503 | Render cold start | Wait 30 seconds; the app retries automatically |
| `QuotaExceededError` | localStorage full | App auto-prunes oldest sessions |
| Ciphertext shows blank | Fernet key changed | Clear localStorage: `localStorage.clear()` in DevTools console |

## Appendix B — Resetting Chat History

```javascript
// Open DevTools (F12) → Console tab → paste this and press Enter:
localStorage.clear(); location.reload();
```

## Appendix C — Local Tesseract (for image OCR)

Without Tesseract, image uploads still work — but extracted text will be empty.

- **macOS**: `brew install tesseract`
- **Ubuntu**: `sudo apt install tesseract-ocr -y`
- **Windows**: Download from https://github.com/UB-Mannheim/tesseract/wiki
  and ensure the install path is in your system PATH.

After installing, restart the backend and re-upload an image.
