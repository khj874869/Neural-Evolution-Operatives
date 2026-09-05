import { afterEach, describe, expect, it, vi } from 'vitest';
import { SoundEngine } from '../src/game/systems/SoundEngine';

function audioFixture() {
  const parameter = () => ({ value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), setTargetAtTime: vi.fn() });
  const nodes: any[] = [];
  const node = () => {
    const result: any = { gain: parameter(), frequency: parameter(), threshold: parameter(), knee: parameter(), ratio: parameter(),
      connect: vi.fn((next) => next), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null };
    nodes.push(result);
    return result;
  };
  const context = { state: 'suspended', currentTime: 1, sampleRate: 8000, destination: {},
    resume: vi.fn(async () => { context.state = 'running'; }), createGain: node, createDynamicsCompressor: node,
    createBiquadFilter: node, createBufferSource: node, createOscillator: node,
    createBuffer: vi.fn((_channels, length) => ({ getChannelData: () => new Float32Array(length) })),
  };
  const factory = vi.fn(function () { return context; });
  vi.stubGlobal('AudioContext', factory);
  return { context, nodes, factory };
}

afterEach(() => vi.unstubAllGlobals());

describe('sound playback lifecycle', () => {
  it('waits for a user gesture, recovers after a rejected resume and uses one context', async () => {
    const { context, factory } = audioFixture();
    const sound = new SoundEngine();
    sound.play('hit');
    expect(factory).not.toHaveBeenCalled();
    context.resume.mockRejectedValueOnce(new Error('autoplay blocked'));
    await expect(sound.unlock()).resolves.toBeUndefined();
    await sound.unlock();
    expect(context.state).toBe('running');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('mutes the master bus and prevents new shot nodes while muted or backgrounded', async () => {
    const { nodes } = audioFixture();
    const sound = new SoundEngine();
    await sound.unlock();
    const master = nodes[0];
    expect(master.gain.value).toBe(0);
    // Ambience must fade in from silence, not Web Audio's default unity gain.
    expect(nodes[nodes.length - 1].gain.value).toBe(0);
    sound.setEnabled(false);
    const mutedCount = nodes.length;
    sound.play('fire-scatter');
    expect(nodes.length).toBe(mutedCount);
    expect(master.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 1, 0.04);
    sound.setEnabled(true);
    sound.setActive(false);
    sound.play('fire-rail');
    expect(nodes.length).toBe(mutedCount);
    sound.setActive(true);
    expect(master.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.72, 1, 0.04);
  });

  it('builds layered weapon sounds and disconnects temporary nodes on completion', async () => {
    const { nodes } = audioFixture();
    const sound = new SoundEngine();
    await sound.unlock();
    const before = nodes.length;
    sound.play('fire-scatter');
    const shot = nodes.slice(before);
    const sources = shot.filter((n) => n.start.mock.calls.length);
    expect(sources.length).toBeGreaterThanOrEqual(3);
    for (const source of sources) {
      expect(source.stop).toHaveBeenCalled();
      source.onended();
    }
    expect(shot.every((n) => n.disconnect.mock.calls.length)).toBe(true);
  });
});
