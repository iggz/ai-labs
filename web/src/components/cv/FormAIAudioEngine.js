/**
 * FormAIAudioEngine.js — Web Audio API Feedback Synthesizer
 * ===========================================================
 * Synthesizes audio feedback for FormAI Coach using the Web Audio API.
 * No audio files required — all sounds are generated programmatically.
 *
 * Sounds:
 *   playDepthAchievedPing() — C5→E5 chime when target depth is reached
 *   playAlignmentWarning()  — Soft triangle wave tone for form observations
 *   resume()                — Must call after user interaction (browser policy)
 */

export class FormAIAudioEngine {
  constructor() {
    this.audioCtx = null;
    this.lastPingTime = 0;
    this.MIN_PING_INTERVAL = 800; // ms — prevent rapid-fire pings
    this._initialized = false;
  }

  /**
   * Initialize the AudioContext after a user gesture (browser autoplay policy).
   * Safe to call multiple times — idempotent.
   */
  resume() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        console.warn('Web Audio API not supported in this browser.');
        return;
      }
      this.audioCtx = new AudioContextClass();
      this._initialized = true;
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  _throttle() {
    const now = Date.now();
    if (now - this.lastPingTime < this.MIN_PING_INTERVAL) return false;
    this.lastPingTime = now;
    return true;
  }

  /**
   * Two-tone chime (C5 → E5): played when squat depth target is achieved.
   * Satisfying, encouraging — not alarming.
   */
  playDepthAchievedPing() {
    if (!this._initialized || !this._throttle()) return;
    const ctx = this.audioCtx;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, now);        // C5
    osc.frequency.setValueAtTime(659.25, now + 0.08); // E5

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  /**
   * Soft triangle wave tone (E4): played for neutral alignment observations.
   * Warm, non-alarming — not a warning buzzer.
   */
  playAlignmentWarning() {
    if (!this._initialized || !this._throttle()) return;
    const ctx = this.audioCtx;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(330, now); // E4

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.5);
  }

  /**
   * Gentle confirmation tone: played on rep count increment.
   */
  playRepCountPing() {
    if (!this._initialized || !this._throttle()) return;
    const ctx = this.audioCtx;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(392.0, now); // G4

    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  destroy() {
    if (this.audioCtx) {
      this.audioCtx.close();
      this.audioCtx = null;
      this._initialized = false;
    }
  }
}
