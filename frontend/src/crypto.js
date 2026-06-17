/**
 * crypto.js — Browser-native AES-256-GCM + HMAC-SHA-512 + PBKDF2
 * Uses window.crypto.subtle — zero external dependencies.
 * Keys are derived once per session and never leave browser memory.
 */

// ── Session keys (derived once on page load) ──────────────────────────────────

let _aesKey  = null;
let _hmacKey = null;
let _keysReady = null;

function _initKeys() {
  _keysReady = (async () => {
    const passphrase = crypto.getRandomValues(new Uint8Array(32));
    const salt       = crypto.getRandomValues(new Uint8Array(32));

    const base = await crypto.subtle.importKey(
      'raw', passphrase, 'PBKDF2', false, ['deriveBits']
    );

    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-512', salt, iterations: 100_000 },
      base, 512
    );

    _aesKey = await crypto.subtle.importKey(
      'raw', bits.slice(0, 32),
      { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
    );

    _hmacKey = await crypto.subtle.importKey(
      'raw', bits.slice(32, 64),
      { name: 'HMAC', hash: 'SHA-512' }, false, ['sign', 'verify']
    );
  })();
  return _keysReady;
}

_initKeys();

// ── Encrypt ────────────────────────────────────────────────────────────────────

/**
 * AES-256-GCM encrypt + HMAC-SHA-512 sign.
 * Returns an envelope object with all crypto metadata for the Inspector.
 * @param {string} plaintext
 * @returns {Promise<{v,alg,mac,iv,ct,hmac,fp,ts}>}
 */
export async function encryptMessage(plaintext) {
  await _keysReady;

  const iv      = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV
  const encoded = new TextEncoder().encode(plaintext);

  const ctBuf  = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, _aesKey, encoded);
  const ivB64  = _b64(iv);
  const ctB64  = _b64(new Uint8Array(ctBuf));

  // Encrypt-then-MAC: HMAC over IV || ciphertext
  const macInput = new TextEncoder().encode(ivB64 + ctB64);
  const macBuf   = await crypto.subtle.sign('HMAC', _hmacKey, macInput);
  const hmacB64  = _b64(new Uint8Array(macBuf));

  // SHA-256 fingerprint of the plaintext
  const fpBuf = await crypto.subtle.digest('SHA-256', encoded);
  const fp    = _hex(new Uint8Array(fpBuf));

  return {
    v:    3,
    alg:  'AES-256-GCM',
    mac:  'HMAC-SHA-512',
    iv:   ivB64,
    ct:   ctB64,
    hmac: hmacB64,
    fp,
    ts:   new Date().toISOString(),
  };
}

// ── Verify + Decrypt ───────────────────────────────────────────────────────────

/**
 * Verify HMAC then AES-256-GCM decrypt.
 * Throws if integrity check fails.
 * @param {{iv,ct,hmac}} envelope
 * @returns {Promise<string>} plaintext
 */
export async function verifyAndDecrypt(envelope) {
  await _keysReady;
  const { iv, ct, hmac } = envelope;

  const valid = await crypto.subtle.verify(
    'HMAC', _hmacKey,
    _fromb64(hmac),
    new TextEncoder().encode(iv + ct)
  );
  if (!valid) throw new Error('HMAC integrity check failed — message may be tampered');

  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: _fromb64(iv) },
    _aesKey,
    _fromb64(ct)
  );
  return new TextDecoder().decode(plainBuf);
}

// ── Display helpers ────────────────────────────────────────────────────────────

export function displayCiphertext(envelope, maxLen = 380) {
  const raw = typeof envelope === 'string' ? envelope : (envelope?.ct || JSON.stringify(envelope));
  if (!raw) return '';
  if (raw.length <= maxLen) return raw;
  return raw.slice(0, maxLen) + `…[${raw.length - maxLen} more bytes]`;
}

export function getCryptoSteps() {
  return [
    'PBKDF2 key derivation (100 000 × SHA-512)…',
    'Generating fresh 96-bit random IV…',
    'AES-256-GCM authenticated encryption…',
    'HMAC-SHA-512 integrity signing…',
    'Packaging envelope { iv, ct, hmac, fp }…',
  ];
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function _b64(bytes)    { return btoa(String.fromCharCode(...bytes)); }
function _fromb64(s)    { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
function _hex(bytes)    { return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''); }
