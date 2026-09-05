import { describe, expect, it } from 'vitest';
import { CampaignStory, CAMPAIGN_STORY } from '../src/game/systems/CampaignStory';
import { OPERATIONS, OPERATION_IDS, evaluateOperation } from '../packages/shared/src/operations';

describe('campaign narrative progression', () => {
  it('has authored dialogue and a discovery for every playable stage of both operations', () => {
    for (const id of OPERATION_IDS) for (const { stage } of OPERATIONS[id].stages) {
      const story = new CampaignStory();
      const entry = story.enter(id, stage);
      expect(entry?.lines.length).toBeGreaterThan(0);
      expect(entry?.discovery.length).toBeGreaterThan(20);
    }
    expect(new Set(CAMPAIGN_STORY.map((entry) => entry.id)).size).toBe(CAMPAIGN_STORY.length);
  });

  it('follows earned objectives without exposing the ending in the journal', () => {
    const story = new CampaignStory();
    const progress = { collected: 0, dataCollected: 0, kills: 0, relaysDestroyed: 0, bossDefeated: false, extracted: false };
    const advance = () => story.enter('operation-zero', evaluateOperation('operation-zero', progress).stage);
    expect(advance()?.stage).toBe('SCAVENGE');
    expect(advance()).toBeUndefined();
    progress.collected = 8;
    expect(advance()?.stage).toBe('ELIMINATE');
    expect(story.journal().map((entry) => entry.stage)).toEqual(['SCAVENGE', 'ELIMINATE']);
    progress.kills = 10;
    expect(advance()?.stage).toBe('WARDEN');
    progress.bossDefeated = true;
    expect(advance()?.stage).toBe('EXTRACT');
    progress.extracted = true;
    expect(advance()?.stage).toBe('COMPLETE');
  });

  it('restores valid discoveries, deduplicates reconnects and replays dialogue after a retry', () => {
    const story = new CampaignStory(['operation-zero:SCAVENGE', 'unknown', null, 'operation-zero:SCAVENGE']);
    expect(story.journal()).toHaveLength(1);
    expect(story.enter('operation-zero', 'SCAVENGE')).toBeDefined();
    expect(story.enter('operation-zero', 'SCAVENGE')).toBeUndefined();
    story.startRun();
    expect(story.enter('operation-zero', 'SCAVENGE')).toBeDefined();
    expect(new CampaignStory(story.save()).journal()).toHaveLength(1);
    expect(new CampaignStory({ bad: true }).journal()).toEqual([]);
  });
});
