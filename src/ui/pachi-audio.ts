import type { PachiSessionEvent } from "../game/pachi-types";

/** Short original synthesised cues. No downloads, autoplay, or audio-owned timers. */
export class PachiAudio {
  private context: AudioContext | null = null;
  private enabled = false;
  private suspended = false;
  private disposed = false;
  private voices = new Set<OscillatorNode>();

  public async setEnabled(enabled: boolean): Promise<boolean> {
    if (this.disposed) return false;
    this.enabled = enabled;
    if (!enabled) { this.silence(); return false; }
    try {
      this.context ??= new AudioContext();
      if (!this.suspended) await this.context.resume();
      return true;
    } catch { this.enabled = false; return false; }
  }

  public setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    if (suspended) this.silence();
  }

  public play(event: PachiSessionEvent): void {
    if (!this.enabled || this.suspended || !this.context || this.context.state !== "running") return;
    switch (event.type) {
      case "fired": this.tone(180, .035, .025, 0, "triangle"); break;
      case "start-entry": if (event.accepted !== false) this.notes([523, 784], .075, .06); break;
      case "side-entry": this.tone(440, .06, .025); break;
      case "spin-start": this.notes([330, 392, 494], .06, .035); break;
      case "spin-reach": this.notes([587, 740, 880, 1175], .14, .055); break;
      case "spin-push": this.tone(740, .075, .045, 0, "triangle"); break;
      case "spin-reveal": if (!event.win) this.notes([330, 247], .09, .03); break;
      case "jackpot-start": this.notes([523, 659, 784, 1047, 1319, 1568], .115, .09); break;
      case "attacker-entry": this.notes([1047, 1568], .05, .045); break;
      case "rush-judge": this.notes([659, 784, 988], .15, .045); break;
      case "rush-continue": this.notes([784, 988, 1175, 1568], .10, .07); break;
      case "rush-end": this.notes([784, 659, 523], .09, .04); break;
      case "result": this.notes([392, 523, 659], .13, .04); break;
    }
  }

  public destroy(): void {
    this.disposed = true;
    this.enabled = false;
    this.silence();
    if (this.context) void this.context.close().catch(() => undefined);
    this.context = null;
  }

  private notes(frequencies: readonly number[], gap: number, volume: number): void {
    frequencies.forEach((frequency, index) => this.tone(frequency, gap * 1.45, volume, gap * index));
  }

  private tone(frequency: number, duration: number, volume: number, delay = 0, type: OscillatorType = "sine"): void {
    const context = this.context;
    if (!context || this.voices.size >= 24) return;
    try {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const at = context.currentTime + delay;
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, at);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(volume, at + .006);
      gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      this.voices.add(oscillator);
      oscillator.onended = () => { this.voices.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(at);
      oscillator.stop(at + duration + .01);
    } catch { /* Audio must never interrupt the score or the physical world. */ }
  }

  private silence(): void {
    for (const oscillator of this.voices) { try { oscillator.stop(); } catch { /* Already ended. */ } }
    this.voices.clear();
  }
}
