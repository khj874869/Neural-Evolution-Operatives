export type EnemyArchetype = 'drone' | 'raider' | 'stalker' | 'breaker' | 'jammer';

export interface CombatTelemetry {
  shots: number;
  hits: number;
  kills: number;
  damageTaken: number;
  distanceMoved: number;
  stationarySeconds: number;
}

export interface ThreatProfile {
  pressure: number;
  spawnCount: number;
  weights: Record<EnemyArchetype, number>;
  counterMessage: string;
}

export const freshTelemetry = (): CombatTelemetry => ({
  shots: 0, hits: 0, kills: 0, damageTaken: 0, distanceMoved: 0, stationarySeconds: 0,
});

export class AdaptiveDirector {
  private wave = 0;

  evaluate(telemetry: CombatTelemetry, accountLevel: number): ThreatProfile {
    this.wave += 1;
    const accuracy = telemetry.shots === 0 ? 0.35 : telemetry.hits / telemetry.shots;
    const survivalScore = Math.max(0, 1 - telemetry.damageTaken / 100);
    const performance = accuracy * 0.55 + survivalScore * 0.45;
    const pressure = Math.min(1, 0.2 + this.wave * 0.045 + accountLevel * 0.025 + performance * 0.25);
    const isCamping = telemetry.stationarySeconds > 11;
    const isAccurate = accuracy > 0.58 && telemetry.shots > 8;

    const weights: ThreatProfile['weights'] = { drone: 0.3, raider: 0.3, stalker: 0.16, breaker: 0.1, jammer: 0.14 };
    let counterMessage = '마더브레인 전술망이 탐사대를 분석 중입니다.';
    if (isCamping || isAccurate) {
      weights.stalker += 0.25;
      weights.drone -= 0.1;
      counterMessage = '장거리 사격 패턴 감지: 은폐형 우회 개체가 배치됩니다.';
    } else if (telemetry.distanceMoved > 2500) {
      weights.drone += 0.2;
      counterMessage = '고기동 패턴 감지: 추적 드론망이 강화됩니다.';
    } else if (telemetry.damageTaken > 55) {
      weights.breaker -= 0.07;
      weights.drone += 0.07;
      counterMessage = '위협도가 자동 조정되었습니다. 회복 창구를 확보하세요.';
    }

    return { pressure, spawnCount: Math.min(16, 3 + Math.floor(this.wave * 0.7 + pressure * 4)), weights, counterMessage };
  }

  pickArchetype(profile: ThreatProfile, random = Math.random): EnemyArchetype {
    const roll = random();
    let cursor = 0;
    for (const type of ['drone', 'raider', 'stalker', 'breaker', 'jammer'] as const) {
      cursor += Math.max(0, profile.weights[type]);
      if (roll <= cursor) return type;
    }
    return 'raider';
  }
}
