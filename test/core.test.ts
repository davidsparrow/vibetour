import { describe, expect, it } from 'vitest';
import { ActivityEngine } from '../src/core/activity';
import { fileRef } from '../src/core/events';
import { APPROACH_CAP, JourneyEngine } from '../src/core/journey';
import { MotionController } from '../src/core/motion';
import { KEYS } from '../src/core/session';
import { WorkspaceTracker } from '../src/core/workspace';
import { BUILTIN_PACKS } from '../src/packs';
import { makeSession } from './helpers';

const MIN = 60_000;
const coast = BUILTIN_PACKS.find((p) => p.id === 'california-coast')!;

describe('ActivityEngine', () => {
  const setup = () => {
    const ws = new WorkspaceTracker();
    const engine = new ActivityEngine(ws, 0);
    const feed = (e: Parameters<WorkspaceTracker['ingest']>[0]) => {
      ws.ingest(e);
      engine.ingest(e);
    };
    return { ws, engine, feed };
  };

  it('treats recent typing as ACTIVE and a quiet pause as THINKING, not idle', () => {
    const { engine, feed } = setup();
    feed({ type: 'editor.edit', file: fileRef('a.ts'), origin: 'user', magnitude: 5, at: 1_000 });
    expect(engine.evaluate(5_000).state).toBe('ACTIVE');
    // A few seconds without keystrokes must not stop anything (PRD §10).
    expect(engine.evaluate(15_000).state).toBe('ACTIVE');
    expect(engine.evaluate(60_000).state).toBe('THINKING');
    expect(engine.evaluate(4 * MIN).state).toBe('THINKING');
    expect(engine.evaluate(6 * MIN).state).toBe('IDLE');
  });

  it('prioritises verification and agents over plain editing', () => {
    const { engine, feed } = setup();
    feed({ type: 'editor.edit', file: fileRef('a.ts'), origin: 'user', magnitude: 5, at: 1_000 });
    feed({ type: 'fs.external', file: fileRef('b.ts'), at: 2_000 });
    expect(engine.evaluate(3_000).state).toBe('AGENT_ACTIVE');
    feed({ type: 'process.start', id: 't', kind: 'test', label: 'npm test', at: 4_000 });
    expect(engine.evaluate(5_000).state).toBe('VERIFYING');
    feed({ type: 'process.end', id: 't', kind: 'test', label: 'npm test', exitCode: 1, at: 9_000 });
    const r = engine.evaluate(10_000);
    expect(r.checkEngine).toEqual({ on: true, reason: 'Tests failing' });
  });

  it('shows WARNING over thinking when there are errors', () => {
    const { engine, feed } = setup();
    feed({ type: 'editor.edit', file: fileRef('a.ts'), origin: 'user', magnitude: 5, at: 1_000 });
    feed({ type: 'diagnostics', errors: 3, warnings: 1, at: 1_500 });
    const r = engine.evaluate(60_000);
    expect(r.state).toBe('WARNING');
    expect(r.basis).toBe('THINKING');
    expect(r.errorIntensity).toBeGreaterThan(0.4);
  });

  it('waits for the user when an agent asks, unless the user is busy editing', () => {
    const { engine, feed } = setup();
    feed({ type: 'agent', agentId: 'c', name: 'Claude', status: 'waiting', at: 1_000 });
    expect(engine.evaluate(2_000).state).toBe('WAITING_FOR_USER');
    expect(engine.evaluate(2_000).waitingAgent).toBe('Claude');
    feed({ type: 'editor.edit', file: fileRef('a.ts'), origin: 'user', magnitude: 5, at: 3_000 });
    expect(engine.evaluate(4_000).state).toBe('ACTIVE');
  });

  it('stops counting a test/build process as verification once it has run for ages (a watcher)', () => {
    const { engine, feed } = setup();
    feed({ type: 'editor.edit', file: fileRef('a.ts'), origin: 'user', magnitude: 5, at: 0 });
    feed({ type: 'process.start', id: 'w', kind: 'test', label: 'npm test', at: 1_000 });
    expect(engine.evaluate(5 * MIN).state).toBe('VERIFYING');
    expect(engine.evaluate(11 * MIN).state).toBe('IDLE');
  });

  it('becomes BLOCKED when a build failure is left alone', () => {
    const { engine, feed } = setup();
    feed({ type: 'editor.save', file: fileRef('a.ts'), at: 0 });
    feed({ type: 'process.start', id: 'b', kind: 'build', label: 'npm run build', at: 1_000 });
    feed({ type: 'process.end', id: 'b', kind: 'build', label: 'npm run build', exitCode: 2, at: 2_000 });
    expect(engine.evaluate(10_000).state).not.toBe('BLOCKED');
    const r = engine.evaluate(45_000);
    expect(r.state).toBe('BLOCKED');
    expect(r.blockedReason).toBe('Build is failing');
  });
});

describe('MotionController', () => {
  it('debounces checkpoints but resumes from stops immediately', () => {
    const m = new MotionController(0);
    m.force('cruise', 0);
    const verifying = { basis: 'VERIFYING' as const, reviewing: false, since: 0 } as never;
    expect(m.update(verifying, 'cruising', 1_000).behavior).toBe('cruise');
    expect(m.update(verifying, 'cruising', 4_500).behavior).toBe('cruise');
    expect(m.update(verifying, 'cruising', 5_100).behavior).toBe('checkpoint');

    const waiting = { basis: 'WAITING_FOR_USER' as const, reviewing: false, since: 6_000 } as never;
    m.update(waiting, 'cruising', 6_000);
    const stopped = m.update(waiting, 'cruising', 8_100);
    expect(stopped.behavior).toBe('scenic-stop');
    expect(stopped.stopReason).toBe('waiting');

    const active = { basis: 'ACTIVE' as const, reviewing: false, since: 9_000 } as never;
    expect(m.update(active, 'cruising', 9_000).behavior).toBe('cruise');
  });

  it('slows during medium inactivity and pulls into a scenic stop after long inactivity', () => {
    const m = new MotionController(0);
    m.force('cruise', 0);
    const idle = (since: number) => ({ basis: 'IDLE' as const, reviewing: false, since }) as never;
    m.update(idle(0), 'cruising', 0);
    expect(m.update(idle(0), 'cruising', 2_000).behavior).toBe('slow');
    m.update(idle(0), 'cruising', 3 * MIN);
    expect(m.update(idle(0), 'cruising', 3 * MIN + 2_100).behavior).toBe('scenic-stop');
  });

  it('keeps driving the final approach through idle, waiting and blocked states', () => {
    for (const basis of ['IDLE', 'WAITING_FOR_USER', 'BLOCKED'] as const) {
      const m = new MotionController(0);
      m.force('scenic-stop', 0, 'idle');
      const reading = { basis, reviewing: false, since: -10 * MIN } as never;
      expect(m.update(reading, 'final-approach', 1_000).behavior).toBe('approach');
      expect(m.update(reading, 'final-approach', 10_000).behavior).toBe('approach');
    }
  });
});

describe('JourneyEngine', () => {
  it('holds at the final approach until the objective is complete, then arrives', () => {
    const j = JourneyEngine.create(coast, { id: 'j', scope: 'coffee-run', now: 0, seed: 7 });
    let t = 0;
    const step = (ms: number, basis: 'ACTIVE' | 'IDLE' = 'ACTIVE') => {
      for (let i = 0; i < ms; i += 1_000) {
        t += 1_000;
        j.tick(1_000, basis, true, t);
      }
    };
    step(10 * MIN);
    expect(j.record.progress).toBeGreaterThan(0.3);
    expect(j.record.progress).toBeLessThan(APPROACH_CAP);
    step(30 * MIN);
    expect(j.record.progress).toBeCloseTo(APPROACH_CAP, 5);
    expect(j.phase).toBe('extended');
    step(10 * MIN);
    expect(j.phase).toBe('extended');

    expect(j.completeObjective(t)).toBe(true);
    expect(j.scene().kind).toBe('arrival');
    step(2 * MIN);
    expect(j.phase).toBe('arrived');
    expect(j.record.progress).toBe(1);
  });

  it('does not progress while idle (no productivity theatre, no punishment for thinking)', () => {
    const j = JourneyEngine.create(coast, { id: 'j', scope: 'day-trip', now: 0, seed: 1 });
    j.tick(60_000, 'IDLE', false, 60_000);
    expect(j.record.progress).toBe(0);
    j.tick(60_000, 'THINKING', true, 120_000);
    expect(j.record.progress).toBeGreaterThan(0);
  });

  it('walks the scene graph in order from departure', () => {
    const j = JourneyEngine.create(coast, { id: 'j', scope: 'day-trip', now: 0, seed: 3 });
    expect(j.scene().kind).toBe('departure');
    expect(j.record.path[0]).toBe('departure');
    expect(coast.sceneGraph.nodes[j.record.path.at(-1)!].kind).toBe('arrival');
  });

  it('free drive never arrives on its own and keeps varying the scenery', () => {
    const j = JourneyEngine.create(coast, { id: 'j', scope: 'free-drive', now: 0, seed: 3 });
    const seen = new Set<string>();
    for (let t = 0; t < 120 * MIN; t += 30_000) {
      j.tick(30_000, 'ACTIVE', true, t);
      seen.add(j.scene().id);
    }
    expect(j.phase).not.toBe('arrived');
    expect(seen.size).toBeGreaterThan(3);
  });
});

describe('VibeTourSession', () => {
  it('runs the PRD core story: depart, verify, wait at a scenic stop, resume, arrive, stamp', () => {
    const { session, clock, emit, type, globalStore } = makeSession();
    expect(session.startJourney('california-coast', 'coffee-run', undefined, 'Build onboarding flow')).toBe(true);
    type();
    clock.advance(5_000);
    let s = session.latestSnapshot!;
    expect(s.journey?.phase).toBe('departing');
    expect(s.motion.stopped).toBe(false);
    expect(s.activity.gear).toBe('D');

    emit({ type: 'process.start', id: 'p1', kind: 'test', label: 'npm test' });
    clock.advance(6_000);
    s = session.latestSnapshot!;
    expect(s.activity.state).toBe('VERIFYING');
    expect(s.motion.behavior).toBe('checkpoint');

    emit({ type: 'process.end', id: 'p1', kind: 'test', label: 'npm test', exitCode: 0 });
    clock.advance(20_000);
    emit({ type: 'agent', agentId: 'claude:1', name: 'Claude', status: 'waiting', detail: 'Needs your approval' });
    clock.advance(4_000);
    s = session.latestSnapshot!;
    expect(s.motion.behavior).toBe('scenic-stop');
    expect(s.motion.caption).toMatch(/Claude is waiting for you/);
    expect(s.motion.stopName).toBeTruthy();
    expect(s.activity.gear).toBe('P');

    emit({ type: 'agent', agentId: 'claude:1', name: 'Claude', status: 'working' });
    clock.advance(1_000);
    expect(session.latestSnapshot!.motion.stopped).toBe(false);

    session.completeObjective();
    clock.advance(3 * MIN);
    s = session.latestSnapshot!;
    expect(s.journey?.phase).toBe('arrived');
    expect(s.motion.behavior).toBe('arrived');
    expect(s.activity.state).toBe('COMPLETE');

    const catalog = session.catalog();
    expect(catalog.stamps).toHaveLength(1);
    expect(catalog.stamps[0].objective).toBe('Build onboarding flow');
    expect(catalog.lastStampId).toBe(catalog.stamps[0].id);
    expect(catalog.library.find((e) => e.packId === 'california-coast')?.trips).toBe(1);
    expect(globalStore.get(KEYS.memories)).toBeTruthy();
    expect(session.catalog().memory?.title).toBe('Big Sur');
  });

  it('persists the journey across restarts and auto-resumes a journey parked by closing', () => {
    const first = makeSession();
    first.session.startJourney('california-coast', 'road-trip');
    first.type();
    first.clock.advance(MIN);
    first.session.shutdown();
    const saved = first.projectStore.get<{ phase: string; parkedBy: string }>(KEYS.journey)!;
    expect(saved.phase).toBe('parked');
    expect(saved.parkedBy).toBe('close');

    const second = makeSession({ projectStore: first.projectStore, globalStore: first.globalStore });
    expect(second.session.catalog().activeJourney?.phase).toBe('parked');
    second.type();
    second.clock.advance(1_000);
    expect(second.session.latestSnapshot!.journey?.phase).not.toBe('parked');
    expect(second.session.latestSnapshot!.journey?.sessions).toBe(2);
  });

  it('a journey parked by the user stays parked while they keep coding', () => {
    const { session, clock, type } = makeSession();
    session.startJourney('california-coast', 'day-trip');
    session.park();
    type();
    clock.advance(2_000);
    expect(session.latestSnapshot!.journey?.phase).toBe('parked');
    session.resume();
    expect(session.latestSnapshot!.journey?.phase).not.toBe('parked');
  });

  it('streaming mode sanitises private details from snapshots', () => {
    const { session, clock, emit } = makeSession({ streaming: true });
    session.startJourney('california-coast', 'day-trip', undefined, 'Secret project');
    emit({ type: 'editor.focus', file: fileRef('src/secret/payroll.ts', 'TypeScript') });
    emit({ type: 'editor.save', file: fileRef('src/secret/payroll.ts', 'TypeScript') });
    emit({ type: 'git', branch: 'feature/acquisition', repo: 'acme/secret', changes: 3, staged: 1, ahead: 0, behind: 0 });
    emit({ type: 'process.start', id: 'x', kind: 'test', label: 'pytest tests/payroll' });
    clock.advance(1_000);
    const json = JSON.stringify(session.latestSnapshot);
    for (const secret of ['payroll', 'acquisition', 'acme', 'Secret project', 'atlas']) expect(json).not.toContain(secret);
    expect(session.latestSnapshot!.ide.activeFile?.name).toBe('TypeScript file');
    expect(session.latestSnapshot!.ide.processes[0].label).toBe('Tests');
  });

  it('counts files and test passes into the journey stats', () => {
    const { session, clock, emit, type } = makeSession();
    session.startJourney('california-coast', 'day-trip');
    type('a.ts');
    type('b.ts');
    type('a.ts');
    emit({ type: 'process.start', id: 't', kind: 'test', label: 'vitest' });
    emit({ type: 'process.end', id: 't', kind: 'test', label: 'vitest', exitCode: 0 });
    emit({ type: 'git.commit', message: 'Add onboarding' });
    clock.advance(1_000);
    const stats = session.latestSnapshot!.journey!.stats;
    expect(stats.filesChanged).toBe(2);
    expect(stats.testPasses).toBe(1);
    expect(stats.commits).toBe(1);
  });

  it('counts files the session already touched into a new journey', () => {
    const { session, clock, type } = makeSession();
    type('early.ts');
    session.startJourney('california-coast', 'coffee-run');
    type('auth.ts');
    session.completeObjective();
    clock.advance(3 * MIN);
    expect(session.latestSnapshot!.journey!.phase).toBe('arrived');

    session.startJourney('california-coast', 'coffee-run');
    type('auth.ts');
    type('early.ts');
    clock.advance(1_000);
    expect(session.latestSnapshot!.journey!.stats.filesChanged).toBe(2);
  });

  it('arrives after "objective complete" even when the user has been idle for a while', () => {
    const { session, clock, type } = makeSession();
    session.startJourney('california-coast', 'coffee-run');
    type();
    clock.advance(10 * MIN, 1_000);
    expect(session.latestSnapshot!.motion.behavior).toBe('scenic-stop');
    session.completeObjective();
    clock.advance(3 * MIN, 1_000);
    expect(session.latestSnapshot!.journey?.phase).toBe('arrived');
  });

  it('replans a restored journey whose path no longer fits its pack, arrival included', () => {
    const first = makeSession();
    first.session.startJourney('california-coast', 'day-trip');
    first.session.shutdown();
    const saved = first.projectStore.get<{ path: string[] }>(KEYS.journey)!;
    first.projectStore.set(KEYS.journey, { ...saved, path: ['departure', 'a-node-that-was-renamed'] });

    const second = makeSession({ projectStore: first.projectStore, globalStore: first.globalStore });
    const path = second.session.activeJourney!.path;
    expect(path.every((id) => coast.sceneGraph.nodes[id])).toBe(true);
    expect(coast.sceneGraph.nodes[path.at(-1)!].kind).toBe('arrival');
    second.session.completeObjective();
    second.clock.advance(1_000);
    expect(second.session.latestSnapshot!.journey!.scene.kind).toBe('arrival');
  });
});
