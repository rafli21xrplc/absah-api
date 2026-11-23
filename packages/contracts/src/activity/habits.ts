import { z } from 'zod';

/**
 * Jurnal 7 Kebiasaan Anak Indonesia Hebat (KEG-02, habits.kaih != 'off'): one tick per habit per
 * day, by the parent (mode parent, SD) or the student (mode student, SMP and up).
 */
export const KAIH_HABITS = ['bangun_pagi', 'beribadah', 'berolahraga', 'makan_sehat', 'gemar_belajar', 'bermasyarakat', 'tidur_cepat'] as const;
export const HabitCode = z.enum(KAIH_HABITS).meta({ id: 'HabitCode' });
export type HabitCode = z.infer<typeof HabitCode>;

/** Entries can be filled today and this many days back; older ones are locked (job keg.lock-habits). */
export const HABIT_EDIT_DAYS = 2;
/** Longest range GET /habits/{studentId} returns. */
export const HABIT_RANGE_MAX_DAYS = 31;

const habitShape = <T extends z.ZodType>(value: T) => Object.fromEntries(KAIH_HABITS.map((h) => [h, value])) as Record<HabitCode, T>;

/** PUT /api/v1/habits/{studentId}/{date}: the habits sent are set, the others stay. */
export const PutHabitsRequest = z
  .object({ habits: z.object(habitShape(z.boolean().optional())).strict() })
  .strict()
  .refine((b) => Object.values(b.habits).some((v) => v !== undefined), { message: 'Centang minimal satu kebiasaan.', path: ['habits'] })
  .meta({ id: 'PutHabitsRequest' });
export type PutHabitsRequest = z.infer<typeof PutHabitsRequest>;

export const HabitDay = z
  .object({
    date: z.iso.date(),
    /** null: not filled that day. */
    habits: z.object(habitShape(z.boolean().nullable())),
    filledBy: z.enum(['orang_tua', 'siswa']).nullable(),
    locked: z.boolean(),
  })
  .meta({ id: 'HabitDay' });
export type HabitDay = z.infer<typeof HabitDay>;

export const HabitParams = z.object({ studentId: z.uuid(), date: z.iso.date() });
export const HabitRangeQuery = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() }).meta({ id: 'HabitRangeQuery' });
export type HabitRangeQuery = z.infer<typeof HabitRangeQuery>;

/** GET /api/v1/habits/{studentId}?from&to: one entry per day (default the last 7), newest first. */
export const HabitJournal = z
  .object({
    studentId: z.uuid(),
    name: z.string(),
    mode: z.enum(['parent', 'student']),
    /** The caller may tick (the parent in mode parent, the student in mode student). */
    canEdit: z.boolean(),
    /** Earliest date still open for ticking. */
    editableFrom: z.iso.date(),
    days: z.array(HabitDay),
  })
  .meta({ id: 'HabitJournal' });
export type HabitJournal = z.infer<typeof HabitJournal>;

export const ClassHabitsParams = z.object({ classId: z.uuid() });
/** GET /api/v1/classes/{classId}/habits?weekStart=: weekStart is the Monday (default this week). */
export const ClassHabitsQuery = z.object({ weekStart: z.iso.date().optional() }).meta({ id: 'ClassHabitsQuery' });
export type ClassHabitsQuery = z.infer<typeof ClassHabitsQuery>;

/** Weekly summary for the wali kelas: per student, days with any tick and ticks per habit (of 7 days). */
export const ClassHabitWeek = z
  .object({
    classId: z.uuid(),
    className: z.string(),
    weekStart: z.iso.date(),
    weekEnd: z.iso.date(),
    students: z.array(z.object({ studentId: z.uuid(), name: z.string(), daysFilled: z.int(), counts: z.object(habitShape(z.int())) })),
  })
  .meta({ id: 'ClassHabitWeek' });
export type ClassHabitWeek = z.infer<typeof ClassHabitWeek>;
