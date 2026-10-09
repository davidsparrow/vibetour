import { describe, expect, it } from 'vitest';
import { LANDMARK_KINDS, planPath, validatePack, variantForHour } from '../src/core/packs';
import { pickSurprise } from '../src/core/passport';
import { BUILTIN_PACKS } from '../src/packs';

describe('built-in Journey Packs', () => {
  it('ships 5–8 tours (PRD §19)', () => {
    expect(BUILTIN_PACKS.length).toBeGreaterThanOrEqual(5);
    expect(BUILTIN_PACKS.length).toBeLessThanOrEqual(8);
    expect(new Set(BUILTIN_PACKS.map((p) => p.id)).size).toBe(BUILTIN_PACKS.length);
  });

  for (const pack of BUILTIN_PACKS) {
    describe(pack.id, () => {
      it('has a valid manifest', () => {
        const result = validatePack(pack);
        expect(result.errors).toEqual([]);
      });

      it('plans paths from departure to arrival for many seeds', () => {
        for (let seed = 0; seed < 40; seed++) {
          const path = planPath(pack, seed);
          expect(pack.sceneGraph.nodes[path[0]].kind).toBe('departure');
          expect(pack.sceneGraph.nodes[path.at(-1)!].kind).toBe('arrival');
        }
      });

      it('declares provenance and an honest authenticity label (PRD §53, §79)', () => {
        expect(pack.provenance.creator).toBeTruthy();
        expect(pack.provenance.sources.length).toBeGreaterThan(0);
        if (pack.type === 'fantasy') expect(pack.ticket.badges).toContain('Fantasy Journey');
      });
    });
  }

  it('uses every landmark the renderer can draw at least once', () => {
    const used = new Set(
      BUILTIN_PACKS.flatMap((p) => Object.values(p.sceneGraph.nodes).map((n) => n.env?.landmark).filter(Boolean)),
    );
    const unused = LANDMARK_KINDS.filter((k) => !used.has(k) && k !== 'pagoda');
    expect(unused).toEqual([]);
  });

  it('rejects broken manifests', () => {
    const broken = structuredClone(BUILTIN_PACKS[0]) as unknown as Record<string, unknown>;
    (broken.sceneGraph as { nodes: Record<string, { next?: string[] }> }).nodes.departure.next = ['nowhere'];
    broken.cruiseSpeed = 500;
    const r = validatePack(broken);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/nowhere/);
    expect(r.errors.join('\n')).toMatch(/cruiseSpeed/);
  });

  it('matches the local clock to the closest variant', () => {
    const tokyo = BUILTIN_PACKS.find((p) => p.id === 'tokyo-night')!;
    expect(variantForHour(tokyo, 23).timeOfDay).toBe('night');
    expect(variantForHour(tokyo, 13).timeOfDay).toBe('day');
  });

  it('"Take me somewhere" prefers unvisited destinations that match the mood', () => {
    const library = BUILTIN_PACKS.map((p) => ({ packId: p.id, saved: false, favorite: false, trips: p.id === 'swiss-alps' ? 3 : 0, codingMs: 0 }));
    for (let i = 0; i < 20; i++) {
      const pick = pickSurprise(BUILTIN_PACKS, library, 'mountains', Math.random);
      expect(pick?.moods).toContain('mountains');
      expect(pick?.id).not.toBe('swiss-alps');
    }
    expect(pickSurprise(BUILTIN_PACKS, library, 'city-night')?.id).toBe('tokyo-night');
  });
});
