import type { Moment } from '../../core/moments';
import type { ClientPrefs } from '../../core/protocol';

/** Dashboard cues: the warning lights a moment can switch on. */
export const CUES = ['check', 'warn', 'hazard', 'agent', 'turn'] as const;
export type Cue = (typeof CUES)[number];

export type CueTable = Record<Cue, readonly Moment[]>;

/**
 * Which moments switch each cue on: the built-in dashboard, plus this
 * display's own choices. A dashboard designer edits this table, never the
 * cockpit code.
 */
export function cueTable(prefs: Pick<ClientPrefs, 'yourTurnCue'>): CueTable {
  return {
    check: ['checks-failing'],
    warn: ['problems'],
    hazard: ['agent-problem', 'build-failing'],
    agent: ['agent-waiting'],
    turn: prefs.yourTurnCue === 'light' ? ['your-turn'] : [],
  };
}

/** The cues that the current moments switch on. */
export function litCues(table: CueTable, moments: readonly Moment[]): Set<Cue> {
  const now = new Set(moments);
  return new Set(CUES.filter((cue) => table[cue].some((m) => now.has(m))));
}
