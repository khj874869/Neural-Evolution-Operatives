import type { Resources } from '../state/GameState';

export interface Mission {
  codename: string;
  description: string;
  targetKills: number;
  targetResource: keyof Pick<Resources, 'scrap' | 'water' | 'data'>;
  targetAmount: number;
  hazard: 'radiation' | 'acid-rain' | 'thermal-drop';
}

const codenames = ['GLASS VEIL', 'ASH MEMORY', 'BROKEN CHOIR', 'COLD CIRCUIT', 'NULL DAWN'];

export function generateMission(level: number, resources: Resources, seed = Date.now()): Mission {
  const deficits: Array<'scrap' | 'water' | 'data'> = ['scrap', 'water', 'data'];
  deficits.sort((a, b) => resources[a] - resources[b]);
  const targetResource = deficits[0];
  const random = mulberry32(seed);
  const hazards: Mission['hazard'][] = ['radiation', 'acid-rain', 'thermal-drop'];
  const hazard = hazards[Math.floor(random() * hazards.length)];
  return {
    codename: codenames[Math.floor(random() * codenames.length)],
    description: `${targetResource.toUpperCase()} 보급선 회수 / ${hazard.toUpperCase()} 경보`,
    targetKills: 8 + level * 2,
    targetResource,
    targetAmount: 18 + level * 6,
    hazard,
  };
}

function mulberry32(seed: number) {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
