import { describe, expect, it } from 'vitest';
import { MOMENTS, type Moment } from '../src/core/moments';
import { CUES, cueTable, litCues } from '../src/webview/ui/cues';
import { formatDuration, formatElapsed } from '../src/webview/ui/dom';

describe('duration labels', () => {
  it('shows seconds for the first minute, then minutes and hours', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(59_900)).toBe('59s');
    expect(formatElapsed(60_000)).toBe('1m');
    expect(formatElapsed(10 * 60_000)).toBe('10m');
    expect(formatElapsed(20 * 60_000 + 5_000)).toBe('20m');
    expect(formatElapsed(70 * 60_000)).toBe('1h 10m');
    expect(formatDuration(70 * 60_000)).toBe('1h 10m');
  });
});

describe('cue table', () => {
  it('lights the warning lights from moments, and the blue light only when this display wants it', () => {
    const moments: Moment[] = ['coding', 'problems', 'checks-failing', 'your-turn'];
    expect([...litCues(cueTable({ yourTurnCue: 'none' }), moments)]).toEqual(['check', 'warn']);
    expect([...litCues(cueTable({ yourTurnCue: 'light' }), moments)]).toEqual(['check', 'warn', 'turn']);
    expect([...litCues(cueTable({ yourTurnCue: 'none' }), ['build-failing', 'agent-waiting'])]).toEqual(['hazard', 'agent']);
  });

  it('only refers to real moments', () => {
    for (const prefs of [{ yourTurnCue: 'none' as const }, { yourTurnCue: 'light' as const }]) {
      const table = cueTable(prefs);
      for (const cue of CUES) for (const m of table[cue]) expect(MOMENTS).toContain(m);
    }
  });
});
