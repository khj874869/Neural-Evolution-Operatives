import { CampaignStory, type StoryBeat, type StoryLine } from './CampaignStory';
import type { OperationId, OperationStage } from '../../../packages/shared/src/operations';

const STORAGE_KEY = 'neo-campaign-journal-v1';

export class StoryRadio {
  readonly story: CampaignStory;
  private root = document.createElement('aside');
  private queue: Array<{ beat: StoryBeat; line: StoryLine }> = [];
  private current?: { beat: StoryBeat; line: StoryLine };
  private remaining = 0;
  private paused = true;
  private clock = 0;
  private timer: number;

  constructor(private onSignal: () => void, onJournal: () => void) {
    let saved: unknown = [];
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); } catch { /* Storage is optional. */ }
    this.story = new CampaignStory(saved);
    this.root.className = 'story-radio';
    this.root.setAttribute('aria-label', '분대 무전');
    this.root.innerHTML = `<div class="radio-heading"><span>◉ LIVE COMMS</span><button type="button" class="radio-journal">작전 기록</button></div>
      <div class="radio-message" role="status" aria-live="polite" aria-atomic="true"><strong></strong><p></p></div>
      <button type="button" class="radio-next" aria-label="다음 무전">다음 ›</button><i class="radio-progress"></i>`;
    document.querySelector('#game-shell')?.append(this.root);
    this.root.querySelector('.radio-journal')!.addEventListener('click', onJournal);
    this.root.querySelector('.radio-next')!.addEventListener('click', () => this.advance());
    this.timer = window.setInterval(() => this.tick(), 200);
    window.addEventListener('pagehide', () => window.clearInterval(this.timer));
    window.addEventListener('pageshow', (event) => {
      if (!event.persisted) return;
      this.clock = performance.now();
      this.timer = window.setInterval(() => this.tick(), 200);
    });
  }

  startRun(): void {
    this.queue = [];
    this.current = undefined;
    this.story.startRun();
    this.render();
  }

  enter(operationId: OperationId, stage: OperationStage): void {
    const entry = this.story.enter(operationId, stage);
    if (!entry) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.story.save())); } catch { /* Keep the in-memory journal. */ }
    // Urgent new objectives supersede old dialogue; all discoveries stay in the journal.
    this.queue = entry.lines.map((line) => ({ beat: entry, line }));
    this.advance();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.clock = performance.now();
    this.root.hidden = paused;
    document.body.classList.toggle('radio-active', !paused && Boolean(this.current));
  }

  private advance(): void {
    this.current = this.queue.shift();
    this.remaining = this.current ? Math.max(8_000, this.current.line.text.length * 155) : 0;
    this.clock = performance.now();
    this.render();
    if (this.current && !this.paused) this.onSignal();
  }

  private tick(): void {
    const now = performance.now();
    const delta = Math.min(500, now - this.clock);
    this.clock = now;
    if (this.paused || document.hidden || !this.current) return;
    this.remaining -= delta;
    if (this.remaining <= 0) this.advance();
  }

  private render(): void {
    this.root.classList.toggle('speaking', Boolean(this.current));
    this.root.querySelector('strong')!.textContent = this.current?.line.speaker ?? '';
    this.root.querySelector('p')!.textContent = this.current?.line.text ?? '';
    this.root.querySelector('.radio-next')!.textContent = this.queue.length ? '다음 ›' : '수신 완료 ✓';
    this.root.setAttribute('data-story', this.current?.beat.id ?? '');
    this.setPaused(this.paused);
  }
}
