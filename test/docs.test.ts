import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ACTIVITY_CONFIG } from '../src/core/activity';
import { MOMENTS } from '../src/core/moments';
import { DEFAULT_MOTION_CONFIG } from '../src/core/motion';

const signalMap = readFileSync(new URL('../docs/signal-map.md', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

/** How the signal map writes a duration: seconds up to a minute, whole minutes after that. */
function label(ms: number): string {
  return ms > 60_000 && ms % 60_000 === 0 ? `${ms / 60_000} min` : `${ms / 1000} s`;
}

/** The table row that names a setting, e.g. `activeWindowMs`. */
function rowFor(key: string): string {
  const row = signalMap.split('\n').find((line) => line.startsWith('|') && line.includes(`\`${key}\``));
  expect(row, `docs/signal-map.md has no row for ${key}`).toBeDefined();
  return row!;
}

describe('docs/signal-map.md', () => {
  it('lists every moment', () => {
    for (const m of MOMENTS) expect(signalMap, `missing moment ${m}`).toContain(`\`${m}\``);
  });

  it('gives the activity timings the engine uses', () => {
    for (const [key, ms] of Object.entries(DEFAULT_ACTIVITY_CONFIG)) expect(rowFor(key)).toContain(`| ${label(ms)} |`);
  });

  it('gives the motion timings the engine uses', () => {
    const { scenicStopAfterMs, holdMs, defaultHoldMs, refuelMs } = DEFAULT_MOTION_CONFIG;
    expect(rowFor('scenicStopAfterMs')).toContain(`| ${label(scenicStopAfterMs)} |`);
    expect(rowFor('refuelMs')).toContain(`| ${label(refuelMs)} |`);
    const holds = [holdMs.checkpoint!, holdMs['scenic-stop']!, defaultHoldMs].map((ms) => ms / 1000).join(' · ');
    expect(rowFor('holdMs')).toContain(`| ${holds} s |`);
  });
});

describe('the radio in the docs', () => {
  it('gives the Radio tab both bands', () => {
    const row = signalMap.split('\n').find((line) => line.startsWith('| Radio tab |'));
    expect(row).toBeDefined();
    expect(row).toContain('**CB**');
    expect(row).toContain('**FM**');
  });

  it("qualifies README's privacy promise with the radio, and says how to turn it off", () => {
    expect(readme).not.toMatch(/Nothing leaves your machine\. /);
    expect(readme).toContain('Nothing leaves your machine, except the internet radio you choose to play');
    expect(readme).toContain('`vibetour.radio.enabled`');
    expect(readme).toContain('`--no-radio`');
  });
});
