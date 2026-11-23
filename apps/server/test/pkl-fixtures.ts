import { schema } from '@absah/db';
import { withTenant } from '../src/shared/db';
import { signIn, type Agent, type TestApp } from './harness';

/** An SMK with staff, three students of XI TKJ 1 and two DUDI (Mon-Fri 08.00-16.00) for PKL tests. */
export interface PklWorld {
  school: string;
  agents: Record<'humas' | 'pembimbing' | 'kepsek' | 'guru', Agent>;
  users: Record<'humas' | 'pembimbing' | 'kepsek' | 'guru', string>;
  /** enrollment ids by first name: rizky, sinta, bayu. */
  enrollments: Record<'rizky' | 'sinta' | 'bayu', string>;
  students: Record<'rizky' | 'sinta' | 'bayu', string>;
  partners: Record<'maju' | 'sentosa', string>;
}

export const DUDI_POINT = { latitude: -6.2383, longitude: 106.9756 };

export async function pklWorld(t: TestApp, name = 'SMK Absah PKL'): Promise<PklWorld> {
  const school = await t.school('smk', name);
  const agents = {} as PklWorld['agents'];
  const users = {} as PklWorld['users'];
  for (const [label, role] of [
    ['humas', 'humas_pkl'],
    ['pembimbing', 'guru'],
    ['kepsek', 'kepsek'],
    ['guru', 'guru'],
  ] as const) {
    const u = await t.staff(`Pak ${label}`);
    users[label] = u.id;
    await t.member(school, u.id, role);
    agents[label] = t.agent();
    await signIn(agents[label], u.email).expect(200);
  }
  return withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: year?.id ?? '', name: 'XI TKJ 1', grade: 11 }).returning();
    const rows = await tx
      .insert(schema.students)
      .values([
        { schoolId: school, name: 'RIZKY PRATAMA' },
        { schoolId: school, name: 'SINTA DEWI' },
        { schoolId: school, name: 'BAYU SAPUTRA' },
      ])
      .returning();
    const enr = await tx
      .insert(schema.enrollments)
      .values(rows.map((s) => ({ schoolId: school, studentId: s.id, classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' })))
      .returning();
    const [maju, sentosa] = await tx
      .insert(schema.dudiPartners)
      .values([
        { schoolId: school, name: 'PT Maju Jaya', address: 'Jl. Industri 1, Bekasi', ...DUDI_POINT },
        { schoolId: school, name: 'CV Sentosa', address: 'Jl. Raya 2, Bekasi', latitude: -6.25, longitude: 107.0 },
      ])
      .returning();
    for (const p of [maju, sentosa]) {
      await tx.insert(schema.dudiWorkHours).values([1, 2, 3, 4, 5].map((day) => ({ schoolId: school, partnerId: p?.id ?? '', day, startsAt: '08:00', endsAt: '16:00' })));
    }
    const at = (i: number) => enr[i]?.id ?? '';
    const st = (i: number) => rows[i]?.id ?? '';
    return {
      school,
      agents,
      users,
      enrollments: { rizky: at(0), sinta: at(1), bayu: at(2) },
      students: { rizky: st(0), sinta: st(1), bayu: st(2) },
      partners: { maju: maju?.id ?? '', sentosa: sentosa?.id ?? '' },
    };
  });
}
