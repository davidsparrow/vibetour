import { fileRef, type DevEventBody } from '../src/core/events';
import { MemoryStore, VibeTourSession, type SessionOptions } from '../src/core/session';
import { BUILTIN_PACKS } from '../src/packs';

/** A session driven by a fake clock. */
export function makeSession(over: Partial<SessionOptions> = {}) {
  let now = 1_700_000_000_000;
  let id = 0;
  const globalStore = over.globalStore ?? new MemoryStore();
  const projectStore = over.projectStore ?? new MemoryStore();
  const session = new VibeTourSession({
    packs: BUILTIN_PACKS,
    globalStore,
    projectStore,
    project: 'atlas',
    now: () => now,
    newId: () => `id-${++id}`,
    ...over,
  });
  const clock = {
    get now() {
      return now;
    },
    advance(ms: number, stepMs = 250) {
      const end = now + ms;
      while (now < end) {
        now = Math.min(end, now + stepMs);
        session.tick();
      }
    },
  };
  const emit = (body: DevEventBody) => session.ingest({ ...body, at: now } as never);
  const type = (path = 'src/app.ts') => emit({ type: 'editor.edit', file: fileRef(path, 'TypeScript'), origin: 'user', magnitude: 12 });
  return { session, clock, emit, type, globalStore, projectStore };
}
