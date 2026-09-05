import type { OperationId, OperationStage } from '../../../packages/shared/src/operations';

export type GameSfx = 'fire' | 'fire-scatter' | 'fire-rail' | 'armor-hit' | 'radio' | 'objective'
  | 'companion-fire' | 'hit' | 'kill' | 'hurt' | 'pickup' | 'extract' | 'storm'
  | 'command' | 'ui' | 'weapon' | 'dash' | 'boss' | 'boss-ability' | 'boss-down' | 'neural-link';

export class SoundEngine {
  private context?: AudioContext;
  private enabled = true;
  private active = true;
  private master?: GainNode;
  private noiseBuffer?: AudioBuffer;
  private ambience?: { source: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode };
  private mood: { operation: OperationId; stage: OperationStage } = { operation: 'operation-zero', stage: 'SCAVENGE' };
  private readonly lastPlayed = new Map<GameSfx, number>();

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.updateMix();
  }

  setActive(active: boolean): void { this.active = active; this.updateMix(); }

  setScene(operation: OperationId, stage: OperationStage): void {
    this.mood = { operation, stage };
    this.updateMix();
  }

  async unlock(): Promise<void> {
    if (!this.enabled) return;
    try {
      const context = this.getContext();
      if (context.state !== 'running') await context.resume();
      this.updateMix();
    } catch { /* The next user gesture retries audio on restrictive WebViews. */ }
  }

  play(name: GameSfx): void {
    if (!this.enabled || !this.active) return;
    const now = performance.now();
    const minimumGap = name === 'companion-fire' ? 85 : name === 'fire' ? 45 : 28;
    if (now - (this.lastPlayed.get(name) ?? 0) < minimumGap) return;
    this.lastPlayed.set(name, now);
    const context = this.context;
    // Only a user gesture opens the context. Never queue sounds behind autoplay.
    if (!context || context.state !== 'running') return;
    switch (name) {
      case 'fire':
        this.noise(0.085, 0.16, 2200, 'highpass');
        this.tone(190, 65, 0.065, 'square', 0.075);
        this.tone(72, 38, 0.09, 'sawtooth', 0.025);
        break;
      case 'fire-scatter':
        this.noise(0.24, 0.26, 1500, 'lowpass');
        this.tone(120, 32, 0.22, 'triangle', 0.2);
        this.noise(0.055, 0.07, 3200, 'highpass', 0.12);
        break;
      case 'fire-rail':
        this.tone(1600, 120, 0.26, 'sawtooth', 0.08);
        this.tone(80, 35, 0.25, 'sine', 0.18);
        this.noise(0.16, 0.15, 4600, 'bandpass');
        this.tone(920, 340, 0.25, 'sine', 0.03, 0.07);
        break;
      case 'armor-hit':
        this.noise(0.075, 0.12, 3400, 'highpass');
        this.tone(1750, 900, 0.12, 'triangle', 0.07);
        this.tone(640, 260, 0.09, 'square', 0.04);
        break;
      case 'radio':
        this.noise(0.1, 0.035, 1900, 'bandpass');
        this.tone(880, 880, 0.065, 'sine', 0.025);
        this.tone(1174, 1174, 0.09, 'sine', 0.025, 0.1);
        break;
      case 'objective':
        [392, 494, 587].forEach((note, i) => this.tone(note, note, 0.22, 'triangle', 0.045, i * 0.1));
        break;
      case 'companion-fire':
        this.tone(310, 110, 0.045, 'triangle', 0.035);
        break;
      case 'hit':
        this.noise(0.07, 0.14, 1200, 'bandpass');
        this.tone(105, 42, 0.055, 'square', 0.04);
        break;
      case 'kill':
        this.noise(0.22, 0.16, 780, 'lowpass');
        this.tone(150, 44, 0.13, 'sawtooth', 0.06);
        this.tone(460, 180, 0.11, 'triangle', 0.035, 0.025);
        break;
      case 'hurt':
        this.noise(0.14, 0.1, 420, 'lowpass');
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
      case 'dash':
        this.tone(520, 92, 0.16, 'sawtooth', 0.04);
        this.tone(880, 260, 0.1, 'triangle', 0.025, 0.02);
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
      case 'neural-link':
        this.tone(180, 980, 0.42, 'sawtooth', 0.055);
        this.tone(440, 1320, 0.34, 'triangle', 0.045, 0.08);
        this.tone(110, 220, 0.5, 'square', 0.028, 0.16);
        break;
    }
  }

  private getContext(): AudioContext {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.context.createGain();
      this.master.gain.value = 0;
      const limiter = this.context.createDynamicsCompressor();
      limiter.threshold.value = -12;
      limiter.knee.value = 12;
      limiter.ratio.value = 8;
      this.master.connect(limiter).connect(this.context.destination);
      const buffer = this.context.createBuffer(1, this.context.sampleRate * 2, this.context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buffer;
      this.updateMix();
    }
    return this.context;
  }

  private updateMix(): void {
    const context = this.context;
    if (!context || !this.master) return;
    const audible = this.enabled && this.active;
    this.master.gain.setTargetAtTime(audible ? 0.72 : 0, context.currentTime, 0.04);
    if (audible && context.state === 'running' && !this.ambience) {
      const source = context.createBufferSource();
      source.buffer = this.noiseBuffer!;
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = this.mood.operation === 'operation-ashfall' ? 300 : 850;
      const gain = context.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(this.master);
      source.start();
      this.ambience = { source, filter, gain };
    }
    if (this.ambience) {
      const danger = this.mood.stage === 'WARDEN' || this.mood.stage === 'RELAY';
      this.ambience.filter.frequency.setTargetAtTime(this.mood.operation === 'operation-ashfall' ? 300 : 850, context.currentTime, 0.5);
      this.ambience.gain.gain.setTargetAtTime(audible ? (danger ? 0.065 : 0.035) : 0, context.currentTime, 0.5);
    }
  }

  private noise(duration: number, volume: number, frequency: number, type: BiquadFilterType, delay = 0): void {
    const context = this.getContext();
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer!;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const gain = context.createGain();
    const start = context.currentTime + delay;
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(gain).connect(this.master!);
    source.start(start, Math.random());
    source.stop(start + duration + 0.01);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
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
    oscillator.connect(gain).connect(this.master!);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.02);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
}
