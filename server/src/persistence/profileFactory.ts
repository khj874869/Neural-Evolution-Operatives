import { randomUUID } from 'node:crypto';
import type { PlayerProfile } from '../../../packages/shared/src/protocol.js';

export function createPlayerProfile(deviceId: string, now = new Date()): PlayerProfile {
  return {
    version: 1,
    playerId: randomUUID(),
    deviceId,
    displayName: `SURVIVOR-${Math.floor(Math.random() * 9000 + 1000)}`,
    resources: { scrap: 180, water: 120, data: 45, cores: 10 },
    shelter: { command: 1, purifier: 1, workshop: 1, greenhouse: 0 },
    operators: [
      { id: 'aegis-07', level: 1, bond: 5, memories: ['붉은 구역 첫 링크를 동기화했다.'] },
      { id: 'ratchet', level: 1, bond: 2, memories: [] },
      { id: 'lumen', level: 1, bond: 2, memories: [] },
    ],
    squad: ['aegis-07', 'ratchet', 'lumen'],
    pity: 0,
    accountLevel: 1,
    xp: 0,
    lastSeenAt: now.toISOString(),
    createdAt: now.toISOString(),
  };
}
