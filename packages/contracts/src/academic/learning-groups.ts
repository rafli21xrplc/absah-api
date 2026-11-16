import { z } from 'zod';
import { StaffRef } from './schedule';

/** Learning groups: mapel pilihan and moving class across rombel (AKD-10 foundation). */

export const LearningGroup = z
  .object({
    id: z.uuid(),
    name: z.string(),
    subject: z.object({ id: z.uuid(), name: z.string() }),
    teacher: StaffRef.nullable(),
    memberCount: z.int(),
  })
  .meta({ id: 'LearningGroup' });
export type LearningGroup = z.infer<typeof LearningGroup>;

export const LearningGroupList = z.object({ items: z.array(LearningGroup) }).meta({ id: 'LearningGroupList' });

export const LearningGroupMember = z.object({
  enrollmentId: z.uuid(),
  studentId: z.uuid(),
  name: z.string(),
  className: z.string(),
});

export const LearningGroupDetail = LearningGroup.extend({ members: z.array(LearningGroupMember) }).meta({ id: 'LearningGroupDetail' });
export type LearningGroupDetail = z.infer<typeof LearningGroupDetail>;

export const CreateLearningGroupRequest = z
  .object({
    name: z.string().trim().min(2).max(80),
    subjectId: z.uuid(),
    teacherId: z.uuid().nullable(),
  })
  .strict()
  .meta({ id: 'CreateLearningGroupRequest' });
export type CreateLearningGroupRequest = z.infer<typeof CreateLearningGroupRequest>;

export const GroupIdParam = z.object({ groupId: z.uuid() });

/** PUT /api/v1/learning-groups/{groupId}/members: the full member list (active enrollments). */
export const ReplaceGroupMembersRequest = z
  .object({ enrollmentIds: z.array(z.uuid()).max(300) })
  .strict()
  .meta({ id: 'ReplaceGroupMembersRequest' });
export type ReplaceGroupMembersRequest = z.infer<typeof ReplaceGroupMembersRequest>;
