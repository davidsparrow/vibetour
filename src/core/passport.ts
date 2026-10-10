import type { JourneyRecord, ScopeId } from './journey';
import type { JourneyPack, Mood, TimeOfDay } from './packs';
import { findVariant } from './packs';

/**
 * VibeTour Passport, Journey Library and Travel Memories (PRD §21, §46, §47,
 * §67, §75). Kept deliberately elegant: stamps and stubs, no points.
 */

export interface Stamp {
  id: string;
  journeyId: string;
  packId: string;
  title: string;
  subtitle: string;
  country: string;
  countryCode: string;
  continent: string;
  variantLabel: string;
  timeOfDay: TimeOfDay;
  scope: ScopeId;
  arrivedAt: number;
  startedAt: number;
  codingMs: number;
  sessions: number;
  objective?: string;
  project?: string;
  note?: string;
  filesChanged: number;
  testPasses: number;
  commits: number;
  moods: Mood[];
}

export interface LibraryEntry {
  packId: string;
  /** Ticket saved for later (PRD §36 "SAVE FOR LATER"). */
  saved: boolean;
  favorite: boolean;
  /** Completed journeys: each becomes a ticket stub (PRD §75). */
  trips: number;
  codingMs: number;
  lastVisitedAt?: number;
}

export interface TravelMemory {
  project: string;
  packId: string;
  title: string;
  at: number;
}

export interface PassportStats {
  countries: number;
  routesCompleted: number;
  codingHours: number;
  favoriteDestination?: string;
  nightJourneys: number;
  mountainJourneys: number;
  longestExpeditionMs: number;
}

export function makeStamp(rec: JourneyRecord, pack: JourneyPack, id: string, now: number): Stamp {
  const variant = findVariant(pack, rec.variantId);
  return {
    id,
    journeyId: rec.id,
    packId: pack.id,
    title: pack.title,
    subtitle: pack.subtitle,
    country: pack.country,
    countryCode: pack.countryCode,
    continent: pack.continent,
    variantLabel: variant.label,
    timeOfDay: variant.arrivalTimeOfDay ?? variant.timeOfDay,
    scope: rec.scope,
    arrivedAt: rec.arrivedAt ?? now,
    startedAt: rec.createdAt,
    codingMs: Math.round(rec.productiveMs),
    sessions: rec.sessions,
    objective: rec.objective,
    project: rec.project,
    filesChanged: rec.stats.files.length,
    testPasses: rec.stats.testPasses,
    commits: rec.stats.commits,
    moods: pack.moods,
  };
}

export function passportStats(stamps: Stamp[]): PassportStats {
  const countries = new Set(stamps.map((s) => s.countryCode));
  const byPack = new Map<string, { title: string; ms: number; n: number }>();
  for (const s of stamps) {
    const e = byPack.get(s.packId) ?? { title: s.title, ms: 0, n: 0 };
    e.ms += s.codingMs;
    e.n += 1;
    byPack.set(s.packId, e);
  }
  let favorite: string | undefined;
  let best = -1;
  for (const e of byPack.values()) {
    const score = e.n * 1e9 + e.ms;
    if (score > best) {
      best = score;
      favorite = e.title;
    }
  }
  return {
    countries: countries.size,
    routesCompleted: stamps.length,
    codingHours: Math.round((stamps.reduce((a, s) => a + s.codingMs, 0) / 3_600_000) * 10) / 10,
    favoriteDestination: favorite,
    nightJourneys: stamps.filter((s) => s.timeOfDay === 'night' || s.timeOfDay === 'dusk').length,
    mountainJourneys: stamps.filter((s) => s.moods.includes('mountains')).length,
    longestExpeditionMs: stamps.reduce((a, s) => Math.max(a, s.arrivedAt - s.startedAt), 0),
  };
}

export function emptyLibraryEntry(packId: string): LibraryEntry {
  return { packId, saved: false, favorite: false, trips: 0, codingMs: 0 };
}

export function updateLibrary(
  library: LibraryEntry[],
  packId: string,
  change: (entry: LibraryEntry) => void,
): LibraryEntry[] {
  const next = library.map((e) => ({ ...e }));
  let entry = next.find((e) => e.packId === packId);
  if (!entry) {
    entry = emptyLibraryEntry(packId);
    next.push(entry);
  }
  change(entry);
  return next;
}

export type DurationChoice = '30m' | '1h' | 'afternoon' | 'workday';

export function scopeForDuration(d: DurationChoice): ScopeId {
  switch (d) {
    case '30m':
      return 'coffee-run';
    case '1h':
      return 'day-trip';
    case 'afternoon':
      return 'scenic-drive';
    case 'workday':
      return 'road-trip';
  }
}

/**
 * "Take me somewhere" (PRD §55): prefers destinations the user has not
 * visited, filtered by mood. Returns undefined when nothing matches.
 */
export function pickSurprise(
  packs: JourneyPack[],
  library: LibraryEntry[],
  mood: Mood | 'anywhere' | 'surprise',
  random: () => number = Math.random,
  excludePackId?: string,
): JourneyPack | undefined {
  const matches = packs.filter(
    (p) => p.id !== excludePackId && (mood === 'anywhere' || mood === 'surprise' || p.moods.includes(mood) || (mood === 'rain' && p.variants.some((v) => v.weather === 'rain'))),
  );
  if (!matches.length) return undefined;
  if (mood === 'surprise') return matches[Math.floor(random() * matches.length)];
  const trips = (id: string) => library.find((e) => e.packId === id)?.trips ?? 0;
  const fewest = Math.min(...matches.map((p) => trips(p.id)));
  const unvisited = matches.filter((p) => trips(p.id) === fewest);
  return unvisited[Math.floor(random() * unvisited.length)];
}
