export type GameSfx = 'fire' | 'companion-fire' | 'hit' | 'kill' | 'hurt' | 'pickup' | 'extract' | 'storm'
  | 'command' | 'ui' | 'weapon' | 'boss' | 'boss-ability' | 'boss-down';

export class SoundEngine {
  private context?: AudioContext;
  private enabled = true;
  private readonly lastPlayed = new Map<GameSfx, number>();

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  async unlock(): Promise<void> {
    if (!this.enabled) return;
    const context = this.getContext();
    if (context.state === 'suspended') await context.resume();
  }

  play(name: GameSfx): void {
    if (!this.enabled) return;
    const now = performance.now();
    const minimumGap = name === 'companion-fire' ? 85 : name === 'fire' ? 45 : 28;
    if (now - (this.lastPlayed.get(name) ?? 0) < minimumGap) return;
    this.lastPlayed.set(name, now);
    const context = this.getContext();
    if (context.state === 'suspended') void context.resume();
    switch (name) {
      case 'fire':
        this.tone(190, 65, 0.065, 'square', 0.075);
        this.tone(72, 38, 0.09, 'sawtooth', 0.025);
        break;
      case 'companion-fire':
        this.tone(310, 110, 0.045, 'triangle', 0.035);
        break;
      case 'hit':
        this.tone(105, 42, 0.055, 'square', 0.04);
        break;
      case 'kill':
        this.tone(150, 44, 0.13, 'sawtooth', 0.06);
        this.tone(460, 180, 0.11, 'triangle', 0.035, 0.025);
        break;
      case 'hurt':
        this.tone(78, 31, 0.18, 'sawtooth', 0.075);
        break;
      case 'pickup':
        this.tone(480, 920, 0.11, 'sine', 0.045);
        break;
      case 'extract':
        this.tone(260, 340, 0.16, 'sine', 0.045);
        this.tone(390, 520, 0.18, 'sine', 0.045, 0.11);
        this.tone(540, 760, 0.22, 'sine', 0.05, 0.23);
        break;
      case 'storm':
        this.tone(58, 29, 0.48, 'sawtooth', 0.045);
        break;
      case 'command':
        this.tone(740, 520, 0.08, 'sine', 0.035);
        this.tone(940, 680, 0.07, 'triangle', 0.025, 0.07);
        break;
      case 'ui':
        this.tone(620, 760, 0.045, 'sine', 0.025);
        break;
      case 'weapon':
        this.tone(420, 260, 0.07, 'square', 0.035);
        this.tone(720, 840, 0.055, 'triangle', 0.025, 0.055);
        break;
      case 'boss':
        this.tone(66, 29, 0.62, 'sawtooth', 0.08);
        this.tone(102, 44, 0.48, 'square', 0.035, 0.12);
        break;
      case 'boss-ability':
        this.tone(220, 46, 0.52, 'sawtooth', 0.05);
        break;
      case 'boss-down':
        this.tone(94, 31, 0.5, 'sawtooth', 0.075);
        this.tone(320, 760, 0.42, 'sine', 0.05, 0.18);
        break;
    }
  }

  private getContext(): AudioContext {
    this.context ??= new AudioContext({ latencyHint: 'interactive' });
    return this.context;
  }

  private tone(
    startFrequency: number,
    endFrequency: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    delay = 0,
  ): void {
    const context = this.getContext();
    const startAt = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(startFrequency, startAt);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), startAt + duration);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(volume, startAt + Math.min(0.012, duration / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.02);
  }
}
