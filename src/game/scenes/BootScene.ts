import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create(): void {
    this.createTextures();
    this.scene.start('WorldScene');
  }

  private createTextures(): void {
    const graphics = this.add.graphics();

    graphics.fillStyle(0xffffff).lineStyle(2, 0xffffff, 0.65);
    graphics.fillTriangle(18, 1, 33, 34, 18, 27);
    graphics.strokeCircle(18, 18, 16);
    graphics.generateTexture('player', 36, 36);
    graphics.clear();

    graphics.fillStyle(0xffffff).fillCircle(10, 10, 9);
    graphics.lineStyle(2, 0x07110f).strokeCircle(10, 10, 5);
    graphics.generateTexture('operative', 20, 20);
    graphics.clear();

    graphics.fillStyle(0xffffff).fillRect(2, 2, 22, 22);
    graphics.lineStyle(2, 0x07110f).strokeRect(6, 6, 14, 14);
    graphics.generateTexture('enemy', 26, 26);
    graphics.clear();

    graphics.fillStyle(0xffffff).fillCircle(4, 4, 4);
    graphics.generateTexture('bullet', 8, 8);
    graphics.clear();

    graphics.fillStyle(0xffffff);
    graphics.fillTriangle(9, 0, 18, 9, 9, 18);
    graphics.fillTriangle(9, 0, 0, 9, 9, 18);
    graphics.generateTexture('resource', 18, 18);
    graphics.clear();

    graphics.fillStyle(0xffffff, 0.12).fillRect(0, 0, 80, 80);
    graphics.lineStyle(2, 0xffffff, 0.26).strokeRect(3, 3, 74, 74);
    graphics.generateTexture('ruin', 80, 80);
    graphics.destroy();
  }
}
