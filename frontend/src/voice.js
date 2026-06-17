/**
 * voice.js — Web Speech API STT + SpeechSynthesis TTS wrapper.
 *
 * No external APIs. Uses browser-native speech engines.
 * STT: SpeechRecognition (webkitSpeechRecognition on Chrome)
 * TTS: window.speechSynthesis + SpeechSynthesisUtterance
 */

// ── State ──────────────────────────────────────────────────────────────────────

let _recognition = null;
let _isListening = false;
let _isSpeaking  = false;
let _preferredVoice = null;

export const STT_SUPPORTED = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
export const TTS_SUPPORTED = 'speechSynthesis' in window;

// ── Voice selection ────────────────────────────────────────────────────────────

function _pickVoice() {
  if (!TTS_SUPPORTED) return;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return;

  const priority = [
    'Google US English',
    'Microsoft Aria Online (Natural) - English (United States)',
    'Samantha',   // macOS
    'Karen',      // macOS
    'Victoria',   // macOS
  ];

  for (const name of priority) {
    const v = voices.find(v => v.name === name);
    if (v) { _preferredVoice = v; return; }
  }

  // Fallback: first English voice
  _preferredVoice = voices.find(v => v.lang.startsWith('en')) || voices[0] || null;
}

if (TTS_SUPPORTED) {
  if (window.speechSynthesis.getVoices().length) {
    _pickVoice();
  } else {
    window.speechSynthesis.addEventListener('voiceschanged', _pickVoice, { once: true });
  }
}

// ── Speech-to-Text ─────────────────────────────────────────────────────────────

/**
 * Begin microphone capture for speech recognition.
 *
 * @param {object} callbacks
 *   .onInterim(text)  — partial transcript while speaking
 *   .onFinal(text)    — finalized transcript
 *   .onEnd()          — recognition ended (user stopped or timeout)
 *   .onError(msg)     — error string
 * @returns {boolean} true if recognition started
 */
export function startListening({ onInterim, onFinal, onEnd, onError } = {}) {
  if (!STT_SUPPORTED) {
    onError?.('Speech recognition is not supported in this browser. Try Chrome or Edge.');
    return false;
  }
  if (_isListening) return false;

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  _recognition = new SR();
  _recognition.continuous     = false;
  _recognition.interimResults = true;
  _recognition.lang           = 'en-US';
  _recognition.maxAlternatives = 1;

  _recognition.onstart = () => { _isListening = true; };

  _recognition.onresult = (e) => {
    let interim = '';
    let finalText = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += t;
      else interim += t;
    }
    if (interim)   onInterim?.(interim);
    if (finalText) onFinal?.(finalText.trim());
  };

  _recognition.onend  = () => { _isListening = false; onEnd?.(); };

  _recognition.onerror = (e) => {
    _isListening = false;
    const msgs = {
      'no-speech':    'No speech detected. Please try again.',
      'audio-capture':'Microphone not accessible.',
      'not-allowed':  'Microphone permission denied.',
      'aborted':      'Recording was cancelled.',
    };
    onError?.(msgs[e.error] || `Recognition error: ${e.error}`);
  };

  _recognition.start();
  return true;
}

/**
 * Stop the active recognition session.
 */
export function stopListening() {
  if (_recognition && _isListening) {
    _recognition.stop();
    _isListening = false;
  }
}

export const isListening = () => _isListening;

// ── Text-to-Speech ─────────────────────────────────────────────────────────────

/**
 * Speak `text` aloud using SpeechSynthesis.
 * Strips markdown before speaking for a cleaner listening experience.
 *
 * @param {string}   text
 * @param {object}   callbacks  { onStart, onEnd, onError }
 */
export function speak(text, { onStart, onEnd, onError } = {}) {
  if (!TTS_SUPPORTED) {
    onError?.('Text-to-speech not supported in this browser.');
    return;
  }
  if (_isSpeaking) window.speechSynthesis.cancel();

  // Strip markdown formatting for cleaner audio
  const clean = text
    .replace(/```[\s\S]*?```/g, 'code block.')
    .replace(/`[^`]+`/g, '')
    .replace(/[#*_~|>]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .trim();

  const utt       = new SpeechSynthesisUtterance(clean);
  if (_preferredVoice) utt.voice = _preferredVoice;
  utt.lang   = 'en-US';
  utt.rate   = 1.0;
  utt.pitch  = 1.0;
  utt.volume = 1.0;

  utt.onstart = () => { _isSpeaking = true; onStart?.(); };
  utt.onend   = () => { _isSpeaking = false; onEnd?.(); };
  utt.onerror = (e) => {
    _isSpeaking = false;
    onError?.(`TTS error: ${e.error}`);
  };

  window.speechSynthesis.speak(utt);
}

/**
 * Stop any active speech playback.
 */
export function stopSpeaking() {
  if (TTS_SUPPORTED && _isSpeaking) {
    window.speechSynthesis.cancel();
    _isSpeaking = false;
  }
}

export const isSpeaking = () => _isSpeaking;
