import { describe, expect, it } from 'vitest';
import { MOMENTS, type Moment } from '../src/core/moments';
import { DEFAULT_PREFS, mergePrefs } from '../src/core/protocol';
import { batteryHiddenReason, batteryStatus } from '../src/webview/ui/battery';
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

describe('dashboard gauges', () => {
  it('shows the context gauge and hides the battery gauge by default', () => {
    expect(DEFAULT_PREFS.contextGauge).toBe(true);
    expect(DEFAULT_PREFS.batteryGauge).toBe(false);
    expect(mergePrefs({ batteryGauge: true })).toMatchObject({ contextGauge: true, batteryGauge: true });
  });

  it('treats a full battery on mains power as no battery until one shows up', () => {
    const mains = { level: 1, charging: true, dischargingTime: Infinity };
    expect(batteryStatus(mains, false)).toEqual({ kind: 'none' });
    expect(batteryStatus({ level: 0.42, charging: false, dischargingTime: 5400 }, false)).toEqual({ kind: 'battery', level: 0.42, charging: false });
    expect(batteryStatus({ level: 0.9, charging: true, dischargingTime: Infinity }, false)).toEqual({ kind: 'battery', level: 0.9, charging: true });
    // Once a laptop has shown its battery, plugging back in at 100% keeps the gauge.
    expect(batteryStatus(mains, true)).toEqual({ kind: 'battery', level: 1, charging: true });
  });

  it('says why the battery gauge is hidden', () => {
    expect(batteryHiddenReason({ kind: 'unsupported' })).toBe("this browser doesn't report battery");
    expect(batteryHiddenReason({ kind: 'none' })).toBe('no battery found yet');
    expect(batteryHiddenReason({ kind: 'battery', level: 0.5, charging: false })).toBeNull();
  });
});
