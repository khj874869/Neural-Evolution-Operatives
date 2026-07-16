import type { TokenService } from '../auth/TokenService.js';
import type { EconomyService } from '../economy/EconomyService.js';
import type { PlayerRepository } from '../persistence/PlayerRepository.js';

export interface RoomDependencies {
  tokens: TokenService;
  repository: PlayerRepository;
  economy: EconomyService;
}

let dependencies: RoomDependencies | undefined;

export function configureRoomDependencies(next: RoomDependencies): void {
  dependencies = next;
}

export function roomDependencies(): RoomDependencies {
  if (!dependencies) throw new Error('Room dependencies are not configured');
  return dependencies;
}
