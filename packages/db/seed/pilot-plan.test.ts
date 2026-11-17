import { describe, expect, it } from 'vitest';
import { pilotPlan } from './pilot-plan';

const plan = pilotPlan();
const key = (s: { day: number; period: number }) => `${s.day}-${s.period}`;
function groupBy<T>(items: T[], by: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) out.set(by(item), [...(out.get(by(item)) ?? []), item]);
  return out;
}

describe('pilotPlan', () => {
  it('is deterministic', () => {
    expect(pilotPlan()).toEqual(plan);
    expect(pilotPlan(1).students[0]?.name).not.toBe(plan.students[0]?.name);
  });

  it('has 36 rombel of 25 synthetic students with a guardian test number', () => {
    expect(plan.classes.map((c) => c.name)).toEqual(['X', 'XI', 'XII'].flatMap((g) => Array.from({ length: 12 }, (_, i) => `${g}-${i + 1}`)));
    expect(plan.students).toHaveLength(900);
    expect(new Set(plan.students.map((s) => s.nisn)).size).toBe(900);
    expect(new Set(plan.students.map((s) => s.guardian.phone)).size).toBe(900);
    for (const s of plan.students) {
      expect(s.nisn).toMatch(/^99\d{8}$/);
      expect(s.guardian.phone).toMatch(/^\+628119\d{7}$/);
    }
  });

  it('gives every rombel its own wali kelas', () => {
    const homerooms = plan.classes.map((c) => c.homeroom);
    expect(new Set(homerooms).size).toBe(36);
    for (const h of homerooms) expect(plan.staff.find((s) => s.key === h)?.roles).toContain('wali_kelas');
  });

  it('books a teacher once per time and at most 24 lessons a week', () => {
    const byTeacher = groupBy(plan.slots, (s) => s.teacher);
    for (const [teacher, slots] of byTeacher) {
      expect(teacher).not.toBe('');
      expect(new Set(slots.map(key)).size).toBe(slots.length);
      expect(slots.length).toBeLessThanOrEqual(24);
    }
  });

  it('gives every student 42 lessons a week, never two at once', () => {
    const classSlots = groupBy(
      plan.slots.filter((s) => s.owner.type === 'class'),
      (s) => s.owner.name,
    );
    const groupSlots = groupBy(
      plan.slots.filter((s) => s.owner.type === 'group'),
      (s) => s.owner.name,
    );
    const groupsOf = new Map<string, string[]>();
    for (const g of plan.groups) for (const m of g.members) groupsOf.set(m, [...(groupsOf.get(m) ?? []), g.name]);
    for (const s of plan.students) {
      const grade = s.className.split('-')[0];
      expect(groupsOf.get(s.nisn) ?? []).toHaveLength(grade === 'X' ? 0 : 2);
      const times = [...(classSlots.get(s.className) ?? []), ...(groupsOf.get(s.nisn) ?? []).flatMap((g) => groupSlots.get(g) ?? [])].map(key);
      expect(times).toHaveLength(42);
      expect(new Set(times).size).toBe(42);
    }
  });

  it('keeps mapel pilihan groups at a class size', () => {
    expect(plan.groups).toHaveLength(32);
    for (const g of plan.groups) expect(g.members.length).toBeGreaterThanOrEqual(37);
  });
});
