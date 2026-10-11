import { describe, expect, it } from 'vitest';
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
