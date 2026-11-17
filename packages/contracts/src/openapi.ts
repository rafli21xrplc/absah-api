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
import {
  Correction,
  CorrectionIdParam,
  CorrectionList,
  CorrectionListQuery,
  CreateCorrectionsRequest,
  DecideCorrectionRequest,
} from './attendance/corrections';
import { JournalQuery, JournalResponse } from './attendance/journal';
import { SessionDetail, SessionIdParam, SubmitSessionRequest, TodayQuery, TodayResponse } from './attendance/sessions';
import { ErrorBody } from './common';
import { BindCardDeviceRequest, CardDeviceKeys, DeviceIdParam, MyCards } from './gate/cards';
import { Arrival, GateToday, ManualArrivalRequest } from './gate/arrivals';
import { CreateVisitorPhotoRequest, CreateVisitorPhotoResponse, CreateVisitorRequest, Visitor, VisitorPhotoLink, VisitorHostList, VisitorIdParam, VisitorList, VisitorsQuery } from './gate/visitors';
import { NotificationOverview } from './notify/notifications';
import { StudentContacts, StudentIdParam, UpdateStudentContactsRequest } from './academic/contacts';
import { ActionLinkCardRequest, ActionLinkContext, ActionLinkLeave, ActionLinkLeaveRequest, PortalAttendance } from './portal/links';
import { KioskDay, KioskScanBatch, KioskScanResults } from './gate/scans';
import { KioskDevice, KioskDeviceList, KioskHeartbeatRequest, KioskHeartbeatResponse, KioskIdParam, KioskPairing, PairKioskRequest, PairKioskResponse } from './gate/kiosks';
import {
  CreateLeaveAttachmentRequest,
  CreateLeaveAttachmentResponse,
  CreateLeaveRequest,
  DecideLeaveRequest,
  LeaveAttachmentLink,
  LeaveRequest,
  LeaveRequestIdParam,
  LeaveRequestList,
  LeaveRequestListQuery,
  LeaveStudentList,
} from './leave/leave-requests';
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
import { CreateExportRequest, ExportDownload, ExportIdParam, ExportJob, ExportJobList } from './report/exports';
import { MbgDaily, MbgDailyQuery, MbgSettings, UpdateMbgSettingsRequest } from './report/mbg';
import { InvoiceDetail, InvoiceIdParam, InvoiceList } from './billing/invoices';
import { CreatePaymentRequest, Payment, PaymentList } from './billing/payments';
import { ClassRecapDetail, ClassRecapList, RecapClassIdParam, ReportPeriodQuery, ReportSemesterList, SessionCompliance } from './report/recap';

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

  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/attendance/today`,
    tags: ['attendance'],
    summary: "Today's sessions: mine (teacher, wali kelas) or all (admin, operator, kepsek, wakasek, piket)",
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { query: TodayQuery },
    responses: { 200: json(TodayResponse, 'Sessions of the school date'), ...errors(400, 401, 403) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/sessions/{sessionId}`,
    tags: ['attendance'],
    summary: 'A session with its students and current statuses',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { params: SessionIdParam },
    responses: { 200: json(SessionDetail, 'Session'), ...errors(401, 403, 404) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/sessions/{sessionId}/submit`,
    tags: ['attendance'],
    summary: 'Fill a session: everyone present except the listed exceptions',
    description:
      'Statuses from izin, UKS or an approved correction are kept. 409 SESSION_LOCKED after 23.59: request a correction instead. Emits attendance.absent_marked for students newly marked A.',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }, idempotencyHeader],
    request: { params: SessionIdParam, body: { content: { 'application/json': { schema: SubmitSessionRequest } } } },
    responses: { 200: json(SessionDetail, 'Filled session'), ...errors(400, 401, 403, 404, 409) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/teaching-journal`,
    tags: ['attendance'],
    summary: 'Jurnal mengajar of one month: per-period sessions with their topic (PRS-09)',
    description: 'A guru sees only their own sessions. admin, kepsek and wakasek may pass teacherId, or omit it for every teacher.',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { query: JournalQuery },
    responses: { 200: json(JournalResponse, 'Journal entries'), ...errors(400, 401, 403) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/teaching-journal/export.xlsx`,
    tags: ['attendance'],
    summary: 'Excel of one teacher\'s jurnal mengajar for a month',
    description: 'teacherId is required for managers; a guru gets their own.',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { query: JournalQuery },
    responses: {
      200: { description: 'Excel workbook', content: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { schema: { type: 'string', format: 'binary' } } } },
      ...errors(400, 401, 403, 404),
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/sessions/{sessionId}/corrections`,
    tags: ['attendance'],
    summary: 'Ask to correct students in a locked session (whoever may fill it)',
    description: '409 when the session is not locked yet (fill it directly) or a change is already pending.',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }, idempotencyHeader],
    request: { params: SessionIdParam, body: { content: { 'application/json': { schema: CreateCorrectionsRequest } } } },
    responses: { 200: json(CorrectionList, 'Created requests'), ...errors(400, 401, 403, 404, 409) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/corrections`,
    tags: ['attendance'],
    summary: 'Correction requests: all for wakasek and kepsek, own requests for others',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { query: CorrectionListQuery },
    responses: { 200: json(CorrectionList, 'Requests'), ...errors(400, 401, 403) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/corrections/{correctionId}/decide`,
    tags: ['attendance'],
    summary: 'Approve or reject a correction (wakasek, kepsek; not your own request)',
    description: 'Approval writes the status with source manual, which nothing else overrides, and recomputes daily attendance.',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }, idempotencyHeader],
    request: { params: CorrectionIdParam, body: { content: { 'application/json': { schema: DecideCorrectionRequest } } } },
    responses: { 200: json(Correction, 'Decided'), ...errors(400, 401, 403, 404, 409) },
  });

  const leaveParams = [{ ...schoolHeader, required: true }];
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/leave-requests/students`,
    tags: ['leave'],
    summary: 'Students the caller may request izin for (children, rombel, or all for wakasek/kepsek)',
    security: [{ session: [] }],
    parameters: leaveParams,
    responses: { 200: json(LeaveStudentList, 'Students'), ...errors(401, 403) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/leave-requests/attachments`,
    tags: ['leave'],
    summary: 'Presigned upload for a letter or photo (5 MB, JPEG/PNG/WebP/PDF)',
    security: [{ session: [] }],
    parameters: [...leaveParams, idempotencyHeader],
    request: { body: { content: { 'application/json': { schema: CreateLeaveAttachmentRequest } } } },
    responses: { 200: json(CreateLeaveAttachmentResponse, 'Upload'), ...errors(400, 401, 403) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/leave-requests`,
    tags: ['leave'],
    summary: 'Request izin: a parent (pending) or the wali kelas / wakasek / kepsek (approved at once)',
    description: 'At most 30 days, starting at most 7 days back. 409 overlap when the student already has izin on one of the days.',
    security: [{ session: [] }],
    parameters: [...leaveParams, idempotencyHeader],
    request: { body: { content: { 'application/json': { schema: CreateLeaveRequest } } } },
    responses: { 200: json(LeaveRequest, 'Created'), ...errors(400, 401, 404, 409) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/leave-requests`,
    tags: ['leave'],
    summary: 'Izin: all for wakasek/kepsek; own, rombel or children for others',
    security: [{ session: [] }],
    parameters: leaveParams,
    request: { query: LeaveRequestListQuery },
    responses: { 200: json(LeaveRequestList, 'Requests'), ...errors(400, 401) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/leave-requests/{leaveRequestId}`,
    tags: ['leave'],
    summary: 'One izin',
    security: [{ session: [] }],
    parameters: leaveParams,
    request: { params: LeaveRequestIdParam },
    responses: { 200: json(LeaveRequest, 'Request'), ...errors(401, 404) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/leave-requests/{leaveRequestId}/attachment`,
    tags: ['leave'],
    summary: 'A 5-minute link to view the attachment',
    security: [{ session: [] }],
    parameters: leaveParams,
    request: { params: LeaveRequestIdParam },
    responses: { 200: json(LeaveAttachmentLink, 'Link'), ...errors(401, 404) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/leave-requests/{leaveRequestId}/decide`,
    tags: ['leave'],
    summary: 'Approve or reject a pending izin (wali kelas, wakasek, kepsek)',
    description: 'Approval fills the sessions in the range with S (sakit) or I (izin), also sessions created later.',
    security: [{ session: [] }],
    parameters: [...leaveParams, idempotencyHeader],
    request: { params: LeaveRequestIdParam, body: { content: { 'application/json': { schema: DecideLeaveRequest } } } },
    responses: { 200: json(LeaveRequest, 'Decided'), ...errors(400, 401, 403, 404, 409) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/leave-requests/{leaveRequestId}/cancel`,
    tags: ['leave'],
    summary: 'Cancel a pending or approved izin (requester or wali kelas); attendance falls back to the next source',
    security: [{ session: [] }],
    parameters: [...leaveParams, idempotencyHeader],
    request: { params: LeaveRequestIdParam },
    responses: { 200: json(LeaveRequest, 'Cancelled'), ...errors(401, 403, 404, 409) },
  });

  const gateParams = [{ ...schoolHeader, required: true }];
  const gateNote = 'Requires gate.enabled (404 CAPABILITY_DISABLED otherwise).';
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/gate/kiosks/pairings`,
    tags: ['gate'],
    summary: 'One-time pairing code for a new kiosk (admin, operator; 10 minutes)',
    description: gateNote,
    security: [{ session: [] }],
    parameters: [...gateParams, idempotencyHeader],
    responses: { 200: json(KioskPairing, 'Code'), ...errors(401, 403, 404) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/gate/kiosks`,
    tags: ['gate'],
    summary: 'Kiosk devices with heartbeat state (admin, operator)',
    description: gateNote,
    security: [{ session: [] }],
    parameters: gateParams,
    responses: { 200: json(KioskDeviceList, 'Kiosks'), ...errors(401, 403, 404) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/gate/kiosks/{kioskId}/revoke`,
    tags: ['gate'],
    summary: 'Revoke a kiosk; its token stops working at once',
    description: gateNote,
    security: [{ session: [] }],
    parameters: [...gateParams, idempotencyHeader],
    request: { params: KioskIdParam },
    responses: { 200: json(KioskDevice, 'Revoked'), ...errors(401, 403, 404) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/kiosk/pair`,
    tags: ['kiosk'],
    summary: 'A kiosk claims a pairing code and receives its device token (shown once)',
    description: 'No session. Idempotency-Key is scoped to the school named in the code.',
    parameters: [{ ...idempotencyHeader, required: true }],
    request: { body: { content: { 'application/json': { schema: PairKioskRequest } } } },
    responses: { 200: json(PairKioskResponse, 'Paired'), ...errors(400, 404) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/kiosk/heartbeat`,
    tags: ['kiosk'],
    summary: 'Every minute: queue size and app version',
    security: [{ kiosk: [] }],
    parameters: [{ ...idempotencyHeader, required: true }],
    request: { body: { content: { 'application/json': { schema: KioskHeartbeatRequest } } } },
    responses: { 200: json(KioskHeartbeatResponse, 'Server time'), ...errors(400, 401, 404) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/cards/mine`,
    tags: ['gate'],
    summary: 'Cards the caller holds (card.holder: own card for students, children for parents)',
    description: gateNote,
    security: [{ session: [] }],
    parameters: gateParams,
    responses: { 200: json(MyCards, 'Cards'), ...errors(401, 404) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/cards/devices`,
    tags: ['gate'],
    summary: 'Bind this phone to a card (the previous phone stops working) and get 7 days of keys',
    description: gateNote,
    security: [{ session: [] }],
    parameters: [...gateParams, idempotencyHeader],
    request: { body: { content: { 'application/json': { schema: BindCardDeviceRequest } } } },
    responses: { 200: json(CardDeviceKeys, 'Device keys'), ...errors(400, 401, 404) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/cards/devices/{deviceId}/keys`,
    tags: ['gate'],
    summary: 'Fresh day keys while this phone is still the bound device',
    description: gateNote,
    security: [{ session: [] }],
    parameters: gateParams,
    request: { params: DeviceIdParam },
    responses: { 200: json(CardDeviceKeys, 'Device keys'), ...errors(401, 404) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/kiosk/day`,
    tags: ['kiosk'],
    summary: 'Morning download for offline work: day keys (today, tomorrow), late time, bound cards',
    security: [{ kiosk: [] }],
    responses: { 200: json(KioskDay, 'Day'), ...errors(401, 404) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/kiosk/scans`,
    tags: ['kiosk'],
    summary: 'Queued scans, exactly once per clientEventId (a resent batch gets the stored answers)',
    description:
      'Results per scan: accepted (first arrival of the day, on_time or late; marks attendance with source gate), duplicate, or rejected with a reason (malformed, expired, bad_signature, unknown_card, wrong_device, not_enrolled).',
    security: [{ kiosk: [] }],
    parameters: [{ ...idempotencyHeader, required: true }],
    request: { body: { content: { 'application/json': { schema: KioskScanBatch } } } },
    responses: { 200: json(KioskScanResults, 'Results'), ...errors(400, 401, 404) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/gate/arrivals`,
    tags: ['gate'],
    summary: 'Piket enters an arrival without a card scan (reason required, today only)',
    description: `${gateNote} 409 already_arrived when the student is already in.`,
    security: [{ session: [] }],
    parameters: [...gateParams, idempotencyHeader],
    request: { body: { content: { 'application/json': { schema: ManualArrivalRequest } } } },
    responses: { 200: json(Arrival, 'Recorded'), ...errors(400, 401, 403, 404, 409) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/gate/today`,
    tags: ['gate'],
    summary: 'Late arrivals and students not in yet (piket, admin, operator, wakasek, kepsek)',
    description: gateNote,
    security: [{ session: [] }],
    parameters: gateParams,
    responses: { 200: json(GateToday, 'Today'), ...errors(401, 403, 404) },
  });
  const visitorNote = 'Requires gate.visitors (404 CAPABILITY_DISABLED otherwise).';
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/kiosk/visitor-hosts`,
    tags: ['kiosk'],
    summary: 'Staff a guest can pick as the person they came for (name only)',
    description: visitorNote,
    security: [{ kiosk: [] }],
    responses: { 200: json(VisitorHostList, 'Hosts'), ...errors(401, 404) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/kiosk/visitor-photos`,
    tags: ['kiosk'],
    summary: "A presigned PUT for the guest's photo (JPEG, up to 2 MB); send photoId with POST /kiosk/visitors",
    description: visitorNote,
    security: [{ kiosk: [] }],
    parameters: [{ ...idempotencyHeader, required: true }],
    request: { body: { content: { 'application/json': { schema: CreateVisitorPhotoRequest } } } },
    responses: { 200: json(CreateVisitorPhotoResponse, 'Upload'), ...errors(400, 401, 404) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/kiosk/visitors`,
    tags: ['kiosk'],
    summary: 'A guest signs in at the kiosk (buku tamu); the person they came for is told',
    description: `${visitorNote} Exactly once per clientEventId: a resend returns the stored visit. Emits gate.visitor_arrived when a host is named.`,
    security: [{ kiosk: [] }],
    parameters: [{ ...idempotencyHeader, required: true }],
    request: { body: { content: { 'application/json': { schema: CreateVisitorRequest } } } },
    responses: { 200: json(Visitor, 'Visit'), ...errors(400, 401, 404) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/visitors`,
    tags: ['gate'],
    summary: "The day's guests, newest first (piket, admin, operator, wakasek, kepsek)",
    description: visitorNote,
    security: [{ session: [] }],
    parameters: gateParams,
    request: { query: VisitorsQuery },
    responses: { 200: json(VisitorList, 'Visitors'), ...errors(400, 401, 403, 404) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/visitors/{visitorId}/photo`,
    tags: ['gate'],
    summary: "A 5-minute link to the guest's photo (piket, admin, operator, wakasek, kepsek)",
    description: `${visitorNote} 404 when there is no photo or it was removed 30 days after the guest left.`,
    security: [{ session: [] }],
    parameters: gateParams,
    request: { params: VisitorIdParam },
    responses: { 200: json(VisitorPhotoLink, 'Link'), ...errors(401, 403, 404) },
  });
  registry.registerPath({
    method: 'patch',
    path: `${API_BASE_PATH}/visitors/{visitorId}/leave`,
    tags: ['gate'],
    summary: 'Piket signs a guest out; signing out again changes nothing',
    description: visitorNote,
    security: [{ session: [] }],
    parameters: [...gateParams, idempotencyHeader],
    request: { params: VisitorIdParam },
    responses: { 200: json(Visitor, 'Visit'), ...errors(401, 403, 404) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/notifications/overview`,
    tags: ['notify'],
    summary: "WhatsApp delivery today and failures of the last 7 days (admin, operator; numbers masked)",
    security: [{ session: [] }],
    parameters: [schoolHeader],
    responses: { 200: json(NotificationOverview, 'Overview'), ...errors(401, 403) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/webhooks/whatsapp`,
    tags: ['notify'],
    summary: 'Provider registration check: echoes hub.challenge when hub.verify_token matches',
    responses: { 200: { description: 'The challenge, as text/plain' }, ...errors(401, 404) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/webhooks/whatsapp`,
    tags: ['notify'],
    summary: 'Message status webhook (WhatsApp Cloud API format), signed with X-Hub-Signature-256',
    description: 'Stored once per message id + status and applied by the worker; ranks make the final status right in any order.',
    responses: { 200: { description: 'Stored' }, ...errors(401, 404) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/students/{studentId}/contacts`,
    tags: ['academic'],
    summary: "WhatsApp numbers of a student and their guardians, masked (admin, operator, the student's wali kelas)",
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { params: StudentIdParam },
    responses: { 200: json(StudentContacts, 'Contacts'), ...errors(401, 404) },
  });
  registry.registerPath({
    method: 'put',
    path: `${API_BASE_PATH}/students/{studentId}/contacts`,
    tags: ['academic'],
    summary: "Set guardian numbers (messages, action links) and the student's PWA login number",
    description: 'A student number creates or moves their OTP login and an active siswa membership; null suspends it. 409 reason phone_taken when the number belongs to another account.',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }, idempotencyHeader],
    request: { params: StudentIdParam, body: { content: { 'application/json': { schema: UpdateStudentContactsRequest } } } },
    responses: { 200: json(StudentContacts, 'Contacts'), ...errors(400, 401, 404, 409, 422) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/portal/attendance`,
    tags: ['portal'],
    summary: "PWA: the siswa's own attendance or the orang tua's children's, today and the last 30 days",
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    responses: { 200: json(PortalAttendance, 'History'), ...errors(401, 403) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/reports/semesters`,
    tags: ['report'],
    summary: 'Semesters of the active year (period picker for rekap and exports)',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    responses: { 200: json(ReportSemesterList, 'Semesters'), ...errors(401, 403) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/reports/attendance/classes`,
    tags: ['report'],
    summary: 'Rekap S/I/A per rombel for a period (RKP-01); wali kelas see their own rombel',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { query: ReportPeriodQuery },
    responses: { 200: json(ClassRecapList, 'Rekap per rombel'), ...errors(400, 401, 403) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/reports/attendance/classes/{classId}`,
    tags: ['report'],
    summary: 'Rekap S/I/A per student of one rombel for a period (RKP-01, RKP-02)',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { params: RecapClassIdParam, query: ReportPeriodQuery },
    responses: { 200: json(ClassRecapDetail, 'Rekap per siswa'), ...errors(400, 401, 403, 404) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/reports/session-compliance`,
    tags: ['report'],
    summary: 'Session filling compliance per teacher and day (RKP-04, wakasek and kepsek)',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { query: ReportPeriodQuery },
    responses: { 200: json(SessionCompliance, 'Compliance'), ...errors(400, 401, 403) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/exports`,
    tags: ['report'],
    summary: 'Queue a semester rekap file for the school report system (xlsx) or the signed archive (pdf)',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }, idempotencyHeader],
    request: { body: { content: { 'application/json': { schema: CreateExportRequest } } } },
    responses: { 202: json(ExportJob, 'Queued'), ...errors(400, 401, 403, 404, 409, 422) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/exports`,
    tags: ['report'],
    summary: "The caller's own exports, newest first",
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    responses: { 200: json(ExportJobList, 'Exports'), ...errors(401, 403) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/exports/{exportId}`,
    tags: ['report'],
    summary: 'One export (poll until done or failed)',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { params: ExportIdParam },
    responses: { 200: json(ExportJob, 'Export'), ...errors(401, 403, 404) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/exports/{exportId}/download`,
    tags: ['report'],
    summary: 'A 5-minute presigned URL that saves the finished file',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { params: ExportIdParam },
    responses: { 200: json(ExportDownload, 'Download'), ...errors(401, 403, 404, 409) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/mbg/daily`,
    tags: ['report'],
    summary: 'Jumlah hadir MBG per rombel: live before the cutoff, the stored (latest corrected) numbers after it',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { query: MbgDailyQuery },
    responses: { 200: json(MbgDaily, 'Counts'), ...errors(400, 401, 403, 404) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/mbg/daily/recount`,
    tags: ['report'],
    summary: "Correct today's MBG numbers after the cutoff (admin): changed rombel get a new row, the PIC a correction",
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }, idempotencyHeader],
    responses: { 200: json(MbgDaily, 'Counts'), ...errors(401, 403, 404, 409, 422) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/mbg/settings`,
    tags: ['report'],
    summary: 'MBG cutoff time and PIC (number masked)',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    responses: { 200: json(MbgSettings, 'Settings'), ...errors(401, 403, 404) },
  });
  registry.registerPath({
    method: 'put',
    path: `${API_BASE_PATH}/mbg/settings`,
    tags: ['report'],
    summary: 'Set the MBG cutoff time and PIC (admin)',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }, idempotencyHeader],
    request: { body: { content: { 'application/json': { schema: UpdateMbgSettingsRequest } } } },
    responses: { 200: json(MbgSettings, 'Settings'), ...errors(400, 401, 403, 404, 409, 422) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/billing/invoices`,
    tags: ['billing'],
    summary: "Absah's monthly invoices to the school, newest first (admin, kepsek)",
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    responses: { 200: json(InvoiceList, 'Invoices'), ...errors(401, 403) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/billing/invoices/{invoiceId}`,
    tags: ['billing'],
    summary: 'One invoice with a line per billed student',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { params: InvoiceIdParam },
    responses: { 200: json(InvoiceDetail, 'Invoice'), ...errors(401, 403, 404) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/billing/invoices/{invoiceId}/payments`,
    tags: ['billing'],
    summary: 'Open a VA or QRIS for an invoice (admin); the worker creates it at the gateway (poll the list)',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }, idempotencyHeader],
    request: { params: InvoiceIdParam, body: { content: { 'application/json': { schema: CreatePaymentRequest } } } },
    responses: { 202: json(Payment, 'Requested'), ...errors(400, 401, 403, 404, 409, 422) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/billing/invoices/{invoiceId}/payments`,
    tags: ['billing'],
    summary: 'Payment attempts of an invoice, newest first',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { params: InvoiceIdParam },
    responses: { 200: json(PaymentList, 'Payments'), ...errors(401, 403, 404) },
  });
  registry.registerComponent('securitySchemes', 'actionLink', {
    type: 'apiKey',
    in: 'header',
    name: 'Authorization',
    description: 'Link <token> from the action link in a WhatsApp message (the web page /t reads it from the URL fragment)',
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/links/context`,
    tags: ['portal'],
    summary: "Action link: the student's day (first name only), recent izin and what the link can still do",
    security: [{ actionLink: [] }],
    responses: { 200: json(ActionLinkContext, 'Context'), ...errors(401, 410) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/links/leave`,
    tags: ['portal'],
    summary: "Action link: the link's one write, an izin request pending for the wali kelas",
    description: '409 reason link_used once spent; a request refused with 400 does not spend it.',
    security: [{ actionLink: [] }],
    request: { body: { content: { 'application/json': { schema: ActionLinkLeaveRequest } } } },
    responses: { 201: json(ActionLinkLeave, 'Pending izin'), ...errors(400, 401, 409, 410) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/links/card`,
    tags: ['portal'],
    summary: "Action link: day keys for the student's card on this phone (gate.enabled)",
    description: '409 reason bound_elsewhere while the card is active on another phone, unless replace is true.',
    security: [{ actionLink: [] }],
    request: { body: { content: { 'application/json': { schema: ActionLinkCardRequest } } } },
    responses: { 200: json(CardDeviceKeys, 'Card keys'), ...errors(401, 404, 409, 410) },
  });
  registry.registerComponent('securitySchemes', 'kiosk', {
    type: 'apiKey',
    in: 'header',
    name: 'Authorization',
    description: 'Kiosk <deviceToken> from POST /kiosk/pair',
  });

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
