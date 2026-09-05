import Phaser from 'phaser';
import { WorldScenery } from '../src/game/scenes/WorldScenery';
import { worldObstacles, worldSectors } from '../packages/shared/src/world';
import { SoundEngine, type GameSfx } from '../src/game/systems/SoundEngine';
import type { OperationId } from '../packages/shared/src/operations';

const operation = document.querySelector<HTMLSelectElement>('#operation')!;
const sector = document.querySelector<HTMLSelectElement>('#sector')!;
let game: Phaser.Game | undefined;
function render() {
  const id = operation.value as OperationId;
  const sectors = worldSectors(id);
  sector.innerHTML = sectors.map((s, i) => `<option value="${i}">${s.label}</option>`).join('');
  game?.destroy(true);
  class Preview extends Phaser.Scene {
    create() {
      new WorldScenery(this, id, worldObstacles(id));
      this.cameras.main.setBounds(0, 0, 2400, 2400);
      const focus = () => { const s = sectors[Number(sector.value)]; this.cameras.main.centerOn(s.x, s.y); };
      sector.onchange = focus;
      focus();
    }
  }
  game = new Phaser.Game({ type: Phaser.AUTO, parent:'view', width:innerWidth, height:innerHeight * 0.75,
    backgroundColor: id === 'operation-zero' ? '#15282b' : '#241b19', scene:[Preview] });
}
operation.onchange = render;
render();

// Render the real synthesis graph to PCM, checking energy and clipping without speakers.
document.querySelector('#sound')!.addEventListener('click', async () => {
  const output = document.querySelector('#result')!;
  output.textContent = 'Rendering real Web Audio graphs…';
  const results = [];
  const NativeContext = window.AudioContext;
  try {
    for (const name of ['fire', 'fire-scatter', 'fire-rail', 'hit', 'armor-hit', 'radio'] as GameSfx[]) {
      const context = new OfflineAudioContext(1, 44100, 44100);
      Object.defineProperty(context, 'state', { get: () => 'running' });
      window.AudioContext = function () { return context; } as unknown as typeof AudioContext;
      const sound = new SoundEngine();
      await sound.unlock();
      sound.play(name);
      const rendered = await context.startRendering();
      const data = rendered.getChannelData(0);
      const peak = data.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
      const rms = Math.sqrt(data.reduce((sum, sample) => sum + sample * sample, 0) / data.length);
      results.push({ name, peak: +peak.toFixed(4), rms: +rms.toFixed(4), pass: peak > 0.01 && peak < 1 && rms > 0.001 });
    }
    output.textContent = JSON.stringify(results, null, 2);
  } catch (error) { output.textContent = String(error); }
  finally { window.AudioContext = NativeContext; }
});
