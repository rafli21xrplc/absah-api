import { z } from 'zod';
import { LEAVE_STATUSES } from '../leave/leave-requests';
import { TEACHER_LEAVE_KINDS } from './constants';

export const TeacherLeaveKind = z.enum(TEACHER_LEAVE_KINDS).meta({ id: 'TeacherLeaveKind' });
export type TeacherLeaveKind = z.infer<typeof TeacherLeaveKind>;
const Status = z.enum(LEAVE_STATUSES);

/** Roles that decide a teacher's izin (GRU-02): the wakasek, and above them the kepsek and admin (a wakasek's own izin needs someone else). */
export const TEACHER_LEAVE_DECIDERS = ['wakasek', 'kepsek', 'admin'] as const;

export const CreateTeacherLeaveRequest = z
  .object({
    kind: TeacherLeaveKind,
    startsOn: z.iso.date(),
    endsOn: z.iso.date(),
    reason: z.string().trim().min(1, 'Tulis alasannya.').max(500),
  })
  .strict()
  .meta({ id: 'CreateTeacherLeaveRequest' });
export type CreateTeacherLeaveRequest = z.infer<typeof CreateTeacherLeaveRequest>;

export const DecideTeacherLeaveRequest = z
  .object({ approve: z.boolean(), note: z.string().trim().max(300).optional() })
  .strict()
  .meta({ id: 'DecideTeacherLeaveRequest' });
export type DecideTeacherLeaveRequest = z.infer<typeof DecideTeacherLeaveRequest>;

export const TeacherLeave = z
  .object({
    id: z.uuid(),
    teacher: z.object({ id: z.uuid(), name: z.string() }),
    kind: TeacherLeaveKind,
    startsOn: z.iso.date(),
    endsOn: z.iso.date(),
    reason: z.string(),
    status: Status,
    decidedBy: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    decidedAt: z.iso.datetime().nullable(),
    decisionNote: z.string().nullable(),
    cancelledAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'TeacherLeave' });
export type TeacherLeave = z.infer<typeof TeacherLeave>;

/** GET /api/v1/teacher-leaves?status=&mine=: the deciders see every teacher's, others only their own. */
export const TeacherLeavesQuery = z
  .object({
    status: z.enum([...LEAVE_STATUSES, 'all']).default('pending'),
    mine: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  })
  .meta({ id: 'TeacherLeavesQuery' });
export type TeacherLeavesQuery = z.infer<typeof TeacherLeavesQuery>;

export const TeacherLeaveList = z.object({ items: z.array(TeacherLeave) }).meta({ id: 'TeacherLeaveList' });
export type TeacherLeaveList = z.infer<typeof TeacherLeaveList>;

export const TeacherLeaveIdParam = z.object({ leaveId: z.uuid() }).meta({ id: 'TeacherLeaveIdParam' });
