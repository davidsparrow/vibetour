import { describe, expect, it } from 'vitest';
import { DEFAULT_DECK, normalizeDeck } from '../src/core/music';
import { isClientCommand, mergePrefs } from '../src/core/protocol';

describe('radio commands', () => {
  it('accepts each new command', () => {
    expect(isClientCommand({ type: 'radioSearch', requestId: 'presets' })).toBe(true);
    expect(isClientCommand({ type: 'radioSearch', requestId: 's1', query: 'jazz', countryCode: 'US', tag: 'jazz', limit: 30 })).toBe(true);
    expect(isClientCommand({ type: 'radioLocal', packId: 'california-coast' })).toBe(true);
    expect(isClientCommand({ type: 'radioTune', stationId: 'soma:groovesalad' })).toBe(true);
    expect(isClientCommand({ type: 'radioTune', stationId: 'rb:9617a958-0601-11e8-ae97-52543be04c81' })).toBe(true);
    expect(isClientCommand({ type: 'radioTune' })).toBe(true);
    expect(isClientCommand({ type: 'musicWatch', watching: true })).toBe(true);
  });

  it('rejects bad fields', () => {
    expect(isClientCommand({ type: 'radioSearch', requestId: 's', countryCode: 'us' })).toBe(false);
    expect(isClientCommand({ type: 'radioSearch', requestId: 's', countryCode: 'USA' })).toBe(false);
    expect(isClientCommand({ type: 'radioSearch', requestId: 's', limit: 0 })).toBe(false);
    expect(isClientCommand({ type: 'radioSearch', requestId: 's', limit: 51 })).toBe(false);
    expect(isClientCommand({ type: 'radioSearch', requestId: 's', limit: 2.5 })).toBe(false);
    expect(isClientCommand({ type: 'radioSearch', requestId: 's', query: 'x'.repeat(101) })).toBe(false);
    expect(isClientCommand({ type: 'radioSearch', requestId: 'x'.repeat(65) })).toBe(false);
    expect(isClientCommand({ type: 'radioSearch' })).toBe(false);
    // Station ids only: a URL never gets through to the stream proxy.
    expect(isClientCommand({ type: 'radioTune', stationId: 'http://127.0.0.1:22/' })).toBe(false);
    expect(isClientCommand({ type: 'radioTune', stationId: 'rb:../../etc' })).toBe(false);
    expect(isClientCommand({ type: 'radioTune', stationId: 'soma:groove salad' })).toBe(false);
    expect(isClientCommand({ type: 'radioLocal' })).toBe(false);
    expect(isClientCommand({ type: 'musicWatch', watching: 'yes' })).toBe(false);
  });
});

describe('deck prefs', () => {
  it('fills deck defaults', () => {
    expect(mergePrefs(undefined).deck).toEqual(DEFAULT_DECK);
    expect(mergePrefs({ deck: { band: 'cb' } as never }).deck).toMatchObject({ band: 'cb', volume: 0.7, presets: DEFAULT_DECK.presets });
  });

  it('clamps numbers, drops bad station ids and keeps six presets', () => {
    const d = normalizeDeck({ band: 'am', stationId: 'javascript:x', volume: 4, bass: -40, treble: Number.NaN, fader: 2, balance: -2, width: 9, surround: 1, lights: false, presets: ['soma:lush', 'nope', null, 'rb:abc', 'soma:a', 'soma:b', 'soma:c', 'soma:d'] });
    expect(d).toEqual({ band: 'fm', volume: 1, bass: -12, treble: 0, fader: 1, balance: -1, width: 1.5, surround: false, lights: false, presets: ['soma:lush', null, null, 'rb:abc', 'soma:a', 'soma:b'] });
    expect(normalizeDeck({ presets: ['soma:lush'] }).presets).toEqual(['soma:lush', null, null, null, null, null]);
    expect(normalizeDeck({ stationId: 'soma:lush' }).stationId).toBe('soma:lush');
  });
});
