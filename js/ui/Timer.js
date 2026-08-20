/**
 * Timer.js
 * Wall-clock game timer with pause/resume. Measured against Date.now() rather
 * than by accumulating ticks, so a throttled background tab cannot drift.
 */

export class Timer {
  constructor(onTick) {
    this.onTick = onTick;
    this._elapsed = 0; // ms banked from previous runs
    this._startedAt = null; // Date.now() when the current run began
    this._interval = null;
    this.running = false;
  }

  get elapsedMs() {
    return this._elapsed + (this._startedAt ? Date.now() - this._startedAt : 0);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._startedAt = Date.now();
    this._interval = setInterval(() => this.onTick?.(this.elapsedMs), 250);
    this.onTick?.(this.elapsedMs);
  }

  pause() {
    if (!this.running) return;
    this._elapsed = this.elapsedMs;
    this._startedAt = null;
    this.running = false;
    clearInterval(this._interval);
    this._interval = null;
    this.onTick?.(this._elapsed);
  }

  toggle() {
    if (this.running) this.pause();
    else this.start();
  }

  reset(toMs = 0) {
    const wasRunning = this.running;
    this.pause();
    this._elapsed = toMs;
    this.onTick?.(this._elapsed);
    if (wasRunning) this.start();
  }

  /** Restore a saved time without starting the clock. */
  setElapsed(ms) {
    this._elapsed = ms;
    if (this._startedAt) this._startedAt = Date.now();
    this.onTick?.(this.elapsedMs);
  }

  stop() {
    this.pause();
  }
}

/** 754000 -> "12:34"; hours appear only when needed. */
export function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
