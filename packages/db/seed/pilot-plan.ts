// Pilot test data (prompt 4.4): one SMA with 36 rombel x 25 students, teachers, a full timetable and
// mapel pilihan groups for XI and XII. Pure and deterministic (fixed seed) so e2e and k6 stay stable.
// Every name, NISN and phone number is invented. Phone numbers are synthetic but may exist in real
// life: the seeder refuses to run unless WhatsApp sending is faked.
import type { ClassStream, Gender, GuardianRelation, Role } from '@absah/contracts';

export const PILOT_SEED = 20_270_111;
export const PILOT_NPSN = '99999911';
export const PILOT_EMAIL_DOMAIN = 'pilot.absah.test';
/** Most hours one teacher gets per week. */
const MAX_TEACHER_HOURS = 24;

export interface PilotStaff {
  key: string;
  name: string;
  email: string;
  roles: Role[];
  subject: string | null;
}
export interface PilotStudent {
  nisn: string;
  localId: string;
  name: string;
  gender: Gender;
  birthDate: string;
  className: string;
  guardian: { name: string; relation: GuardianRelation; phone: string };
}
export type SlotOwner = { type: 'class' | 'group'; name: string };
export interface PilotSlot {
  owner: SlotOwner;
  day: number;
  period: number;
  subject: string;
  teacher: string;
}
export interface PilotPlan {
  school: { name: string; npsn: string; level: 'sma'; timezone: string };
  year: { name: string; startsOn: string; endsOn: string };
  semesters: { number: 1 | 2; startsOn: string; endsOn: string }[];
  periods: { day: number; number: number; startsAt: string; endsAt: string }[];
  subjects: { code: string; name: string }[];
  staff: PilotStaff[];
  classes: { name: string; grade: number; stream: ClassStream | null; homeroom: string }[];
  students: PilotStudent[];
  groups: { name: string; subject: string; teacher: string; members: string[] }[];
  slots: PilotSlot[];
}

/** mulberry32: tiny seeded PRNG, enough for synthetic names. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const MALE = ['Adi', 'Bayu', 'Dimas', 'Fajar', 'Galih', 'Hendra', 'Irfan', 'Joko', 'Kevin', 'Lutfi', 'Rizky', 'Naufal', 'Oki', 'Putra', 'Raka', 'Satria', 'Teguh', 'Wahyu', 'Yoga', 'Zaki'];
const FEMALE = ['Ayu', 'Bunga', 'Citra', 'Dewi', 'Eka', 'Fitri', 'Gita', 'Hana', 'Indah', 'Laras', 'Maya', 'Nadia', 'Putri', 'Rani', 'Salsa', 'Tika', 'Wulan', 'Yuni', 'Zahra', 'Intan'];
const FAMILY = ['Pratama', 'Saputra', 'Lestari', 'Wijaya', 'Kusuma', 'Hidayat', 'Nugroho', 'Permata', 'Santoso', 'Rahayu', 'Gunawan', 'Siregar', 'Nasution', 'Purnama', 'Setiawan', 'Maharani', 'Utami', 'Firmansyah'];

/** Mon-Thu jam 1-9, Fri jam 1-6 (Jumatan): 42 lessons a week. */
const TIMES: [string, string][] = [
  ['07:00', '07:45'],
  ['07:45', '08:30'],
  ['08:30', '09:15'],
  ['09:30', '10:15'],
  ['10:15', '11:00'],
  ['11:00', '11:45'],
  ['12:30', '13:15'],
  ['13:15', '14:00'],
  ['14:00', '14:45'],
];
const periodsOn = (day: number) => (day === 5 ? 6 : 9);

const SUBJECTS: Record<string, string> = {
  PAI: 'Pendidikan Agama Islam',
  PPKN: 'Pendidikan Pancasila',
  BIND: 'Bahasa Indonesia',
  MTK: 'Matematika',
  BING: 'Bahasa Inggris',
  SEJ: 'Sejarah',
  PJOK: 'PJOK',
  SENI: 'Seni Budaya',
  BSUN: 'Bahasa Sunda',
  INF: 'Informatika',
  FIS: 'Fisika',
  KIM: 'Kimia',
  BIO: 'Biologi',
  EKO: 'Ekonomi',
  GEO: 'Geografi',
  SOS: 'Sosiologi',
  MTL: 'Matematika Tingkat Lanjut',
  BIL: 'Bahasa Inggris Tingkat Lanjut',
  PKWU: 'Prakarya dan Kewirausahaan',
  ANT: 'Antropologi',
  BJP: 'Bahasa Jepang',
  SAS: 'Sastra Indonesia',
};

const COMMON: [string, number][] = [
  ['PAI', 3],
  ['PPKN', 2],
  ['BIND', 4],
  ['MTK', 4],
  ['BING', 3],
  ['SEJ', 2],
  ['PJOK', 3],
  ['SENI', 2],
  ['BSUN', 1],
];
/** Hours per week per rombel; each list sums to the lessons the rombel has in its own name. */
const CURRICULUM: Record<'x' | 'ipa' | 'ips', [string, number][]> = {
  x: [...COMMON, ['INF', 3], ['FIS', 3], ['KIM', 3], ['BIO', 3], ['EKO', 2], ['GEO', 2], ['SOS', 2]],
  ipa: [...COMMON, ['INF', 1], ['FIS', 3], ['KIM', 3], ['BIO', 3]],
  ips: [...COMMON, ['INF', 1], ['EKO', 3], ['GEO', 3], ['SOS', 3]],
};
/**
 * Mapel pilihan (XI, XII): two blocks of four lessons each; at a block's time every student of the
 * grade is in exactly one of its 8 groups (4 subjects x 2), across rombel.
 */
const BLOCKS: { grade: number; label: string; day: number; subjects: string[] }[] = [
  { grade: 11, label: 'A', day: 2, subjects: ['MTL', 'BIL', 'PKWU', 'INF'] },
  { grade: 11, label: 'B', day: 4, subjects: ['ANT', 'BJP', 'SAS', 'BIO'] },
  { grade: 12, label: 'A', day: 3, subjects: ['MTL', 'BIL', 'PKWU', 'INF'] },
  { grade: 12, label: 'B', day: 1, subjects: ['ANT', 'BJP', 'SAS', 'EKO'] },
];
const BLOCK_PERIODS = [6, 7, 8, 9];
const GROUPS_PER_SUBJECT = 2;
const ROMAN: Record<number, string> = { 10: 'X', 11: 'XI', 12: 'XII' };
const BIRTH_YEAR: Record<number, number> = { 10: 2010, 11: 2009, 12: 2008 };

const pad = (n: number, width: number) => String(n).padStart(width, '0');
const timeKey = (day: number, period: number) => `${day}-${period}`;

/** Spreads a rombel's hours: chunks of at most 2 lessons, one chunk per subject per round. */
function lessonOrder(curriculum: [string, number][]): string[] {
  const chunks = curriculum.map(([code, hours]) => {
    const out: string[][] = [];
    for (let left = hours; left > 0; left -= 2) out.push(Array<string>(Math.min(2, left)).fill(code));
    return out;
  });
  const order: string[] = [];
  for (let round = 0; chunks.some((c) => c.length > round); round += 1) for (const c of chunks) order.push(...(c[round] ?? []));
  return order;
}

export function pilotPlan(seed = PILOT_SEED): PilotPlan {
  const rand = prng(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)] as T;

  const periods = [1, 2, 3, 4, 5].flatMap((day) =>
    TIMES.slice(0, periodsOn(day)).map(([startsAt, endsAt], i) => ({ day, number: i + 1, startsAt, endsAt })),
  );

  // Teachers are created on demand: the first one of the subject that is free at all the times
  // and still under MAX_TEACHER_HOURS takes the lessons.
  const teachers: { key: string; subject: string; busy: Set<string> }[] = [];
  function teacherFor(subject: string, times: string[]): string {
    let t = teachers.find((x) => x.subject === subject && x.busy.size + times.length <= MAX_TEACHER_HOURS && times.every((k) => !x.busy.has(k)));
    if (!t) {
      t = { key: `guru${pad(teachers.length + 1, 3)}`, subject, busy: new Set() };
      teachers.push(t);
    }
    for (const k of times) t.busy.add(k);
    return t.key;
  }

  const classes: PilotPlan['classes'] = [];
  const students: PilotStudent[] = [];
  const slots: PilotSlot[] = [];
  const groups: PilotPlan['groups'] = [];
  const homerooms = new Set<string>();
  let studentNo = 0;

  for (const grade of [10, 11, 12]) {
    const blocks = BLOCKS.filter((b) => b.grade === grade);
    const blocked = new Set(blocks.flatMap((b) => BLOCK_PERIODS.map((p) => timeKey(b.day, p))));
    const free = periods.filter((p) => !blocked.has(timeKey(p.day, p.number)));
    const gradeStudents: string[] = [];

    for (let r = 1; r <= 12; r += 1) {
      const name = `${ROMAN[grade]}-${r}`;
      const stream: ClassStream | null = grade === 10 ? null : r <= 6 ? 'ipa' : 'ips';
      const order = lessonOrder(CURRICULUM[stream ?? 'x']);
      if (order.length !== free.length) throw new Error(`curriculum of ${name} has ${order.length} lessons for ${free.length} times`);
      // Rotate per rombel so parallel rombel have different subjects at the same time.
      const shift = (r * 2) % free.length;
      const lessons = free.map((p, i) => ({ ...p, subject: order[(i + shift) % order.length] ?? '' }));
      const teacherOf = new Map<string, string>();
      for (const code of new Set(order)) {
        const times = lessons.filter((l) => l.subject === code).map((l) => timeKey(l.day, l.number));
        teacherOf.set(code, teacherFor(code, times));
      }
      for (const l of lessons) slots.push({ owner: { type: 'class', name }, day: l.day, period: l.number, subject: l.subject, teacher: teacherOf.get(l.subject) ?? '' });
      const homeroom = [...teacherOf.values()].find((k) => !homerooms.has(k)) ?? '';
      homerooms.add(homeroom);
      classes.push({ name, grade, stream, homeroom });

      for (let s = 0; s < 25; s += 1) {
        studentNo += 1;
        const gender: Gender = rand() < 0.5 ? 'L' : 'P';
        const family = pick(FAMILY);
        const relation: GuardianRelation = rand() < 0.7 ? 'ibu' : 'ayah';
        const month = 1 + Math.floor(rand() * 12);
        const day = 1 + Math.floor(rand() * 28);
        const nisn = `99${pad(grade, 2)}${pad(studentNo, 6)}`;
        students.push({
          nisn,
          localId: `26${pad(studentNo, 4)}`,
          name: `${pick(gender === 'L' ? MALE : FEMALE)} ${family}`.toUpperCase(),
          gender,
          birthDate: `${BIRTH_YEAR[grade]}-${pad(month, 2)}-${pad(day, 2)}`,
          className: name,
          guardian: { name: `${pick(relation === 'ibu' ? FEMALE : MALE)} ${family}`, relation, phone: `+628119${pad(studentNo, 7)}` },
        });
        gradeStudents.push(nisn);
      }
    }

    for (const [b, block] of blocks.entries()) {
      const times = BLOCK_PERIODS.map((p) => timeKey(block.day, p));
      const names = block.subjects.flatMap((code) => Array.from({ length: GROUPS_PER_SUBJECT }, (_, i) => ({ code, name: `${ROMAN[grade]} ${SUBJECTS[code]} ${block.label}${i + 1}` })));
      for (const [g, group] of names.entries()) {
        const teacher = teacherFor(group.code, times);
        // A different spread per block mixes rombel: student i joins group (i * (2b + 1) + b) mod 8.
        const members = gradeStudents.filter((_, i) => (i * (2 * b + 1) + b) % names.length === g);
        groups.push({ name: group.name, subject: group.code, teacher, members });
        for (const p of BLOCK_PERIODS) slots.push({ owner: { type: 'group', name: group.name }, day: block.day, period: p, subject: group.code, teacher });
      }
    }
  }

  const person = (i: number) => {
    const female = i % 2 === 0;
    return `${pick(female ? FEMALE : MALE)} ${pick(FAMILY)}`;
  };
  const staff: PilotStaff[] = [
    { key: 'admin', name: `${person(0)}`, email: `admin@${PILOT_EMAIL_DOMAIN}`, roles: ['admin'], subject: null },
    { key: 'kepsek', name: `${person(1)}, M.Pd.`, email: `kepsek@${PILOT_EMAIL_DOMAIN}`, roles: ['kepsek'], subject: null },
    { key: 'wakasek', name: `${person(2)}, S.Pd.`, email: `wakasek@${PILOT_EMAIL_DOMAIN}`, roles: ['wakasek'], subject: null },
    { key: 'operator', name: person(3), email: `operator@${PILOT_EMAIL_DOMAIN}`, roles: ['operator'], subject: null },
    ...teachers.map((t, i): PilotStaff => ({
      key: t.key,
      name: `${person(i)}, S.Pd.`,
      email: `${t.key}@${PILOT_EMAIL_DOMAIN}`,
      roles: ['guru', ...(homerooms.has(t.key) ? (['wali_kelas'] as const) : []), ...(i < 2 ? (['piket'] as const) : [])],
      subject: t.subject,
    })),
  ];

  return {
    school: { name: 'SMA Absah Uji 1', npsn: PILOT_NPSN, level: 'sma', timezone: 'Asia/Jakarta' },
    year: { name: '2026/2027', startsOn: '2026-07-13', endsOn: '2027-06-25' },
    semesters: [
      { number: 1, startsOn: '2026-07-13', endsOn: '2026-12-18' },
      { number: 2, startsOn: '2027-01-11', endsOn: '2027-06-25' },
    ],
    periods,
    subjects: Object.entries(SUBJECTS).map(([code, name]) => ({ code, name })),
    staff,
    classes,
    students,
    groups,
    slots,
  };
}
