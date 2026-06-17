/**
 * fileUpload.js — File attachment handling with vision AI support.
 *
 * Images (jpg, png, webp, gif) → read as base64 client-side → vision model (Llama 4 Scout)
 * PDFs, DOCX, TXT, CSV       → upload to backend for text extraction
 * Drag-and-drop + click-to-browse supported.
 */

import { uploadFile } from './api.js';
import { showToast }  from './app.js';

// ── State ──────────────────────────────────────────────────────────────────────

let _currentFile   = null;
let _extractedText = null;
let _extractedName = null;
let _imageBase64   = null;  // base64 string (no data: prefix) for vision
let _imageMime     = null;  // e.g. 'image/jpeg'
let _isUploading   = false;
let _onImageAttach = null;  // callback(true/false) → auto-switches model

// ── DOM refs ───────────────────────────────────────────────────────────────────

const $chip     = () => document.getElementById('file-chip');
const $chipName = () => document.getElementById('chip-name');
const $chipSize = () => document.getElementById('chip-size');
const $chipIcon = () => document.getElementById('chip-icon');
const $input    = () => document.getElementById('file-input');
const $overlay  = () => document.getElementById('drop-overlay');
const $attach   = () => document.getElementById('btn-attach');

// ── Init ────────────────────────────────────────────────────────────────────────

export function initFileUpload(onImageAttach) {
  _onImageAttach = onImageAttach;

  $attach()?.addEventListener('click', () => $input()?.click());

  $input()?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) _handleFile(file);
    e.target.value = '';
  });

  document.getElementById('btn-chip-remove')?.addEventListener('click', clearAttachment);

  // Drag-and-drop
  let dragCounter = 0;

  document.addEventListener('dragenter', e => {
    if (e.dataTransfer?.types?.includes('Files')) {
      dragCounter++;
      $overlay()?.classList.add('visible');
    }
  });

  document.addEventListener('dragleave', () => {
    if (--dragCounter <= 0) { dragCounter = 0; $overlay()?.classList.remove('visible'); }
  });

  document.addEventListener('dragover', e => e.preventDefault());

  document.addEventListener('drop', e => {
    e.preventDefault();
    dragCounter = 0;
    $overlay()?.classList.remove('visible');
    const file = e.dataTransfer?.files?.[0];
    if (file) _handleFile(file);
  });
}

// ── File handler ───────────────────────────────────────────────────────────────

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/tiff', 'image/bmp']);

async function _handleFile(file) {
  if (_isUploading) return;

  _currentFile   = file;
  _extractedText = null;
  _extractedName = file.name;
  _imageBase64   = null;
  _imageMime     = null;
  _isUploading   = true;

  _showChip(file.name, file.size, _mimeIcon(file.type), true);

  try {
    if (IMAGE_TYPES.has(file.type)) {
      // Client-side base64 — no backend round-trip needed for vision
      const b64 = await _fileToBase64(file);
      _imageBase64 = b64;
      _imageMime   = file.type;
      _showChip(file.name, null, '🖼️', false, _fmtBytes(file.size) + ' · Vision ready');
      showToast(`Image attached — Llama 4 Scout will analyse it`, 'success');
      _onImageAttach?.(true);  // signal app.js to switch to vision model
    } else {
      // Server-side text extraction (PDF, DOCX, TXT, CSV, MD)
      const result    = await uploadFile(file);
      _extractedText  = result.extracted_text;
      _extractedName  = result.filename;
      const info      = `${_fmtBytes(file.size)} · ${result.char_count.toLocaleString()} chars`;
      _showChip(result.filename, null, _mimeIcon(file.type), false, info);
      showToast(`Parsed "${result.filename}" — ${result.word_count.toLocaleString()} words`, 'success');
      _onImageAttach?.(false);
    }
  } catch (err) {
    showToast(`Upload failed: ${err.message}`, 'error');
    clearAttachment();
  } finally {
    _isUploading = false;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function getAttachment() {
  return {
    file_text:    _extractedText,
    file_name:    _extractedName,
    image_base64: _imageBase64,
    image_mime:   _imageMime,
    isImage:      _imageBase64 !== null,
    hasFile:      _currentFile !== null,
  };
}

export function clearAttachment() {
  _currentFile   = null;
  _extractedText = null;
  _extractedName = null;
  _imageBase64   = null;
  _imageMime     = null;
  _isUploading   = false;
  $chip()?.classList.remove('visible');
  const inp = $input();
  if (inp) inp.value = '';
  _onImageAttach?.(false); // restore model to default
}

export const hasAttachment = () => _currentFile !== null && !_isUploading;
export const isUploading   = () => _isUploading;

// ── Chip UI ────────────────────────────────────────────────────────────────────

function _showChip(name, size, icon, loading = false, subtitle = '') {
  const chip = $chip();
  if (!chip) return;
  const cName = $chipName();
  const cSize = $chipSize();
  const cIcon = $chipIcon();
  if (cIcon) cIcon.textContent = loading ? '⏳' : icon;
  if (cName) cName.textContent = name;
  if (cSize) cSize.textContent = loading ? 'Processing…' : (subtitle || (size != null ? _fmtBytes(size) : ''));
  chip.classList.add('visible');
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function _fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => {
      // result is "data:image/jpeg;base64,XXXXXXX" — strip the prefix
      const b64 = e.target.result.split(',')[1];
      resolve(b64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function _fmtBytes(bytes) {
  if (bytes < 1024)      return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function _mimeIcon(mime = '') {
  if (mime === 'application/pdf') return '📕';
  if (mime.includes('word'))      return '📘';
  if (mime.startsWith('image/'))  return '🖼️';
  if (mime.startsWith('text/'))   return '📝';
  return '📄';
}
