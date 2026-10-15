import { describe, expect, it } from 'vitest';
import { bandEdges, bandsFromSpectrum, OnsetDetector, rangeLevel, smooth } from '../src/webview/audio/levels';
import { eqColumns, segmentTone } from '../src/webview/ui/eqLights';

const SAMPLE_RATE = 48_000;
const FFT = 2048;
const BIN_HZ = SAMPLE_RATE / FFT;

/** A fake analyser spectrum (0..255 per bin) loud between two frequencies. */
function spectrum(lo: number, hi: number, value = 230): Uint8Array {
  const s = new Uint8Array(FFT / 2);
  for (let k = 0; k < s.length; k++) if (k * BIN_HZ >= lo && k * BIN_HZ <= hi) s[k] = value;
  return s;
}

describe('equalizer levels', () => {
  it('spaces twelve bands from 40 Hz to 16 kHz', () => {
    const edges = bandEdges();
    expect(edges).toHaveLength(13);
    expect(edges[0]).toBeCloseTo(40);
    expect(edges[12]).toBeCloseTo(16_000);
    expect(edges[6]).toBeCloseTo(800, 0);
  });

  it('lights the bass for a low-only spectrum, the treble for a high one', () => {
    const low = bandsFromSpectrum(spectrum(30, 200), BIN_HZ);
    expect(low).toHaveLength(12);
    expect(low[0]).toBeGreaterThan(0.8);
    expect(low[11]).toBe(0);
    expect(low[0]).toBeGreaterThan(low[11]);
    const high = bandsFromSpectrum(spectrum(4000, 16_000), BIN_HZ);
    expect(high[11]).toBeGreaterThan(0.5);
    expect(high[0]).toBe(0);
    expect(rangeLevel(spectrum(30, 200), BIN_HZ, 40, 160)).toBeGreaterThan(rangeLevel(spectrum(30, 200), BIN_HZ, 2000, 12_000));
  });

  it('keeps silence dark', () => {
    expect(bandsFromSpectrum(new Uint8Array(FFT / 2), BIN_HZ).every((v) => v === 0)).toBe(true);
    expect(bandsFromSpectrum(spectrum(0, 24_000, 20), BIN_HZ).every((v) => v === 0)).toBe(true);
  });

  it('fires once per kick, never inside the 300 ms refractory', () => {
    const onset = new OnsetDetector();
    const hits: number[] = [];
    // 120 BPM: a kick every 500 ms lasting 50 ms over quieter music, at 60 fps.
    for (let t = 0; t < 4000; t += 16) {
      const energy = t % 500 >= 450 ? 0.8 : 0.2;
      if (onset.push(energy, t, 16)) hits.push(t);
    }
    expect(hits).toHaveLength(8);
    for (let i = 1; i < hits.length; i++) expect(hits[i] - hits[i - 1]).toBeGreaterThanOrEqual(300);
    // A steady loud signal is not a beat after the first moment.
    const steady = new OnsetDetector();
    let count = 0;
    for (let t = 0; t < 3000; t += 16) if (steady.push(0.8, t, 16)) count++;
    expect(count).toBe(0);
  });

  it('rises fast and falls slowly', () => {
    expect(smooth(0, 1, 16)).toBeGreaterThan(0.5);
    expect(smooth(1, 0, 16)).toBeGreaterThan(0.85);
  });
});

describe('equalizer lights', () => {
  it('lights the right number of segments, scaled by the volume', () => {
    const f = eqColumns([0, 0.5, 1, 0.24], undefined, 0.016);
    expect(f.lit).toEqual([0, 5, 10, 2]);
    expect(eqColumns([1], undefined, 0.016, 10, 0.5).lit).toEqual([5]);
    expect(eqColumns([2], undefined, 0.016, 10, 1).lit).toEqual([10]);
  });

  it('marks the top two segments red', () => {
    const tones = Array.from({ length: 10 }, (_, s) => segmentTone(s, 10));
    expect(tones.filter((t) => t === 'red')).toHaveLength(2);
    expect(tones.slice(8)).toEqual(['red', 'red']);
    expect(tones.slice(0, 8).every((t) => t === 'amber')).toBe(true);
  });

  it('falls at a steady rate, and holds the peak dot before it drops', () => {
    let f = eqColumns([1], undefined, 0.016);
    f = eqColumns([0], f, 0.1);
    expect(f.heights[0]).toBeCloseTo(10 - 1.6);
    expect(f.peaks[0]).toBe(10);
    f = eqColumns([0], f, 0.4);
    expect(f.lit[0]).toBe(2);
    expect(f.peaks[0]).toBe(10);
    f = eqColumns([0], f, 0.5);
    expect(f.lit[0]).toBe(0);
    expect(f.peaks[0]).toBeCloseTo(7.5);
  });
});
