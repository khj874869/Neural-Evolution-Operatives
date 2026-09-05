import Phaser from 'phaser';
import type { OperationId, OperationStage } from '../../../packages/shared/src/operations';
import { worldSectors, type WorldObstacle } from '../../../packages/shared/src/world';

/** Static geometry is built once; only a small weather pool moves each frame. */
export class WorldScenery {
  private weather: Phaser.GameObjects.Arc[] = [];
  private beacons: Phaser.GameObjects.Arc[] = [];
  private ash: boolean;
  constructor(private scene: Phaser.Scene, operationId: OperationId, cover: readonly WorldObstacle[]) {
    this.ash = operationId === 'operation-ashfall';
    const g = scene.add.graphics().setDepth(-3);
    const detail = scene.add.graphics().setDepth(2.1);
    const accent = this.ash ? 0xffae66 : 0x7adbd2;
    // Broad asphalt streets, fractured lane paint, service ducts, and drainage.
    g.lineStyle(132, 0x141f22, 0.95).lineBetween(180, 1200, 2220, 1200);
    g.lineStyle(122, 0x172024, 0.95).lineBetween(1200, 220, 1200, 2220);
    for (let p = 190; p < 2230; p += 78) {
      g.lineStyle(3, 0xc9bf80, 0.38).lineBetween(p, 1200, p + 35, 1200)
        .lineBetween(1200, p, 1200, p + 35);
      g.lineStyle(2, 0x59716b, 0.35).lineBetween(p, 1130, p + 55, 1130)
        .lineBetween(1270, p, 1270, p + 55);
    }
    for (const sector of worldSectors(operationId)) {
      const { x, y, kind } = sector;
      if (kind === 'salvage' && !this.ash) {
        if (sector.id.endsWith('west')) {
          g.fillStyle(0x113c49, 0.8).fillEllipse(x, y, 510, 365);
          for (let i = 0; i < 16; i++) {
            const dy = -145 + i * 19;
            g.lineStyle(2, 0x64d9dc, 0.18).lineBetween(x - 170 + i % 3 * 28, y + dy, x + 160 - i % 4 * 20, y + dy - 8);
          }
          for (let i = 0; i < 5; i++) {
            g.fillStyle(i % 2 ? 0x405d58 : 0x32474c, 1).fillRect(x - 210 + i * 85, y - 192, 64, 35);
            g.fillStyle(i % 2 ? 0xc49b57 : 0x6ba397, 0.8).fillRect(x - 210 + i * 85, y - 166, 64, 8);
          }
          this.label(x, y - 211, 'MERCURY MARKET / 침수 상가', '#7ee2dc');
        } else {
          g.fillStyle(0x353c3e, 1).fillRect(x - 78, y - 290, 156, 580);
          for (const dx of [-49, 49]) g.lineStyle(5, 0x8c9792, 0.7).lineBetween(x + dx, y - 290, x + dx, y + 290);
          for (let dy = -280; dy < 280; dy += 24) g.lineStyle(6, 0x1c2526, 1).lineBetween(x - 67, y + dy, x + 67, y + dy);
          g.fillStyle(0x364f4d, 1).fillRoundedRect(x + 100, y - 90, 74, 200, 10);
          for (let dy = -60; dy < 90; dy += 38) g.fillStyle(0x77b9b0, 0.5).fillRect(x + 112, y + dy, 49, 22);
          this.label(x, y - 310, 'LINE 07 / 운행 중단', '#b7c7bf');
        }
      } else if (kind === 'salvage') {
        for (let i = 0; i < 5; i++) {
          g.fillStyle(0x34221b, 1).fillEllipse(x - 130 + i * 64, y + (i % 2) * 80, 145, 110);
          g.lineStyle(3, 0xff9355, 0.24).strokeEllipse(x - 130 + i * 64, y + (i % 2) * 80, 120, 88);
        }
        this.label(x, y - 188, 'MEMORY SINK / 기억 침전지', '#ffbb82');
      } else if (kind === 'combat') {
        g.fillStyle(this.ash ? 0x392b24 : 0x293336, 1).fillRect(x - 235, y - 160, 470, 320);
        for (let i = -4; i <= 4; i++) {
          g.fillStyle(0xd5cbb1, 0.4).fillRect(x + i * 43, y - 148, 21, 55);
          g.fillStyle(0x0c1516, 0.6).fillRect(x + i * 44, y + 82, 28, 65);
        }
        g.lineStyle(12, 0x080e10, 1).lineBetween(x - 190, y + 38, x - 25, y - 20).lineBetween(x - 25, y - 20, x + 225, y + 62);
        this.label(x, y - 186, this.ash ? 'HARVEST TRENCH / 수확선 참호' : 'EVACUATION / 대피로 봉쇄', '#f4bd72');
      } else if (kind === 'boss') {
        g.fillStyle(0x182328, 1).fillCircle(x, y, 265);
        g.lineStyle(12, 0x3b4a50, 1).strokeCircle(x, y, 254);
        for (let i = 0; i < 12; i++) {
          const a = i * Math.PI / 6;
          g.lineStyle(5, 0x55646a, 0.7).lineBetween(x + Math.cos(a) * 150, y + Math.sin(a) * 150, x + Math.cos(a) * 248, y + Math.sin(a) * 248);
        }
        g.lineStyle(4, 0xff6179, 0.5).strokeCircle(x, y, 148);
        g.fillStyle(0x0b1118, 1).fillCircle(x, y, 112);
        this.label(x, y + 180, this.ash ? 'HECATON / MEMORY HARVEST' : 'CERBERUS / CIVIC CONTROL', '#ff8a97');
      } else if (kind === 'relay') {
        g.fillStyle(0x2d2237, 1).fillRoundedRect(x - 90, y - 90, 180, 180, 18);
        g.lineStyle(3, 0xd57bff, 0.6).strokeCircle(x, y, 76);
        for (let i = -2; i <= 2; i++) g.lineStyle(2, 0xd57bff, 0.4).lineBetween(x + i * 24, y + 86, x + i * 24, y + 140);
      } else if (kind === 'extract') {
        g.fillStyle(0x334849, 1).fillRoundedRect(x - 123, y - 114, 246, 228, 22);
        g.fillStyle(0x132a2e, 1).fillCircle(x, y, 96);
        g.lineStyle(6, 0x66e0c0, 0.8).strokeCircle(x, y, 98);
        for (let i = -3; i <= 3; i++) g.lineStyle(2, 0x416564, 1).lineBetween(x - 66, y + i * 18, x + 66, y + i * 18);
        this.label(x, y + 109, 'SHELTER 01 / 귀환 리프트', '#b5fff0');
      }
      const lamp = scene.add.circle(x - 100, y - 60, 5, accent, 0.8).setDepth(2.2);
      lamp.setData('stage', sector.stage);
      this.beacons.push(lamp);
    }
    // Dress the exact collision footprints instead of introducing invisible walls.
    cover.forEach((o, index) => {
      const left = o.x - o.width / 2, top = o.y - o.height / 2;
      g.fillStyle(0x020807, 0.8).fillRect(left + 13, top + 15, o.width + 6, o.height + 6);
      detail.fillStyle(this.ash ? 0x695046 : 0x4b6463, 0.95).fillRect(left + 4, top + 4, o.width - 8, o.height - 8);
      detail.lineStyle(3, this.ash ? 0xa87855 : 0x8ca6a0, 0.7).lineBetween(left + 4, top + 4, left + o.width - 4, top + 4);
      const horizontal = o.width > o.height;
      for (let k = 16; k < (horizontal ? o.width : o.height) - 16; k += 30) {
        detail.fillStyle(index % 3 ? 0x192d32 : 0xa98447, 0.9).fillRect(left + (horizontal ? k : 12), top + (horizontal ? 13 : k), horizontal ? 17 : o.width - 24, horizontal ? o.height - 30 : 16);
      }
      detail.lineStyle(3, 0x152327, 0.9).lineBetween(left + 5, top + o.height * 0.6, left + o.width * 0.6, top + o.height * 0.4);
    });
    const rng = new Phaser.Math.RandomDataGenerator([operationId, 'weather']);
    for (let i = 0; i < 28; i++) this.weather.push(scene.add.circle(rng.between(0, 2400), rng.between(0, 2400), this.ash ? 2 : 1.5, this.ash ? 0xffca91 : 0x98dde3, 0.3).setDepth(7));
  }

  setStage(stage: OperationStage): void {
    for (const lamp of this.beacons) lamp.setFillStyle(lamp.getData('stage') === stage ? 0xb9ffdf : 0x70817a,
      lamp.getData('stage') === stage ? 1 : 0.3);
  }

  update(delta: number, reducedMotion: boolean, lowQuality: boolean): void {
    this.weather.forEach((particle, i) => {
      particle.setVisible(!reducedMotion && (!lowQuality || i < 10));
      if (!particle.visible) return;
      particle.x = (particle.x + delta * (this.ash ? 0.025 : -0.04) + 2400) % 2400;
      particle.y = (particle.y + delta * (this.ash ? 0.025 : 0.2)) % 2400;
    });
  }

  private label(x: number, y: number, text: string, color: string): void {
    this.scene.add.text(x, y, text, { fontFamily: 'monospace', fontSize: '13px', color,
      backgroundColor: '#071014dd', padding: { x: 10, y: 5 } }).setOrigin(0.5).setDepth(1);
  }
}
