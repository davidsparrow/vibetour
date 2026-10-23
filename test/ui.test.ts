import { describe, expect, it } from 'vitest';
import type { Attention } from '../src/core/attention';
import { DEFAULT_PREFS, mergePrefs } from '../src/core/protocol';
import { alertClickable, alertLevel, shownAlerts } from '../src/webview/ui/alerts';
import { batteryHiddenReason, batteryStatus } from '../src/webview/ui/battery';
import { batteryLit, cacheDots, changesDial, issuesDial } from '../src/webview/ui/cockpit';
import { formatDuration, formatElapsed } from '../src/webview/ui/dom';
import { zoneSplit } from '../src/webview/ui/gauges';

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

describe('dashboard gauges', () => {
  it('shows the context gauge and the battery lights by default', () => {
    expect(DEFAULT_PREFS).toMatchObject({ contextGauge: true, batteryGauge: true, cacheHitWarn: 50, cacheTimerWarn: 15 });
    // Prefs saved before the lights kept the old dial's default, off: they take the new one.
    expect(mergePrefs({ batteryGauge: false, contextGauge: false })).toMatchObject({ contextGauge: false, batteryGauge: true });
    expect(mergePrefs({ batteryGauge: false, cacheHitWarn: 70 })).toMatchObject({ batteryGauge: false, cacheHitWarn: 70 });
  });

  it('lights one battery light per fifth of a charge', () => {
    expect([0, 0.01, 0.2, 0.21, 0.6, 0.62, 0.99, 1].map(batteryLit)).toEqual([0, 1, 1, 2, 3, 4, 5, 5]);
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

describe('HUD alerts', () => {
  const alert = (id: string, kind: Attention['kind']): Attention => ({
    id,
    kind,
    text: id,
    since: 0,
    target: kind === 'pr' ? { type: 'pr', number: 1 } : { type: 'agent', agentId: id },
  });

  it('lists the kinds this display switched on', () => {
    const list = [alert('q', 'question'), alert('p', 'pr'), alert('t', 'turn'), alert('a', 'approval'), alert('x', 'problem'), alert('y', 'plan')];
    expect(shownAlerts(list, DEFAULT_PREFS)).toHaveLength(6);
    const prefs = mergePrefs({ hudAlerts: { pr: false, turn: false } as never });
    expect(prefs.hudAlerts).toMatchObject({ question: true, pr: false, turn: false, build: true });
    expect(shownAlerts(list, prefs).map((a) => a.id)).toEqual(['q', 'a', 'x', 'y']);
  });

  it('lights the bell red for a stop, orange for something that needs you, blue for changed files', () => {
    const ide = (changes: number) => ({ git: { changes, staged: 0, ahead: 0, behind: 0 } }) as never;
    expect(alertLevel({ attention: [alert('t', 'turn'), alert('q', 'question')], ide: ide(3) }, DEFAULT_PREFS)).toBe('blocking');
    expect(alertLevel({ attention: [alert('p', 'pr')], ide: ide(3) }, DEFAULT_PREFS)).toBe('moderate');
    expect(alertLevel({ attention: [], ide: ide(3) }, DEFAULT_PREFS)).toBe('general');
    expect(alertLevel({ attention: [], ide: ide(3) }, mergePrefs({ alertOnChanges: false }))).toBeUndefined();
    expect(alertLevel({ attention: [alert('q', 'question')], ide: ide(0) }, mergePrefs({ hudAlerts: { question: false } as never }))).toBeUndefined();
  });

  it('makes a chip a button only where the host can act on it', () => {
    const caps = { openFiles: false, openDocs: false, saveFiles: false, focusIde: false, radio: false };
    const host = (more: object) => ({ kind: 'cli' as const, version: '0', capabilities: { ...caps, ...more } });
    expect(alertClickable(alert('q', 'question'), host({ focusAgent: true }))).toBe(true);
    expect(alertClickable(alert('q', 'question'), host({ openLinks: true }))).toBe(false);
    expect(alertClickable(alert('p', 'pr'), host({ openLinks: true }))).toBe(true);
    expect(alertClickable(alert('p', 'pr'), undefined)).toBe(false);
    expect(alertClickable({ ...alert('b', 'build'), target: { type: 'problems' } }, host({ openFiles: true }))).toBe(true);
  });
});

describe('red zones', () => {
  it('splits a high zone: the gauge colour to 75%, red past it', () => {
    expect(zoneSplit(0.5, 'high')).toEqual({ main: 0.5, hot: 0, inZone: false });
    expect(zoneSplit(0.75, 'high')).toEqual({ main: 0.75, hot: 0, inZone: true });
    expect(zoneSplit(0.875, 'high')).toEqual({ main: 0.75, hot: 0.5, inZone: true });
    expect(zoneSplit(1, 'high')).toEqual({ main: 0.75, hot: 1, inZone: true });
  });

  it('turns a low zone red once the gauge runs under a quarter', () => {
    expect(zoneSplit(0.6, 'low')).toEqual({ main: 0.6, hot: 0, inZone: false });
    expect(zoneSplit(0.2, 'low')).toEqual({ main: 0.2, hot: 0, inZone: true });
    expect(zoneSplit(0.9)).toEqual({ main: 0.9, hot: 0, inZone: false });
  });

  it('puts more than twenty changed files in the red', () => {
    expect(changesDial(0)).toBe(0);
    expect(changesDial(20)).toBeCloseTo(0.75, 5);
    expect(zoneSplit(changesDial(20), 'high').hot).toBe(0);
    expect(zoneSplit(changesDial(21), 'high').hot).toBeGreaterThan(0);
    expect(changesDial(40)).toBe(1);
  });

  it('puts more than three issues in the red', () => {
    // The engine's intensity for a score s is 1 − e^(−s/5).
    const intensity = (score: number) => 1 - Math.exp(-score / 5);
    expect(issuesDial(intensity(0))).toBe(0);
    expect(issuesDial(intensity(3))).toBeLessThan(0.75);
    expect(issuesDial(intensity(4))).toBeCloseTo(0.75, 5);
    expect(issuesDial(intensity(10))).toBeGreaterThan(0.9);
  });
});

describe('cache dots', () => {
  const at = 1_000_000;
  const min = 60_000;
  const warn = { hitPct: 50, minutes: 15 };

  it('shows the hit share and counts down to a cold cache, orange under the thresholds and red once cold', () => {
    const hour = { hit: 0.974, at, ttl: 3600 };
    expect(cacheDots(hour, at + 18 * min, warn)).toEqual({
      hit: { text: '97%', level: 'ok', label: "Prompt cache: 97% of this session's input read from the cache" },
      timer: { text: '42m', level: 'ok', label: 'Prompt cache goes cold in 42 minutes (1-hour cache)' },
    });
    expect(cacheDots(hour, at + 45 * min, warn).timer).toMatchObject({ text: '15m', level: 'warn' });
    expect(cacheDots(hour, at + 59 * min + 15_000, warn).timer).toMatchObject({ text: '45s', level: 'warn' });
    expect(cacheDots(hour, at + 60 * min, warn).timer).toMatchObject({ text: '0', level: 'cold' });
    expect(cacheDots({ ...hour, hit: 0.42 }, at, warn).hit).toMatchObject({ text: '42%', level: 'warn', label: expect.stringContaining('under your 50%') });
    // The driver's own thresholds.
    expect(cacheDots({ ...hour, hit: 0.6 }, at + 45 * min, { hitPct: 70, minutes: 10 })).toMatchObject({ hit: { level: 'warn' }, timer: { level: 'ok' } });
  });

  it('warns in the last fifth of a cache shorter than the threshold', () => {
    const five = { hit: 0.5, at, ttl: 300 };
    expect(cacheDots(five, at + 3 * min, warn).timer).toMatchObject({ text: '2m', level: 'ok', label: expect.stringContaining('(5-minute cache)') });
    expect(cacheDots(five, at + 4 * min, warn).timer).toMatchObject({ text: '1m', level: 'warn' });
  });

  it('shows what it knows, and nothing without a reading', () => {
    expect(cacheDots(null, at, warn)).toEqual({});
    expect(cacheDots({ hit: null, at }, at, warn)).toEqual({});
    expect(cacheDots({ hit: 0.9, at }, at, warn)).toEqual({ hit: expect.objectContaining({ text: '90%' }) });
    expect(cacheDots({ hit: null, at, ttl: 3600 }, at, warn)).toEqual({ timer: expect.objectContaining({ text: '60m' }) });
  });
});
