import { z } from 'zod';

/** Academic data enums shared by the DB schema, the API and the web (AKD-01 to AKD-04). */

export const GENDERS = ['L', 'P'] as const;
export const Gender = z.enum(GENDERS).meta({ id: 'Gender' });
export type Gender = z.infer<typeof Gender>;

/** Peminatan for SMA/MA classes; null for other levels. */
export const CLASS_STREAMS = ['ipa', 'ips', 'bahasa', 'keagamaan'] as const;
export const ClassStream = z.enum(CLASS_STREAMS).meta({ id: 'ClassStream' });
export type ClassStream = z.infer<typeof ClassStream>;

/**
 * active = in the class now; moved = transferred to another school; left = graduated or dropped
 * out; class_changed = moved to another rombel of the same school (a new active enrollment exists).
 */
export const ENROLLMENT_STATUSES = ['active', 'moved', 'left', 'class_changed'] as const;
export const EnrollmentStatus = z.enum(ENROLLMENT_STATUSES).meta({ id: 'EnrollmentStatus' });
export type EnrollmentStatus = z.infer<typeof EnrollmentStatus>;

export const GUARDIAN_RELATIONS = ['ayah', 'ibu', 'wali'] as const;
export const GuardianRelation = z.enum(GUARDIAN_RELATIONS).meta({ id: 'GuardianRelation' });
export type GuardianRelation = z.infer<typeof GuardianRelation>;

/**
 * Calendar exceptions. Monday to Friday (or Saturday, per school) are school days by default;
 * a row marks a holiday or an extra school day.
 */
export const CALENDAR_DAY_KINDS = ['holiday', 'school_day'] as const;
export const CalendarDayKind = z.enum(CALENDAR_DAY_KINDS).meta({ id: 'CalendarDayKind' });
export type CalendarDayKind = z.infer<typeof CalendarDayKind>;

/** Processing purposes a guardian consents to (UU 27/2022). */
export const CONSENT_PURPOSES = ['data_processing', 'whatsapp_notifications', 'photo'] as const;
export const ConsentPurpose = z.enum(CONSENT_PURPOSES).meta({ id: 'ConsentPurpose' });
export type ConsentPurpose = z.infer<typeof ConsentPurpose>;

export const CONSENT_METHODS = ['paper', 'digital'] as const;
export const ConsentMethod = z.enum(CONSENT_METHODS).meta({ id: 'ConsentMethod' });
export type ConsentMethod = z.infer<typeof ConsentMethod>;

/** ISO weekday: 1 = Senin ... 6 = Sabtu, 7 = Minggu. */
export const SCHOOL_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export const SchoolDay = z.int().min(1).max(7).meta({ id: 'SchoolDay' });
export type SchoolDay = z.infer<typeof SchoolDay>;
export const DAY_NAMES: Record<number, string> = { 1: 'Senin', 2: 'Selasa', 3: 'Rabu', 4: 'Kamis', 5: 'Jumat', 6: 'Sabtu', 7: 'Minggu' };

/** A schedule slot belongs to a rombel or to a learning group (mapel pilihan, moving class). */
export const SLOT_OWNER_TYPES = ['class', 'group'] as const;
export const SlotOwnerType = z.enum(SLOT_OWNER_TYPES).meta({ id: 'SlotOwnerType' });
export type SlotOwnerType = z.infer<typeof SlotOwnerType>;
