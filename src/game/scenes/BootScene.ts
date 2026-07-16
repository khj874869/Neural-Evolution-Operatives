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

    // Player: armored top-down silhouette with a rifle, shoulder plates and neural core.
    graphics.fillStyle(0x000000, 0.34).fillEllipse(24, 31, 38, 20);
    graphics.lineStyle(5, 0xffffff, 1).lineBetween(24, 14, 24, 1);
    graphics.fillStyle(0xffffff).fillRoundedRect(14, 12, 20, 27, 6);
    graphics.fillTriangle(14, 14, 5, 24, 15, 30).fillTriangle(34, 14, 43, 24, 33, 30);
    graphics.fillStyle(0x10201b).fillRoundedRect(19, 18, 10, 12, 3);
    graphics.fillStyle(0xffffff).fillCircle(24, 23, 3);
    graphics.lineStyle(2, 0xffffff, 0.72).strokeCircle(24, 24, 19);
    graphics.generateTexture('player', 48, 48);
    graphics.clear();

    // Squad operative: compact tactical frame with a bright link core.
    graphics.fillStyle(0x000000, 0.3).fillEllipse(16, 21, 27, 13);
    graphics.fillStyle(0xffffff).fillRoundedRect(8, 7, 16, 20, 5);
    graphics.fillTriangle(8, 10, 2, 18, 9, 22).fillTriangle(24, 10, 30, 18, 23, 22);
    graphics.fillStyle(0x0a1512).fillRoundedRect(12, 11, 8, 10, 2);
    graphics.fillStyle(0xffffff).fillCircle(16, 16, 2);
    graphics.lineStyle(2, 0xffffff, 0.6).lineBetween(16, 8, 16, 1);
    graphics.generateTexture('operative', 32, 32);
    graphics.clear();

    // Drone: four rotors and a central optical core.
    graphics.lineStyle(4, 0xffffff, 0.8).lineBetween(7, 7, 25, 25).lineBetween(25, 7, 7, 25);
    graphics.fillStyle(0xffffff).fillCircle(6, 6, 5).fillCircle(26, 6, 5).fillCircle(6, 26, 5).fillCircle(26, 26, 5);
    graphics.fillStyle(0xffffff).fillCircle(16, 16, 9);
    graphics.fillStyle(0x09120f).fillCircle(16, 16, 4);
    graphics.generateTexture('enemy-drone', 32, 32);
    graphics.clear();

    // Raider: asymmetric armor and a visible weapon profile.
    graphics.fillStyle(0x000000, 0.32).fillEllipse(19, 26, 32, 17);
    graphics.fillStyle(0xffffff).fillRoundedRect(8, 8, 22, 25, 5);
    graphics.fillTriangle(8, 10, 1, 22, 10, 25);
    graphics.fillStyle(0x0a1512).fillRect(12, 13, 12, 11);
    graphics.lineStyle(5, 0xffffff).lineBetween(28, 16, 38, 5);
    graphics.fillStyle(0xffffff).fillCircle(18, 18, 3);
    graphics.generateTexture('enemy-raider', 40, 40);
    graphics.clear();

    // Stalker: narrow frame with scythe-like flanking limbs.
    graphics.fillStyle(0xffffff).fillTriangle(17, 3, 26, 25, 17, 31).fillTriangle(17, 3, 8, 25, 17, 31);
    graphics.lineStyle(4, 0xffffff).lineBetween(10, 14, 1, 27).lineBetween(24, 14, 33, 27);
    graphics.fillStyle(0x09120f).fillCircle(17, 17, 5);
    graphics.fillStyle(0xffffff).fillCircle(17, 17, 2);
    graphics.generateTexture('enemy-stalker', 34, 34);
    graphics.clear();

    // Breaker: heavy siege chassis with frontal shield plating.
    graphics.fillStyle(0x000000, 0.38).fillEllipse(28, 37, 48, 22);
    graphics.fillStyle(0xffffff).fillRoundedRect(10, 10, 36, 35, 8);
    graphics.fillStyle(0x0a1512).fillRoundedRect(17, 17, 22, 18, 4);
    graphics.lineStyle(5, 0xffffff).strokeRoundedRect(6, 6, 44, 43, 9);
    graphics.fillStyle(0xffffff).fillCircle(21, 25, 3).fillCircle(35, 25, 3);
    graphics.lineStyle(5, 0xffffff).lineBetween(13, 34, 4, 47).lineBetween(43, 34, 52, 47);
    graphics.generateTexture('enemy-breaker', 56, 56);
    graphics.clear();

    graphics.fillStyle(0xffffff).fillRoundedRect(0, 2, 16, 4, 2);
    graphics.fillTriangle(16, 0, 24, 4, 16, 8);
    graphics.generateTexture('bullet', 24, 8);
    graphics.clear();

    graphics.fillStyle(0xffffff).fillTriangle(0, 5, 15, 0, 15, 10);
    graphics.generateTexture('muzzle', 15, 10);
    graphics.clear();

    graphics.fillStyle(0xffffff).fillRect(0, 1, 12, 2);
    graphics.generateTexture('spark', 12, 4);
    graphics.clear();

    graphics.fillStyle(0xffffff).fillRoundedRect(3, 5, 18, 14, 3);
    graphics.fillStyle(0x09120f).fillRect(7, 8, 10, 3);
    graphics.lineStyle(2, 0xffffff).strokeRect(1, 3, 22, 18);
    graphics.generateTexture('resource-scrap', 24, 24);
    graphics.clear();

    graphics.fillStyle(0xffffff).fillCircle(12, 12, 10);
    graphics.fillStyle(0x09120f).fillTriangle(12, 4, 6, 16, 18, 16);
    graphics.generateTexture('resource-water', 24, 24);
    graphics.clear();

    graphics.fillStyle(0xffffff).fillRoundedRect(3, 3, 18, 18, 4);
    graphics.fillStyle(0x09120f).fillRect(8, 8, 8, 8);
    graphics.lineStyle(2, 0xffffff).lineBetween(0, 8, 4, 8).lineBetween(20, 16, 24, 16);
    graphics.generateTexture('resource-data', 24, 24);
    graphics.clear();

    graphics.fillStyle(0xffffff).fillTriangle(12, 1, 23, 12, 12, 23).fillTriangle(12, 1, 1, 12, 12, 23);
    graphics.fillStyle(0x09120f).fillCircle(12, 12, 4);
    graphics.generateTexture('resource-cores', 24, 24);
    graphics.clear();

    // Broken concrete slab with internal reinforcement and cracks.
    graphics.fillStyle(0xffffff, 0.12).fillRoundedRect(5, 9, 86, 78, 7);
    graphics.lineStyle(3, 0xffffff, 0.25).strokeRoundedRect(5, 9, 86, 78, 7);
    graphics.lineStyle(2, 0xffffff, 0.16).lineBetween(17, 20, 41, 46).lineBetween(41, 46, 30, 72)
      .lineBetween(78, 15, 55, 43).lineBetween(55, 43, 76, 76);
    graphics.fillStyle(0x000000, 0.2).fillRect(13, 14, 25, 8).fillRect(61, 64, 23, 14);
    graphics.generateTexture('ruin', 96, 96);
    graphics.clear();

    graphics.fillStyle(0x000000, 0.22).fillEllipse(36, 47, 62, 20);
    graphics.fillStyle(0xffffff, 0.2).fillRoundedRect(7, 18, 58, 25, 9);
    graphics.lineStyle(3, 0xffffff, 0.28).strokeRoundedRect(7, 18, 58, 25, 9);
    graphics.fillStyle(0x000000, 0.35).fillCircle(20, 43, 8).fillCircle(53, 43, 8);
    graphics.lineStyle(2, 0xffffff, 0.2).lineBetween(18, 19, 28, 5).lineBetween(28, 5, 38, 18);
    graphics.generateTexture('wreck', 72, 56);
    graphics.destroy();
  }
}
