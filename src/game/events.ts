import Phaser from 'phaser';
import type { PlayerSettings } from './settings';
import type { GameSfx } from './systems/SoundEngine';

export const gameEvents = new Phaser.Events.EventEmitter();

export interface MobileInputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  fire: boolean;
  dash: boolean;
  extract: boolean;
}

export type { GameSfx, PlayerSettings };
