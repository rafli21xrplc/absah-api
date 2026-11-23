import { describe, expect, it } from 'vitest';
import { planAspects, type ExistingAspect } from './assessment-aspects';

const existing: ExistingAspect[] = [
  { id: 'a', name: 'Disiplin', description: null, weight: 2, position: 0 },
  { id: 'b', name: 'Kerja sama', description: 'Dalam tim', weight: 1, position: 1 },
  { id: 'c', name: 'Keterampilan teknis', description: null, weight: 3, position: 2 },
];

describe('planAspects (PKL-04)', () => {
  it('edits and reorders by id, adds new ones and retires the ones left out', () => {
    const { plan } = planAspects(existing, [
      { id: 'c', name: 'Keterampilan teknis', weight: 5 },
      { name: ' Inisiatif ', description: ' Mengambil tugas ', weight: 1 },
      { id: 'a', name: 'Disiplin dan kehadiran', weight: 2 },
    ]);
    expect(plan?.update).toEqual([
      { id: 'c', name: 'Keterampilan teknis', description: null, weight: 5, position: 0 },
      { id: 'a', name: 'Disiplin dan kehadiran', description: null, weight: 2, position: 2 },
    ]);
    expect(plan?.insert).toEqual([{ name: 'Inisiatif', description: 'Mengambil tugas', weight: 1, position: 1 }]);
    expect(plan?.retire).toEqual(['b']);
  });

  it('refuses unknown or repeated ids and names that differ only by case', () => {
    expect(planAspects(existing, [{ id: 'zzz', name: 'X1', weight: 1 }]).problems).toEqual([{ kind: 'unknown_id', id: 'zzz' }]);
    expect(planAspects(existing, [{ id: 'a', name: 'Satu', weight: 1 }, { id: 'a', name: 'Dua', weight: 1 }]).problems).toEqual([{ kind: 'duplicate_id', id: 'a' }]);
    expect(planAspects(existing, [{ name: 'Disiplin', weight: 1 }, { name: 'disiplin ', weight: 1 }]).problems).toEqual([{ kind: 'duplicate_name', name: 'disiplin' }]);
  });

  it('may reuse the name of an aspect that is being retired', () => {
    const { plan } = planAspects(existing, [{ id: 'b', name: 'Disiplin', weight: 1 }]);
    expect(plan?.retire).toEqual(['a', 'c']);
  });
});
