import { z } from 'zod';
import { SessionMode, SessionOwnerType } from '../attendance/enums';
import { TeacherLeaveKind } from './leave';

/** Roles that can stand in for an absent teacher (GRU-03). */
export const SUBSTITUTE_ROLES = ['guru', 'wali_kelas', 'piket', 'wakasek'] as const;
/** Who sees the sessions that need a substitute, and who assigns one (wakasek or the piket of the day). */
export const SUBSTITUTION_VIEWERS = ['wakasek', 'piket', 'kepsek', 'admin'] as const;
export const SUBSTITUTION_ASSIGNERS = ['wakasek', 'piket', 'admin'] as const;

const Ref = z.object({ id: z.uuid(), name: z.string() });

export const SubstitutionItem = z
  .object({
    session: z.object({
      id: z.uuid(),
      schoolDate: z.iso.date(),
      mode: SessionMode,
      owner: z.object({ type: SessionOwnerType, id: z.uuid(), name: z.string() }),
      period: z.object({ number: z.int(), startsAt: z.string(), endsAt: z.string() }).nullable(),
      subject: Ref.nullable(),
    }),
    /** The teacher the session belongs to, whose approved izin leaves it without one. */
    absentTeacher: Ref,
    leaveKind: TeacherLeaveKind.nullable(),
    /** The current substitute; null while the session still needs one. */
    substitute: Ref.extend({ assignedAt: z.iso.datetime() }).nullable(),
    status: z.enum(['needed', 'assigned']),
  })
  .meta({ id: 'SubstitutionItem' });
export type SubstitutionItem = z.infer<typeof SubstitutionItem>;

/** GET /api/v1/substitutions?date=: sessions of the day whose teacher is on approved izin, with or without a substitute. */
export const SubstitutionsQuery = z.object({ date: z.iso.date().optional() }).meta({ id: 'SubstitutionsQuery' });
export type SubstitutionsQuery = z.infer<typeof SubstitutionsQuery>;

export const SubstitutionList = z.object({ schoolDate: z.iso.date(), items: z.array(SubstitutionItem) }).meta({ id: 'SubstitutionList' });
export type SubstitutionList = z.infer<typeof SubstitutionList>;

export const SubstituteCandidate = z
  .object({
    userId: z.uuid(),
    name: z.string(),
    /** Has checked in on that school date. */
    checkedIn: z.boolean(),
    /** Teaches the same subject somewhere in the timetable. */
    sameSubject: z.boolean(),
    /** How often they stood in this month, so the load is shared. */
    substitutionsThisMonth: z.int(),
  })
  .meta({ id: 'SubstituteCandidate' });
export type SubstituteCandidate = z.infer<typeof SubstituteCandidate>;

/** GET /api/v1/substitutions/candidates?sessionId=: teachers free at that time, best first. */
export const CandidatesQuery = z.object({ sessionId: z.uuid() }).meta({ id: 'CandidatesQuery' });
export type CandidatesQuery = z.infer<typeof CandidatesQuery>;

export const CandidateList = z.object({ items: z.array(SubstituteCandidate) }).meta({ id: 'CandidateList' });
export type CandidateList = z.infer<typeof CandidateList>;

export const AssignSubstituteRequest = z.object({ sessionId: z.uuid(), substituteId: z.uuid() }).strict().meta({ id: 'AssignSubstituteRequest' });
export type AssignSubstituteRequest = z.infer<typeof AssignSubstituteRequest>;
