# Campaign presentation pass — 2026-09-05

## Implemented

- Operation Zero: flooded market, abandoned rail corridor, fractured evacuation crossing, Cerberus plaza and shelter lift.
- Operation Ashfall: ash basins, harvesting trench, three relay pads and Hecaton's arena.
- Scenery dresses shared collision footprints; decorations do not introduce client-only collision walls. Static geometry is constructed once. Weather uses a fixed 28-particle pool, reduced to 10 on low quality and disabled with reduced motion.
- Eleven objective-triggered story beats across both operations, with timed squad radio captions, manual advance, persistent discovered-only journal and debrief epilogues. A new run replays transmissions without erasing the journal. Dialogue pauses with menus and when the page is hidden.
- Separate layered carbine, scatter and rail shots; metallic armor impacts, ordinary impacts, debris and radio cues; filtered procedural environmental audio. The master bus controls mute/background behavior, recovers audio after a rejected unlock, and starts ambience from silence.
- First-run consent/tutorial gates hold the simulation before play. Settings expose sound preview and the journal.

## Verification

- `npm run check`: 35 client tests and 56 server tests passed, plus client/server TypeScript checks.
- `npm run release:check`: 50 release consistency checks passed.
- Real browser Web Audio offline rendering: carbine, scatter, rail, hit, armor-hit and radio produced nonzero output without clipping in the isolated test.
- First-run consent → tutorial → deployment inspected; health remained at 100% at deployment. First transmission and the discovered-only journal were inspected.
- Browser layouts inspected at 820×390 and 568×320, plus the default embedded browser. Radio did not cover movement/fire buttons at those landscape sizes.
- Development-only `/tests/presentation.html` provides sector previews and an actual Web Audio PCM check; it is not a production build entry.

## Still requires playtest

- This pass adds authored captions and synthesized effects/ambience, not recorded character voice acting or composed music.
- Real Samsung hardware audio balance, thermal behavior and touch feel still need a device session. Browser viewport checks are not device certification.
- Full campaign completion pacing and sustained polyphonic combat loudness need human playtesting. Unit tests do not replace an end-to-end two-operation playthrough.
- The existing maps' navigation topology remains shared with the server; this pass primarily changes environmental identity and narrative presentation.
