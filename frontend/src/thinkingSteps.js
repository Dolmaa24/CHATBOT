/**
 * thinkingSteps.js — Animated thinking-steps timeline renderer.
 *
 * Renders an expanding timeline widget above the AI message bubble.
 * Steps appear sequentially with spinner → checkmark transitions.
 * Collapses after all steps are complete.
 *
 * Usage:
 *   const ts = new ThinkingSteps(containerEl, ['Step 1', 'Step 2', ...]);
 *   ts.start();        // begin animating steps
 *   ts.complete();     // mark all done, collapse
 *   ts.remove();       // remove from DOM
 */

import { STEP_INTERVAL_MS } from './config.js';

export class ThinkingSteps {
  /**
   * @param {HTMLElement} parent     - The container to append the widget into
   * @param {string[]}    stepLabels - Ordered list of step label strings
   */
  constructor(parent, stepLabels) {
    this._parent = parent;
    this._labels = stepLabels;
    this._currentStep = -1;
    this._timers = [];
    this._el = null;
    this._startTime = Date.now();
    this._collapsed = false;
    this._done = false;
    this._render();
  }

  // ── DOM construction ──────────────────────────────────────────────────────

  _render() {
    const wrapper = document.createElement('div');
    wrapper.className = 'msg-group thinking-wrapper';

    const container = document.createElement('div');
    container.className = 'thinking-container';
    container.id = 'thinking-' + Date.now();

    // Header (click to toggle collapse)
    const header = document.createElement('div');
    header.className = 'thinking-header';
    header.innerHTML = `
      <div class="thinking-spinner spin" id="${container.id}-spinner"></div>
      <span class="thinking-title">Processing your request…</span>
      <span class="thinking-count" id="${container.id}-count">0 / ${this._labels.length}</span>
      <span class="thinking-toggle">▾</span>
    `;
    header.addEventListener('click', () => this._toggleCollapse());

    // Steps list
    const stepsList = document.createElement('div');
    stepsList.className = 'thinking-steps-list';
    stepsList.id = container.id + '-list';

    this._labels.forEach((label, i) => {
      const row = document.createElement('div');
      row.className = 'step-row';
      row.id = `${container.id}-step-${i}`;
      row.innerHTML = `
        <div class="step-indicator pending" id="${container.id}-ind-${i}"></div>
        <span class="step-label">${_esc(label)}</span>
        <span class="step-timing" id="${container.id}-time-${i}"></span>
      `;
      stepsList.appendChild(row);
    });

    container.appendChild(header);
    container.appendChild(stepsList);
    wrapper.appendChild(container);
    this._parent.appendChild(wrapper);
    this._el = wrapper;
    this._container = container;
    this._countEl = container.querySelector(`#${container.id}-count`);
    this._spinnerEl = container.querySelector(`#${container.id}-spinner`);
    this._titleEl = container.querySelector('.thinking-title');
  }

  _toggleCollapse() {
    this._collapsed = !this._collapsed;
    this._container.classList.toggle('collapsed', this._collapsed);
  }

  // ── Animation control ─────────────────────────────────────────────────────

  /**
   * Start stepping through labels sequentially.
   * Each step animates with a delay of STEP_INTERVAL_MS.
   */
  start() {
    this._activateStep(0);
  }

  _activateStep(index) {
    if (index >= this._labels.length) return;
    this._currentStep = index;

    // Mark previous steps done
    for (let i = 0; i < index; i++) {
      this._markDone(i);
    }

    // Activate current step
    const stepEl = this._container.querySelector(`#${this._container.id}-step-${index}`);
    const indEl  = this._container.querySelector(`#${this._container.id}-ind-${index}`);
    if (stepEl) stepEl.classList.add('active');
    if (indEl)  { indEl.classList.remove('pending'); indEl.classList.add('active'); }

    // Update count
    if (this._countEl) this._countEl.textContent = `${index + 1} / ${this._labels.length}`;

    // Schedule next
    if (index < this._labels.length - 1) {
      const t = setTimeout(() => this._activateStep(index + 1), STEP_INTERVAL_MS);
      this._timers.push(t);
    }
  }

  _markDone(index) {
    const stepEl = this._container.querySelector(`#${this._container.id}-step-${index}`);
    const indEl  = this._container.querySelector(`#${this._container.id}-ind-${index}`);
    const timeEl = this._container.querySelector(`#${this._container.id}-time-${index}`);

    if (stepEl) { stepEl.classList.remove('active'); stepEl.classList.add('done'); }
    if (indEl)  { indEl.classList.remove('active', 'pending'); indEl.classList.add('done'); }

    if (timeEl) {
      const elapsed = ((Date.now() - this._startTime) / 1000).toFixed(1);
      timeEl.textContent = `${elapsed}s`;
    }
  }

  /**
   * Mark all remaining steps as done and collapse the panel after 1.2s.
   */
  complete() {
    if (this._done) return;
    this._done = true;

    // Clear pending timers
    this._timers.forEach(t => clearTimeout(t));
    this._timers = [];

    // Mark all as done
    for (let i = 0; i < this._labels.length; i++) {
      this._markDone(i);
    }

    // Update header
    if (this._spinnerEl) {
      this._spinnerEl.classList.remove('spin');
      this._spinnerEl.classList.add('done');
      this._spinnerEl.textContent = '✓';
    }
    if (this._titleEl) this._titleEl.textContent = 'All steps completed';
    if (this._countEl) this._countEl.textContent = `${this._labels.length} / ${this._labels.length}`;

    // Auto-collapse after 1.2s
    setTimeout(() => {
      this._collapsed = true;
      this._container.classList.add('collapsed');
    }, 1200);
  }

  /** Remove widget from DOM entirely. */
  remove() {
    this._timers.forEach(t => clearTimeout(t));
    if (this._el && this._el.parentNode) {
      this._el.parentNode.removeChild(this._el);
    }
  }

  /** Immediately advance through remaining steps (for fast responses). */
  skipToStep(index) {
    this._timers.forEach(t => clearTimeout(t));
    this._timers = [];
    for (let i = 0; i <= Math.min(index, this._labels.length - 1); i++) {
      this._markDone(i);
    }
    this._currentStep = index;
  }
}

// ── Utility ────────────────────────────────────────────────────────────────────

function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
