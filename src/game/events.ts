import Phaser from 'phaser';

export const gameEvents = new Phaser.Events.EventEmitter();

export interface MobileInputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  fire: boolean;
}
