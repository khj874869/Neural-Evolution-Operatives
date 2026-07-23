export type GraphicsQuality = 'auto' | 'high' | 'balanced' | 'low';
export type RenderTier = Exclude<GraphicsQuality, 'auto'>;

export interface RenderProfile {
  particleScale: number;
  hudIntervalMs: number;
}

export interface PerformanceSample {
  tier: RenderTier;
  fps: number;
  changed: boolean;
}

export const RENDER_PROFILES: Readonly<Record<RenderTier, RenderProfile>> = Object.freeze({
  high: Object.freeze({ particleScale: 1, hudIntervalMs: 80 }),
  balanced: Object.freeze({ particleScale: 0.64, hudIntervalMs: 110 }),
  low: Object.freeze({ particleScale: 0.34, hudIntervalMs: 150 }),
});

const TIERS: RenderTier[] = ['low', 'balanced', 'high'];

export class PerformanceGovernor {
  private elapsedMs = 0;
  private frames = 0;
  private poorWindows = 0;
  private healthyWindows = 0;
  private currentTier: RenderTier;

  constructor(private mode: GraphicsQuality, private mobileHint = false) {
    this.currentTier = initialRenderTier(mode, mobileHint);
  }

  get tier(): RenderTier {
    return this.currentTier;
  }

  get profile(): RenderProfile {
    return RENDER_PROFILES[this.currentTier];
  }

  setMode(mode: GraphicsQuality, mobileHint = this.mobileHint): RenderTier {
    this.mode = mode;
    this.mobileHint = mobileHint;
    this.currentTier = initialRenderTier(mode, mobileHint);
    this.resetWindow();
    this.poorWindows = 0;
    this.healthyWindows = 0;
    return this.currentTier;
  }

  sample(deltaMs: number): PerformanceSample | null {
    this.elapsedMs += Math.min(250, Math.max(0, deltaMs));
    this.frames += 1;
    if (this.elapsedMs < 2_000) return null;

    const fps = Math.round(this.frames / this.elapsedMs * 1_000);
    this.resetWindow();
    let changed = false;
    if (this.mode === 'auto') {
      this.poorWindows = fps < 44 ? this.poorWindows + 1 : 0;
      this.healthyWindows = fps > 57 ? this.healthyWindows + 1 : 0;
      if (this.poorWindows >= 2) {
        changed = this.shiftTier(-1);
      } else if (this.healthyWindows >= 4) {
        changed = this.shiftTier(1);
      }
      if (changed) {
        this.poorWindows = 0;
        this.healthyWindows = 0;
      }
    }
    return { tier: this.currentTier, fps, changed };
  }

  private shiftTier(direction: -1 | 1): boolean {
    const nextIndex = Math.max(0, Math.min(TIERS.length - 1, TIERS.indexOf(this.currentTier) + direction));
    const next = TIERS[nextIndex];
    if (next === this.currentTier) return false;
    this.currentTier = next;
    return true;
  }

  private resetWindow(): void {
    this.elapsedMs = 0;
    this.frames = 0;
  }
}

export function initialRenderTier(mode: GraphicsQuality, mobileHint = false): RenderTier {
  return mode === 'auto' ? (mobileHint ? 'balanced' : 'high') : mode;
}
