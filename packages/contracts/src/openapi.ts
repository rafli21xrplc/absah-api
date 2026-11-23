// OpenAPI document built from the Zod contracts. Kept out of index.ts so web/kiosk
// bundles that import contracts do not pull in the generator.
import type { z } from 'zod';
import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import {
  SchoolCapabilitiesResponse,
  SchoolProfileResponse,
  SchoolSetupResponse,
  SetupStepParam,
  UpdateSetupStepRequest,
  UpdateSchoolCapabilitiesRequest,
  UpdateSchoolProfileRequest,
} from './academic/school-settings';
import {
  CreateImportRequest,
  CreateImportResponse,
  ImportIdParam,
  StudentImportList,
  StudentImportResponse,
} from './academic/imports';
import {
  ClassList,
  ClassListItem,
  EnrollmentIdParam,
  StudentList,
  StudentListItem,
  StudentListQuery,
  UpdateEnrollmentRequest,
} from './academic/registry';
import {
  ClassIdParam,
  CreateSubjectRequest,
  PutScheduleSlotRequest,
  ReplaceSchedulePeriodsRequest,
  SchedulePeriodsResponse,
  ScheduleQuery,
  ScheduleResponse,
  ScheduleSlot,
  SlotIdParam,
  Subject,
  SubjectList,
  TeacherList,
  UpdateClassRequest,
} from './academic/schedule';
import {
  CreateLearningGroupRequest,
  GroupIdParam,
  LearningGroup,
  LearningGroupDetail,
  LearningGroupList,
  ReplaceGroupMembersRequest,
} from './academic/learning-groups';
import {
  CommitScheduleImportRequest,
  CreateScheduleImportRequest,
  CreateScheduleImportResponse,
  ScheduleImportPreview,
  ScheduleImportResult,
  UploadIdParam,
} from './academic/schedule-import';
import { ErrorBody } from './common';
import {
  AcceptInvitationRequest,
  AcceptInvitationResponse,
  CreateInvitationRequest,
  InvitationPreviewResponse,
  InvitationResponse,
  InvitationTokenRequest,
} from './platform/invitations';
import { MeContextResponse, MembershipIdParam, SchoolMember, SchoolMembersResponse, UpdateMembershipStatusRequest } from './platform/context';
import { HealthResponse } from './platform/health';

export const API_BASE_PATH = '/api/v1';

function buildRegistry(): OpenAPIRegistry {
  const registry = new OpenAPIRegistry();
  // Component names come from each schema's .meta({ id }).
  const errorBody = ErrorBody;
  const healthResponse = HealthResponse;

  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/health`,
    tags: ['platform'],
    summary: 'Liveness check',
    responses: {
      200: { description: 'API is up', content: { 'application/json': { schema: healthResponse } } },
      500: { description: 'Unexpected error', content: { 'application/json': { schema: errorBody } } },
    },
  });

  const errors = (...codes: number[]) =>
    Object.fromEntries(
      codes.map((code) => [code, { description: ERROR_DESCRIPTIONS[code] ?? 'Error', content: { 'application/json': { schema: errorBody } } }]),
    );
  const schoolHeader = {
    name: 'X-School-Id',
    in: 'header' as const,
    description: 'Active school (workspace). Must be a school where the user has an active membership.',
    schema: { type: 'string' as const, format: 'uuid' },
  };
  const idempotencyHeader = {
    name: 'Idempotency-Key',
    in: 'header' as const,
    required: true,
    description: 'One key per user action, reused on retry. Same key with a different body gives 422.',
    schema: { type: 'string' as const, pattern: '^[A-Za-z0-9_\\-:.]{8,128}$' },
  };

  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/me/context`,
    tags: ['platform'],
    summary: 'Current user, their schools, and roles in the active school',
    description: 'X-School-Id is optional here. Admin/operator without TOTP get 403 TWO_FACTOR_REQUIRED when a school is selected.',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: false }],
    responses: {
      200: { description: 'Context', content: { 'application/json': { schema: MeContextResponse } } },
      ...errors(400, 401, 403),
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/school/members`,
    tags: ['platform'],
    summary: 'Members of the active school (admin, operator, kepsek, wakasek)',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    responses: {
      200: { description: 'Members', content: { 'application/json': { schema: SchoolMembersResponse } } },
      ...errors(400, 401, 403),
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${API_BASE_PATH}/school/members/{membershipId}`,
    tags: ['platform'],
    summary: 'Activate or suspend a membership (admin)',
    description: 'Idempotent: send Idempotency-Key. Admins cannot change their own membership.',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }, idempotencyHeader],
    request: {
      params: MembershipIdParam,
      body: { content: { 'application/json': { schema: UpdateMembershipStatusRequest } } },
    },
    responses: {
      200: {
        description: 'Updated membership. Replays carry Idempotent-Replayed: true.',
        content: { 'application/json': { schema: SchoolMember } },
      },
      ...errors(400, 401, 403, 404, 409, 422),
    },
  });

  const adminWrite = (summary: string, path: string, method: 'patch' | 'put', body: typeof UpdateSchoolProfileRequest | typeof UpdateSchoolCapabilitiesRequest, response: typeof SchoolProfileResponse | typeof SchoolCapabilitiesResponse) =>
    registry.registerPath({
      method,
      path: `${API_BASE_PATH}${path}`,
      tags: ['academic'],
      summary,
      description: 'Admin only. Idempotent: send Idempotency-Key. attendance.mode changes apply from tomorrow (school timezone).',
      security: [{ session: [] }],
      parameters: [{ ...schoolHeader, required: true }, idempotencyHeader],
      request: { body: { content: { 'application/json': { schema: body } } } },
      responses: {
        200: { description: 'Saved', content: { 'application/json': { schema: response } } },
        ...errors(400, 401, 403, 409, 422),
      },
    });
  adminWrite('Change the school level / madrasah profile', '/school/profile', 'patch', UpdateSchoolProfileRequest, SchoolProfileResponse);
  adminWrite('Override capabilities of the school', '/school/capabilities', 'put', UpdateSchoolCapabilitiesRequest, SchoolCapabilitiesResponse);
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/school/capabilities`,
    tags: ['academic'],
    summary: 'Capability settings of the active school (admin)',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    responses: {
      200: { description: 'Settings', content: { 'application/json': { schema: SchoolCapabilitiesResponse } } },
      ...errors(400, 401, 403),
    },
  });

  const setupResponse = {
    200: { description: 'Wizard progress', content: { 'application/json': { schema: SchoolSetupResponse } } },
  };
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/school/setup`,
    tags: ['academic'],
    summary: 'Setup wizard progress of the active school (admin)',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    responses: { ...setupResponse, ...errors(400, 401, 403) },
  });
  registry.registerPath({
    method: 'put',
    path: `${API_BASE_PATH}/school/setup/steps/{step}`,
    tags: ['academic'],
    summary: 'Mark a wizard step done or skipped (admin)',
    description: 'Naturally idempotent. profile and level cannot be skipped.',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: {
      params: SetupStepParam,
      body: { content: { 'application/json': { schema: UpdateSetupStepRequest } } },
    },
    responses: { ...setupResponse, ...errors(400, 401, 403) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/school/setup/complete`,
    tags: ['academic'],
    summary: 'Finish the setup wizard (admin)',
    description: 'Naturally idempotent (keeps the first completion time). 409 until profile and level are done.',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    responses: { ...setupResponse, ...errors(400, 401, 403, 409) },
  });

  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/school/invitations`,
    tags: ['platform'],
    summary: 'Invite a staff member by email or WhatsApp number (admin)',
    description: 'Idempotent. Returns the invite link once; re-inviting a pending member replaces the link.',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }, idempotencyHeader],
    request: { body: { content: { 'application/json': { schema: CreateInvitationRequest } } } },
    responses: {
      201: { description: 'Invited', content: { 'application/json': { schema: InvitationResponse } } },
      ...errors(400, 401, 403, 409, 422),
    },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/invitations/preview`,
    tags: ['platform'],
    summary: 'Show an invitation before accepting it (public, token in body)',
    request: { body: { content: { 'application/json': { schema: InvitationTokenRequest } } } },
    responses: {
      200: { description: 'Invitation', content: { 'application/json': { schema: InvitationPreviewResponse } } },
      ...errors(400, 404),
    },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/invitations/accept`,
    tags: ['platform'],
    summary: 'Accept an invitation; email accounts without a password choose one (public)',
    request: { body: { content: { 'application/json': { schema: AcceptInvitationRequest } } } },
    responses: {
      200: { description: 'Accepted', content: { 'application/json': { schema: AcceptInvitationResponse } } },
      ...errors(400, 404),
    },
  });

  const importResponse = (description: string) => ({
    200: { description, content: { 'application/json': { schema: StudentImportResponse } } },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/imports/dapodik`,
    tags: ['academic'],
    summary: 'Start a Dapodik import: returns a presigned PUT for the .xlsx (admin, operator)',
    description: 'Needs data.source = dapodik. Upload the file to upload.url, then POST /imports/{importId}/parse.',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }, idempotencyHeader],
    request: { body: { content: { 'application/json': { schema: CreateImportRequest } } } },
    responses: {
      201: { description: 'Created', content: { 'application/json': { schema: CreateImportResponse } } },
      ...errors(400, 401, 403, 404, 409, 422),
    },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/imports/{importId}/parse`,
    tags: ['academic'],
    summary: 'Queue parsing of the uploaded file, or refresh a ready preview (admin, operator)',
    description: 'Naturally idempotent. Poll GET /imports/{importId} until status is ready or failed.',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { params: ImportIdParam },
    responses: { ...importResponse('Import'), ...errors(400, 401, 403, 404, 409) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/imports/{importId}/commit`,
    tags: ['academic'],
    summary: 'Apply a ready import in one transaction (admin, operator)',
    description:
      'Creates the academic year and rombel when needed, adds new students, applies changes and flags students missing from the file as calon keluar (never deletes). Committing again returns the result. 409 with details.reason = stale_preview when data changed since the preview: refresh with POST /imports/{importId}/parse.',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }, idempotencyHeader],
    request: { params: ImportIdParam },
    responses: { ...importResponse('Committed import'), ...errors(400, 401, 403, 404, 409, 422) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/imports/{importId}`,
    tags: ['academic'],
    summary: 'Import status and preview (admin, operator)',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { params: ImportIdParam },
    responses: { ...importResponse('Import with preview'), ...errors(400, 401, 403, 404) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/imports`,
    tags: ['academic'],
    summary: 'Recent imports without preview items (admin, operator)',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    responses: {
      200: { description: 'Imports', content: { 'application/json': { schema: StudentImportList } } },
      ...errors(400, 401, 403),
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/students`,
    tags: ['academic'],
    summary: 'Students with their rombel in the active year (admin, operator, kepsek, wakasek)',
    description: 'Cursor pagination ordered by name. NIK is never returned.',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { query: StudentListQuery },
    responses: {
      200: { description: 'Students', content: { 'application/json': { schema: StudentList } } },
      ...errors(400, 401, 403),
    },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/classes`,
    tags: ['academic'],
    summary: 'Rombel of the active academic year with student counts (admin, operator, kepsek, wakasek)',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    responses: {
      200: { description: 'Rombel', content: { 'application/json': { schema: ClassList } } },
      ...errors(400, 401, 403),
    },
  });
  registry.registerPath({
    method: 'patch',
    path: `${API_BASE_PATH}/enrollments/{enrollmentId}`,
    tags: ['academic'],
    summary: 'Settle a calon keluar student: keep, moved or left (admin, operator)',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }, idempotencyHeader],
    request: {
      params: EnrollmentIdParam,
      body: { content: { 'application/json': { schema: UpdateEnrollmentRequest } } },
    },
    responses: {
      200: { description: 'Student', content: { 'application/json': { schema: StudentListItem } } },
      ...errors(400, 401, 403, 404, 409, 422),
    },
  });

  const json = (schema: z.ZodType, description: string) => ({ description, content: { 'application/json': { schema } } });
  const scheduleRead = (path: string, summary: string, response: z.ZodType, request?: { query?: z.ZodObject }) =>
    registry.registerPath({
      method: 'get',
      path: `${API_BASE_PATH}${path}`,
      tags: ['academic'],
      summary,
      security: [{ session: [] }],
      parameters: [{ ...schoolHeader, required: true }],
      ...(request ? { request } : {}),
      responses: { 200: json(response, 'OK'), ...errors(400, 401, 403) },
    });
  scheduleRead('/subjects', 'Subjects of the school (staff)', SubjectList);
  scheduleRead('/schedule/periods', 'Jam pelajaran per weekday (staff)', SchedulePeriodsResponse);
  scheduleRead('/schedule/teachers', 'Staff who can teach or be wali kelas (schedule managers)', TeacherList);
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/schedule`,
    tags: ['academic'],
    summary: 'Weekly timetable of one rombel, learning group or teacher (staff)',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { query: ScheduleQuery },
    responses: { 200: json(ScheduleResponse, 'Timetable'), ...errors(400, 401, 403) },
  });
  const scheduleWrite = (method: 'post' | 'put' | 'patch' | 'delete', path: string, summary: string, response: z.ZodType | null, body?: z.ZodType, params?: z.ZodObject, description?: string) =>
    registry.registerPath({
      method,
      path: `${API_BASE_PATH}${path}`,
      tags: ['academic'],
      summary,
      ...(description ? { description } : {}),
      security: [{ session: [] }],
      parameters: [{ ...schoolHeader, required: true }, idempotencyHeader],
      request: { ...(params ? { params } : {}), ...(body ? { body: { content: { 'application/json': { schema: body } } } } : {}) },
      responses: { ...(response ? { 200: json(response, 'Saved') } : { 204: { description: 'Deleted' } }), ...errors(400, 401, 403, 404, 409, 422) },
    });
  scheduleWrite('post', '/subjects', 'Add a subject (admin, operator, wakasek)', Subject, CreateSubjectRequest);
  scheduleWrite('put', '/schedule/periods', 'Replace jam pelajaran (admin, operator, wakasek)', SchedulePeriodsResponse, ReplaceSchedulePeriodsRequest, undefined, '409 when a removed period still has lessons.');
  scheduleWrite(
    'put',
    '/schedule/slots',
    'Set the lesson of a rombel or group at a day and period (admin, operator, wakasek)',
    ScheduleSlot,
    PutScheduleSlotRequest,
    undefined,
    '409 SCHEDULE_CONFLICT with details.conflicts (ScheduleConflictDetail[]) when the teacher or any student already has a lesson then.',
  );
  scheduleWrite('delete', '/schedule/slots/{slotId}', 'Remove a lesson (admin, operator, wakasek)', null, undefined, SlotIdParam);
  scheduleWrite('patch', '/classes/{classId}', 'Set the wali kelas of a rombel (admin, operator, wakasek)', ClassListItem, UpdateClassRequest, ClassIdParam);

  scheduleRead('/learning-groups', 'Learning groups of the active year (staff; attendance.learningGroups)', LearningGroupList);
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/learning-groups/{groupId}`,
    tags: ['academic'],
    summary: 'A learning group with its members (staff; attendance.learningGroups)',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { params: GroupIdParam },
    responses: { 200: json(LearningGroupDetail, 'Group'), ...errors(400, 401, 403, 404) },
  });
  scheduleWrite('post', '/learning-groups', 'Create a learning group (admin, operator, wakasek)', LearningGroup, CreateLearningGroupRequest);
  scheduleWrite(
    'put',
    '/learning-groups/{groupId}/members',
    'Replace the members of a learning group (admin, operator, wakasek)',
    LearningGroupDetail,
    ReplaceGroupMembersRequest,
    GroupIdParam,
    '409 SCHEDULE_CONFLICT when a new member already has a lesson at one of the group lesson times.',
  );

  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/schedule/template.xlsx`,
    tags: ['academic'],
    summary: 'Absah schedule template, filled with the current rombel lessons (schedule managers)',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    responses: {
      200: { description: 'Excel workbook', content: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { schema: { type: 'string', format: 'binary' } } } },
      ...errors(401, 403, 409),
    },
  });
  scheduleWrite('post', '/schedule/imports', 'Presigned upload for a filled schedule template (admin, operator, wakasek)', CreateScheduleImportResponse, CreateScheduleImportRequest);
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/schedule/imports/{uploadId}/preview`,
    tags: ['academic'],
    summary: 'Dry run of a schedule import: lessons, new subjects and per-row errors including clashes',
    description: '400 when the file is not the Absah template; 409 when nothing was uploaded yet. Writes nothing.',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { params: UploadIdParam },
    responses: { 200: json(ScheduleImportPreview, 'Preview'), ...errors(400, 401, 403, 409) },
  });
  scheduleWrite(
    'post',
    '/schedule/imports/{uploadId}/commit',
    'Apply a schedule import in one transaction (admin, operator, wakasek)',
    ScheduleImportResult,
    CommitScheduleImportRequest,
    UploadIdParam,
    'Replaces every lesson of the rombel in the file. 409 stale_preview when the file or school data changed since the preview, 409 has_errors while rows have errors.',
  );

  registry.registerComponent('securitySchemes', 'session', {
    type: 'apiKey',
    in: 'cookie',
    name: 'better-auth.session_token',
    description: 'Session cookie from /api/auth/* (Better Auth).',
  });

  return registry;
}

const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: 'Validation failed (VALIDATION_FAILED)',
  401: 'No session (UNAUTHENTICATED)',
  403: 'Not a member, wrong role (FORBIDDEN) or 2FA missing (TWO_FACTOR_REQUIRED)',
  404: 'Not found (NOT_FOUND); unknown, used or expired invitation',
  409: 'Same Idempotency-Key still running (IDEMPOTENCY_IN_PROGRESS) or state conflict (CONFLICT)',
  422: 'Idempotency-Key reused with a different request (IDEMPOTENCY_KEY_REUSED)',
};

export function generateOpenApiDocument(version = '0.0.0') {
  const generator = new OpenApiGeneratorV31(buildRegistry().definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: { title: 'Absah API', version },
    servers: [{ url: '/' }],
  });
}
