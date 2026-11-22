// OpenAPI document built from the Zod contracts. Kept out of index.ts so web/kiosk
// bundles that import contracts do not pull in the generator.
import type { z } from 'zod';
import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { CounselingNote, CounselingNoteIdParam, CounselingNoteList, CounselingNotesQuery, CreateCounselingNoteRequest } from './student-affairs/counseling';
import { EarlyWarningList, EarlyWarningsQuery } from './student-affairs/early-warning';
import {
  CompleteFollowupRequest,
  CreatePointThresholdRequest,
  FollowupTask,
  FollowupTaskIdParam,
  FollowupTaskList,
  FollowupTasksQuery,
  PointThreshold,
  PointThresholdIdParam,
  PointThresholdList,
  PointThresholdsQuery,
  UpdatePointThresholdRequest,
} from './student-affairs/followup';
import {
  CreatePointEntryRequest,
  CreatePointEvidenceRequest,
  CreatePointEvidenceResponse,
  CreatePointRuleRequest,
  PointEntry,
  PointEntryIdParam,
  PointEvidenceLink,
  PointRule,
  PointRuleIdParam,
  PointRuleList,
  PointRulesQuery,
  PointStudentList,
  PointStudentParam,
  PointStudentQuery,
  ReversePointEntryRequest,
  StudentPoints,
  UpdatePointRuleRequest,
} from './student-affairs/points';
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
import { ClassStudentHours, ClassStudentHoursParams, ClassStudentHoursQuery } from './attendance/student-hours';
import { SessionDetail, SessionIdParam, SubmitSessionRequest, TodayQuery, TodayResponse } from './attendance/sessions';
import { ErrorBody } from './common';
import { BindCardDeviceRequest, CardDeviceKeys, DeviceIdParam, MyCards } from './gate/cards';
import { Arrival, GateToday, ManualArrivalRequest } from './gate/arrivals';
import { LiaisonMessageParam, LiaisonSettings, LiaisonStudentList, LiaisonStudentParam, LiaisonStudentQuery, LiaisonThread, LiaisonThreadList, PostLiaisonMessageRequest, UpdateLiaisonSettingsRequest } from './portal/liaison';
import { Activity, ActivityIdParam, ActivityList, ActivityMemberList, ActivityRecap, ActivityRecapQuery, ActivityStudentQuery, CreateActivityRequest, OpenActivitySessionRequest, SetActivityMembersRequest, UpdateActivityRequest } from './activity/activities';
import { ClassHabitsParams, ClassHabitsQuery, ClassHabitWeek, HabitDay, HabitJournal, HabitParams, HabitRangeQuery, PutHabitsRequest } from './activity/habits';
import { PKL_NOTE, PKL_PATHS } from './pkl/paths';
import { CreateMemorizationLogRequest, MemorizationLog, MemorizationLogList, MemorizationLogQuery, MemorizationStudentList, MemorizationStudentQuery } from './activity/memorization';
import {
  AddTppkCaseEventRequest,
  CreateTppkCaseRequest,
  CreateTppkReportRequest,
  SetTppkMembersRequest,
  TppkCaseDetail,
  TppkCaseIdParam,
  TppkCaseList,
  TppkCaseNoteRequest,
  TppkCasesQuery,
  TppkChannel,
  TppkCodeParam,
  TppkMemberList,
  TppkReportDetail,
  TppkReportIdParam,
  TppkReportList,
  TppkReportReceipt,
  TppkReportsQuery,
  TppkSchoolParam,
  TppkTrackResponse,
} from './student-affairs/tppk';
import { CreateUksVisitRequest, UksStudentList, UksStudentQuery, UksVisit, UksVisitList, UksVisitsQuery } from './student-affairs/uks';
import { CreateKioskPickupPhotoRequest, KioskUnlistedPickup, KioskUnlistedPickupRequest, LinkHeldPickups, LinkPickupDecisionRequest, PickupEvent, PickupEventActionParam, PickupEventIdParam, PickupEventList, PickupEventsQuery, KioskCheckoutBatch, KioskCheckoutResults, CreatePickupGuardianRequest, CreatePickupPhotoRequest, CreatePickupPhotoResponse, PickupGuardian, PickupGuardianActionParam, PickupGuardianIdParam, PickupGuardianList, PickupGuardiansQuery, PickupPhotoLink } from './gate/pickup';
import { CreateVisitorPhotoRequest, CreateVisitorPhotoResponse, CreateVisitorRequest, Visitor, VisitorPhotoLink, VisitorHostList, VisitorIdParam, VisitorList, VisitorsQuery } from './gate/visitors';
import { NotificationOverview } from './notify/notifications';
import { NotificationPreferences, UpdateNotificationPreferencesRequest } from './notify/preferences';
import { PushConfig, PushStatus, PushSubscribeRequest, PushUnsubscribeRequest } from './push/subscriptions';
import { StudentContacts, StudentIdParam, UpdateStudentContactsRequest } from './academic/contacts';
import { ActionLinkCardRequest, ActionLinkContext, ActionLinkLeave, ActionLinkLeaveRequest, PortalAttendance, PortalAttendanceQuery } from './portal/links';
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
import { MbgDaily, MbgDailyQuery, MbgForecast, MbgForecastQuery, MbgSettings, UpdateMbgSettingsRequest } from './report/mbg';
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
    path: `${API_BASE_PATH}/imports/emis`,
    tags: ['academic'],
    summary: 'Start an EMIS import (madrasah): returns a presigned PUT for the .xlsx (admin, operator)',
    description: 'Needs data.source = emis (AKD-09). Same flow as Dapodik: upload, POST /imports/{importId}/parse, preview, commit. Column layout provisional (TODO(pilot)).',
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
    path: `${API_BASE_PATH}/classes/{classId}/student-hours`,
    tags: ['attendance'],
    summary: "Every lesson of a rombel's students on one day, learning groups included (AKD-10)",
    description: 'For the wali kelas of the rombel and for admin, operator, kepsek, wakasek, piket; others 404. date defaults to today (school timezone). Activity sessions are not included.',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { params: ClassStudentHoursParams, query: ClassStudentHoursQuery },
    responses: { 200: json(ClassStudentHours, 'Sessions and per-student statuses'), ...errors(400, 401, 404) },
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
    description: 'With gate.pickup also the approved penjemput per card, with 5-minute photo links the kiosk downloads at once (GRB-10); pickup is null otherwise.',
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
    path: `${API_BASE_PATH}/kiosk/checkouts`,
    tags: ['kiosk'],
    summary: 'Queued check-outs with a listed penjemput (GRB-10), exactly once per clientEventId',
    description:
      'Requires gate.pickup (404 CAPABILITY_DISABLED otherwise). Results per check-out: released (emits gate.checked_out; parents get student_picked_up), duplicate (the student was already released that day), or rejected with a card reason or not_authorized (the penjemput was never approved for this student). A penjemput deactivated after the morning sync still counts.',
    security: [{ kiosk: [] }],
    parameters: [{ ...idempotencyHeader, required: true }],
    request: { body: { content: { 'application/json': { schema: KioskCheckoutBatch } } } },
    responses: { 200: json(KioskCheckoutResults, 'Results'), ...errors(400, 401, 404) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/kiosk/pickup-photos`,
    tags: ['kiosk'],
    summary: "A presigned PUT for an unlisted penjemput's photo (JPEG, up to 2 MB)",
    description: 'Requires gate.pickup (404 CAPABILITY_DISABLED otherwise).',
    security: [{ kiosk: [] }],
    parameters: [{ ...idempotencyHeader, required: true }],
    request: { body: { content: { 'application/json': { schema: CreateKioskPickupPhotoRequest } } } },
    responses: { 200: json(CreatePickupPhotoResponse, 'Upload'), ...errors(400, 401, 404) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/kiosk/unlisted-pickups`,
    tags: ['kiosk'],
    summary: 'Hold a student for an unlisted penjemput (name + photo required); online only',
    description: 'Requires gate.pickup. Exactly once per clientEventId. Emits gate.unlisted_pickup (parents get unlisted_pickup with an action link). 400 for an unreadable card or a photo not uploaded; 409 already_released when the student left today.',
    security: [{ kiosk: [] }],
    parameters: [{ ...idempotencyHeader, required: true }],
    request: { body: { content: { 'application/json': { schema: KioskUnlistedPickupRequest } } } },
    responses: { 200: json(KioskUnlistedPickup, 'Held'), ...errors(400, 401, 404, 409) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/kiosk/unlisted-pickups/{pickupEventId}`,
    tags: ['kiosk'],
    summary: 'The held request as the kiosk polls it: held, released (allowed), denied or expired',
    description: 'Requires gate.pickup.',
    security: [{ kiosk: [] }],
    request: { params: PickupEventIdParam },
    responses: { 200: json(KioskUnlistedPickup, 'Request'), ...errors(401, 404) },
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
  const pickupNote = 'Requires gate.pickup (404 CAPABILITY_DISABLED otherwise). Callers outside the student (not their parent, wali kelas, or admin) get 404.';
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/pickup-guardian-photos`,
    tags: ['gate'],
    summary: "A presigned PUT for a penjemput's photo (JPEG, up to 2 MB); send photoId with the registration",
    description: pickupNote,
    security: [{ session: [] }],
    parameters: [...gateParams, { ...idempotencyHeader, required: true }],
    request: { body: { content: { 'application/json': { schema: CreatePickupPhotoRequest } } } },
    responses: { 200: json(CreatePickupPhotoResponse, 'Upload'), ...errors(400, 401, 404) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/students/{studentId}/pickup-guardians`,
    tags: ['gate'],
    summary: "The student's penjemput in every status (parent, wali kelas, admin, piket)",
    description: pickupNote,
    security: [{ session: [] }],
    parameters: gateParams,
    request: { params: StudentIdParam },
    responses: { 200: json(PickupGuardianList, 'Penjemput'), ...errors(401, 404) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/students/{studentId}/pickup-guardians`,
    tags: ['gate'],
    summary: 'Register a penjemput resmi (GRB-09): pending from a parent, approved from the wali kelas or admin',
    description: `${pickupNote} At most 6 pending or approved per student (409 too_many). The number is encrypted and masked in responses.`,
    security: [{ session: [] }],
    parameters: [...gateParams, { ...idempotencyHeader, required: true }],
    request: { params: StudentIdParam, body: { content: { 'application/json': { schema: CreatePickupGuardianRequest } } } },
    responses: { 201: json(PickupGuardian, 'Registered'), ...errors(400, 401, 404, 409) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/pickup-guardians`,
    tags: ['gate'],
    summary: 'Penjemput by status, oldest first: the admin sees every student, others their own rombel as wali kelas',
    description: pickupNote,
    security: [{ session: [] }],
    parameters: gateParams,
    request: { query: PickupGuardiansQuery },
    responses: { 200: json(PickupGuardianList, 'Queue'), ...errors(400, 401, 404) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/pickup-guardians/{pickupGuardianId}/{action}`,
    tags: ['gate'],
    summary: 'approve or reject a pending penjemput (wali kelas, admin); deactivate a pending or approved one (also the parent)',
    description: `${pickupNote} Repeating an action changes nothing; any other status change is 409. Audited. The photo is removed 30 days after reject or deactivate.`,
    security: [{ session: [] }],
    parameters: [...gateParams, idempotencyHeader],
    request: { params: PickupGuardianActionParam },
    responses: { 200: json(PickupGuardian, 'Penjemput'), ...errors(401, 404, 409) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/pickup-guardians/{pickupGuardianId}/photo`,
    tags: ['gate'],
    summary: "A 5-minute link to the penjemput's photo (the student's wali kelas, piket, admin; audited)",
    description: pickupNote,
    security: [{ session: [] }],
    parameters: gateParams,
    request: { params: PickupGuardianIdParam },
    responses: { 200: json(PickupPhotoLink, 'Link'), ...errors(401, 404) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/pickups`,
    tags: ['gate'],
    summary: "The day's check-outs, held first (gate viewers: all; a wali kelas: own rombel)",
    description: pickupNote,
    security: [{ session: [] }],
    parameters: gateParams,
    request: { query: PickupEventsQuery },
    responses: { 200: json(PickupEventList, 'Check-outs'), ...errors(400, 401, 404) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/pickups/{pickupEventId}/{action}`,
    tags: ['gate'],
    summary: 'allow or deny a held unlisted penjemput (the student\'s wali kelas, admin)',
    description: `${pickupNote} allow releases the student and emits gate.checked_out. The same decision again changes nothing; 409 otherwise (decided, expired, already released). Audited.`,
    security: [{ session: [] }],
    parameters: [...gateParams, idempotencyHeader],
    request: { params: PickupEventActionParam },
    responses: { 200: json(PickupEvent, 'Check-out'), ...errors(401, 404, 409) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/pickups/{pickupEventId}/photo`,
    tags: ['gate'],
    summary: "A 5-minute link to an unlisted penjemput's photo (wali kelas, piket, admin; audited)",
    description: `${pickupNote} Removed 30 days after the request.`,
    security: [{ session: [] }],
    parameters: gateParams,
    request: { params: PickupEventIdParam },
    responses: { 200: json(PickupPhotoLink, 'Link'), ...errors(401, 404) },
  });
  const uksNote = 'petugas_uks only, behind student.uks (404 CAPABILITY_DISABLED otherwise). Notes are encrypted at rest.';
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/uks/students`,
    tags: ['student-affairs'],
    summary: 'Find an active student by name to record a UKS visit',
    description: uksNote,
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { query: UksStudentQuery },
    responses: { 200: json(UksStudentList, 'Students'), ...errors(400, 401, 403, 404) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/uks/visits`,
    tags: ['student-affairs'],
    summary: 'Record a UKS visit: complaint, action and outcome',
    description: `${uksNote} Outcome dipulangkan emits uks.sent_home: the rest of the day is marked S and the parents are told.`,
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }, idempotencyHeader],
    request: { body: { content: { 'application/json': { schema: CreateUksVisitRequest } } } },
    responses: { 200: json(UksVisit, 'Recorded'), ...errors(400, 401, 403, 404) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/uks/visits`,
    tags: ['student-affairs'],
    summary: "The day's UKS visits, newest first",
    description: uksNote,
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { query: UksVisitsQuery },
    responses: { 200: json(UksVisitList, 'Visits'), ...errors(400, 401, 403, 404) },
  });
  const pointNote = 'Behind student.points (404 CAPABILITY_DISABLED otherwise). Pelanggaran are negative points, prestasi positive; rules are switched off, never deleted.';
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/point-rules`,
    tags: ['student-affairs'],
    summary: 'Point rules (KSW-01): active ones, all=true adds switched-off ones for admin and wakasek',
    description: `${pointNote} Read: admin, kepsek, wakasek, wali kelas, guru.`,
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { query: PointRulesQuery },
    responses: { 200: json(PointRuleList, 'Rules'), ...errors(400, 401, 403, 404) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/point-rules`,
    tags: ['student-affairs'],
    summary: 'Create a point rule (admin, wakasek)',
    description: `${pointNote} 409 when the name is taken.`,
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }, idempotencyHeader],
    request: { body: { content: { 'application/json': { schema: CreatePointRuleRequest } } } },
    responses: { 201: json(PointRule, 'Created'), ...errors(400, 401, 403, 404, 409) },
  });
  registry.registerPath({
    method: 'put',
    path: `${API_BASE_PATH}/point-rules/{ruleId}`,
    tags: ['student-affairs'],
    summary: 'Edit or switch off a point rule (admin, wakasek)',
    description: `${pointNote} The kind cannot change; new points keep its sign.`,
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }, idempotencyHeader],
    request: { params: PointRuleIdParam, body: { content: { 'application/json': { schema: UpdatePointRuleRequest } } } },
    responses: { 200: json(PointRule, 'Updated'), ...errors(400, 401, 403, 404, 409) },
  });
  const entryNote = `${pointNote} Entries are insert-only: a mistake is undone by a reversing entry. The note is encrypted and never audited.`;
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/point-entries/students`,
    tags: ['student-affairs'],
    summary: 'Find an active student by name to record a point entry (admin, wakasek, wali kelas, guru)',
    description: `${entryNote} At most 20, by name; the student registry itself is closed to teachers.`,
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { query: PointStudentQuery },
    responses: { 200: json(PointStudentList, 'Students'), ...errors(400, 401, 403, 404) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/point-entries/evidence`,
    tags: ['student-affairs'],
    summary: 'Presigned PUT for the evidence of a point entry (admin, wakasek, wali kelas, guru)',
    description: `${entryNote} Photo or PDF up to 5 MB, stored under schools/{id}/ksw/{uuid}.`,
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }, idempotencyHeader],
    request: { body: { content: { 'application/json': { schema: CreatePointEvidenceRequest } } } },
    responses: { 201: json(CreatePointEvidenceResponse, 'Upload target'), ...errors(400, 401, 403, 404) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/point-entries`,
    tags: ['student-affairs'],
    summary: 'Record a pelanggaran or prestasi (admin, wakasek, wali kelas, guru)',
    description: `${entryNote} The rule must be active (409 rule_inactive); the date is today or up to 30 days back; the student must be active.`,
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }, idempotencyHeader],
    request: { body: { content: { 'application/json': { schema: CreatePointEntryRequest } } } },
    responses: { 201: json(PointEntry, 'Recorded'), ...errors(400, 401, 403, 404, 409) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/point-entries/{entryId}/reverse`,
    tags: ['student-affairs'],
    summary: 'Reverse a point entry with an opposite entry (admin, wakasek)',
    description: `${entryNote} 409 already_reversed or is_reversal.`,
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }, idempotencyHeader],
    request: { params: PointEntryIdParam, body: { content: { 'application/json': { schema: ReversePointEntryRequest } } } },
    responses: { 201: json(PointEntry, 'Reversing entry'), ...errors(400, 401, 403, 404, 409) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/point-entries/{entryId}/evidence`,
    tags: ['student-affairs'],
    summary: 'A 5-minute link to the evidence (admin, kepsek, wakasek, the wali kelas of the class)',
    description: entryNote,
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { params: PointEntryIdParam },
    responses: { 200: json(PointEvidenceLink, 'Link'), ...errors(400, 401, 403, 404) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/students/{enrollmentId}/points`,
    tags: ['student-affairs'],
    summary: 'Net points and entries of a student (admin, kepsek, wakasek, the wali kelas of the class)',
    description: `${entryNote} 404 for a wali kelas of another class.`,
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { params: PointStudentParam },
    responses: { 200: json(StudentPoints, 'Totals and entries'), ...errors(400, 401, 403, 404) },
  });
  const tierNote = `${pointNote} Tiers sit on the net pelanggaran points of a student's year; crossing one makes a follow-up task (once per student per tier) and, when the tier asks for it, a generic WhatsApp to the parents. Tiers are switched off, never deleted.`;
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/point-thresholds`,
    tags: ['student-affairs'],
    summary: 'Point thresholds (KSW-03): active ones, all=true adds switched-off ones for admin and wakasek',
    description: `${tierNote} Read: admin, kepsek, wakasek, wali kelas, guru BK.`,
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { query: PointThresholdsQuery },
    responses: { 200: json(PointThresholdList, 'Tiers'), ...errors(400, 401, 403, 404) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/point-thresholds`,
    tags: ['student-affairs'],
    summary: 'Create a point threshold (admin, wakasek)',
    description: `${tierNote} 409 when a tier with those points exists.`,
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }, idempotencyHeader],
    request: { body: { content: { 'application/json': { schema: CreatePointThresholdRequest } } } },
    responses: { 201: json(PointThreshold, 'Created'), ...errors(400, 401, 403, 404, 409) },
  });
  registry.registerPath({
    method: 'put',
    path: `${API_BASE_PATH}/point-thresholds/{thresholdId}`,
    tags: ['student-affairs'],
    summary: 'Edit or switch off a point threshold (admin, wakasek)',
    description: `${tierNote} A change applies to entries recorded afterwards; existing tasks keep their copy.`,
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }, idempotencyHeader],
    request: { params: PointThresholdIdParam, body: { content: { 'application/json': { schema: UpdatePointThresholdRequest } } } },
    responses: { 200: json(PointThreshold, 'Updated'), ...errors(400, 401, 403, 404, 409) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/followup-tasks`,
    tags: ['student-affairs'],
    summary: 'Follow-up tasks (KSW-03): admin, kepsek, wakasek and guru BK see all; a wali kelas the tasks of their class',
    description: `${tierNote} The completion note is encrypted.`,
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { query: FollowupTasksQuery },
    responses: { 200: json(FollowupTaskList, 'Tasks'), ...errors(400, 401, 403, 404) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/followup-tasks/{taskId}/complete`,
    tags: ['student-affairs'],
    summary: 'Close a follow-up task (admin, wakasek, guru BK, the wali kelas of the class)',
    description: `${tierNote} 409 already_done.`,
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }, idempotencyHeader],
    request: { params: FollowupTaskIdParam, body: { content: { 'application/json': { schema: CompleteFollowupRequest } } } },
    responses: { 200: json(FollowupTask, 'Closed'), ...errors(400, 401, 403, 404, 409) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/early-warnings`,
    tags: ['student-affairs'],
    summary: 'Early warnings (KSW-04): admin, kepsek, wakasek and guru BK see all; a wali kelas the warnings of their class',
    description:
      'Behind student.early_warning (404 CAPABILITY_DISABLED otherwise). Raised by the job ksw.early-warning after 18.00 on the school clock: consecutive alpa, repeated late, bolos jam (when attendance is per jam pelajaran) and PKL absence (when PKL is on). The same kind for a student is not repeated within 7 days. Newest first over the last `days` days (default 14).',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { query: EarlyWarningsQuery },
    responses: { 200: json(EarlyWarningList, 'Warnings'), ...errors(400, 401, 403, 404) },
  });
  const bkNote =
    'Behind student.counseling (404 CAPABILITY_DISABLED otherwise). BK notes are the most private data of the school: only guru BK and admin read them, only guru BK write, and the database enforces it (RLS). The note is encrypted and never appears in the audit log; reads are audited.';
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/counseling-notes`,
    tags: ['student-affairs'],
    summary: 'Write a BK note (guru BK)',
    description: `${bkNote} Date defaults to today, never in the future. followUp none (default) or planned, with an optional followUpOn.`,
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }, idempotencyHeader],
    request: { body: { content: { 'application/json': { schema: CreateCounselingNoteRequest } } } },
    responses: { 201: json(CounselingNote, 'Recorded'), ...errors(400, 401, 403, 404) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/counseling-notes`,
    tags: ['student-affairs'],
    summary: 'BK notes, optionally of one student or one follow-up status (guru BK, admin)',
    description: `${bkNote} Newest first, at most 200. 403 for every other role, the wali kelas included.`,
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { query: CounselingNotesQuery },
    responses: { 200: json(CounselingNoteList, 'Notes'), ...errors(400, 401, 403, 404) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/counseling-notes/{noteId}/complete`,
    tags: ['student-affairs'],
    summary: 'Mark a planned follow-up as done (guru BK)',
    description: `${bkNote} 409 not_planned when the follow-up is not planned.`,
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }, idempotencyHeader],
    request: { params: CounselingNoteIdParam },
    responses: { 200: json(CounselingNote, 'Done'), ...errors(400, 401, 403, 404, 409) },
  });
  const activityNote = 'Kegiatan (KEG-01) of the active academic year. Managers (admin, wakasek) create and edit; admin, operator, wakasek and kepsek see all; a coach (pembina) sees and manages the members of their own activities (404 for others).';
  const activityBody = (schema: z.ZodType) => ({ body: { content: { 'application/json': { schema } } } });
  const activityPaths: { method: 'get' | 'post' | 'patch' | 'put'; path: string; summary: string; request?: object; ok: z.ZodType; label: string; write?: boolean }[] = [
    { method: 'get', path: '/activities', summary: 'Activities the user may see', ok: ActivityList, label: 'Activities' },
    { method: 'post', path: '/activities', summary: 'Create an activity with its coaches (admin, wakasek)', request: activityBody(CreateActivityRequest), ok: Activity, label: 'Created', write: true },
    { method: 'get', path: '/activities/students', summary: 'Find active students to add as members', request: { query: ActivityStudentQuery }, ok: ActivityMemberList, label: 'Students' },
    { method: 'get', path: '/activities/{activityId}', summary: 'One activity', request: { params: ActivityIdParam }, ok: Activity, label: 'Activity' },
    { method: 'patch', path: '/activities/{activityId}', summary: 'Edit an activity, its coaches or deactivate it (admin, wakasek)', request: { params: ActivityIdParam, ...activityBody(UpdateActivityRequest) }, ok: Activity, label: 'Updated', write: true },
    { method: 'get', path: '/activities/{activityId}/members', summary: 'Members of an activity', request: { params: ActivityIdParam }, ok: ActivityMemberList, label: 'Members' },
    { method: 'put', path: '/activities/{activityId}/members', summary: 'Replace the members (managers or the coaches)', request: { params: ActivityIdParam, ...activityBody(SetActivityMembersRequest) }, ok: ActivityMemberList, label: 'Members', write: true },
    { method: 'post', path: '/activities/{activityId}/sessions', summary: 'Open (or get) the activity session of a date, default today; fill it with POST /sessions/{id}/submit', request: { params: ActivityIdParam, ...activityBody(OpenActivitySessionRequest) }, ok: SessionDetail, label: 'Session' },
    { method: 'get', path: '/activities/{activityId}/recap', summary: 'Rekap kegiatan per member (separate from the rombel rekap)', request: { params: ActivityIdParam, query: ActivityRecapQuery }, ok: ActivityRecap, label: 'Recap' },
  ];
  for (const p of activityPaths) {
    registry.registerPath({
      method: p.method,
      path: `${API_BASE_PATH}${p.path}`,
      tags: ['activity'],
      summary: p.summary,
      description: activityNote,
      security: [{ session: [] }],
      parameters: p.write ? [{ ...schoolHeader, required: true }, idempotencyHeader] : [{ ...schoolHeader, required: true }],
      ...(p.request ? { request: p.request } : {}),
      responses: { 200: json(p.ok, p.label), ...errors(...(p.write ? [400, 401, 403, 404, 409] : [400, 401, 403, 404])) },
    });
  }
  const habitNote = 'Jurnal 7 KAIH (KEG-02): requires habits.kaih parent or student (404 CAPABILITY_DISABLED when off). Readers: the student, their parents, their wali kelas, admin/operator/wakasek/kepsek; others 404.';
  for (const p of [
    { method: 'get' as const, path: '/habits/{studentId}', summary: 'The journal of a student, one entry per day (default the last 7, at most 31), newest first', request: { params: StudentIdParam, query: HabitRangeQuery }, ok: HabitJournal, label: 'Journal' },
    {
      method: 'put' as const,
      path: '/habits/{studentId}/{date}',
      summary: 'Tick habits of a day: the parent in mode parent, the student in mode student (409 not_filler otherwise)',
      request: { params: HabitParams, body: { content: { 'application/json': { schema: PutHabitsRequest } } } },
      ok: HabitDay,
      label: 'Day',
      write: true,
    },
    { method: 'get' as const, path: '/classes/{classId}/habits', summary: 'Weekly summary per student of a rombel (its wali kelas and the school leaders)', request: { params: ClassHabitsParams, query: ClassHabitsQuery }, ok: ClassHabitWeek, label: 'Week' },
  ]) {
    registry.registerPath({
      method: p.method,
      path: `${API_BASE_PATH}${p.path}`,
      tags: ['activity'],
      summary: p.summary,
      description: 'write' in p ? `${habitNote} Today and the 2 days before only; older dates are locked (409 locked; job keg.lock-habits 00.30). Habits not sent stay as they are.` : habitNote,
      security: [{ session: [] }],
      parameters: 'write' in p ? [{ ...schoolHeader, required: true }, idempotencyHeader] : [{ ...schoolHeader, required: true }],
      request: p.request,
      responses: { 200: json(p.ok, p.label), ...errors(...('write' in p ? [400, 401, 404, 409] : [400, 401, 404])) },
    });
  }
  const hafalanNote = 'Setoran hafalan (KEG-03): requires religious.memorization (404 CAPABILITY_DISABLED when off). Writers: guru_tahfidz and admin (403 for others).';
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/memorization-logs`,
    tags: ['activity'],
    summary: 'Record a setoran hafalan (surah, ayat range, optional juz, nilai 0-100, catatan); the caller is the penyimak',
    description: `${hafalanNote} Date defaults to today (school timezone), never in the future; the ayat range is checked against the surah. 409 not_active for a student without an active enrollment.`,
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }, idempotencyHeader],
    request: { body: { content: { 'application/json': { schema: CreateMemorizationLogRequest } } } },
    responses: { 201: json(MemorizationLog, 'Recorded'), ...errors(400, 401, 403, 404, 409) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/memorization-logs`,
    tags: ['activity'],
    summary: 'Hafalan history of a student, newest first (at most 200)',
    description: `${hafalanNote} Readers: the student, their parents, their wali kelas, admin/operator/wakasek/kepsek and the writers; others 404.`,
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { query: MemorizationLogQuery },
    responses: { 200: json(MemorizationLogList, 'History'), ...errors(400, 401, 404) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/memorization-logs/students`,
    tags: ['activity'],
    summary: 'Active students by name (2+ letters, at most 20), for the writers',
    description: hafalanNote,
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { query: MemorizationStudentQuery },
    responses: { 200: json(MemorizationStudentList, 'Students'), ...errors(400, 401, 403, 404) },
  });
  for (const p of PKL_PATHS) {
    const req = p.request;
    const headers = p.write ? [{ ...schoolHeader, required: true }, idempotencyHeader] : [{ ...schoolHeader, required: true }];
    registry.registerPath({
      method: p.method,
      path: `${API_BASE_PATH}${p.path}`,
      tags: ['pkl'],
      summary: p.summary,
      description: p.description ? `${PKL_NOTE} ${p.description}` : PKL_NOTE,
      security: [{ session: [] }],
      parameters: headers,
      ...(req
        ? {
            request: {
              ...(req.params ? { params: req.params } : {}),
              ...(req.query ? { query: req.query } : {}),
              ...(req.body ? { body: { content: { 'application/json': { schema: req.body } } } } : {}),
            },
          }
        : {}),
      responses: { ...(p.ok ? { [p.status ?? 200]: json(p.ok, p.label) } : { 204: { description: p.label } }), ...errors(...(p.write ? [400, 401, 403, 404, 409] : [400, 401, 403, 404])) },
    });
  }
  const liaisonNote = 'Buku penghubung (ORT-07, capability portal.liaison). Participants: guardians (orang_tua), the wali kelas and guru mapel of the student this year; others 404. The admin reads every thread, retracted messages included (audited), and cannot write. The sender may retract within 15 minutes.';
  const liaisonPaths: { method: 'get' | 'post' | 'put'; path: string; summary: string; request?: object; ok?: z.ZodType; label: string; write?: boolean }[] = [
    { method: 'get', path: '/liaison/threads', summary: 'Threads of the user (orang_tua: every child; staff: students they teach; admin: all)', ok: LiaisonThreadList, label: 'Threads' },
    { method: 'get', path: '/liaison/students', summary: 'Students the user teaches this year, to start a thread (2+ letters)', request: { query: LiaisonStudentQuery }, ok: LiaisonStudentList, label: 'Students' },
    { method: 'get', path: '/liaison/students/{studentId}', summary: 'The thread of a student', request: { params: LiaisonStudentParam }, ok: LiaisonThread, label: 'Thread' },
    { method: 'post', path: '/liaison/students/{studentId}/messages', summary: 'Write a message (participants)', request: { params: LiaisonStudentParam, body: { content: { 'application/json': { schema: PostLiaisonMessageRequest } } } }, ok: LiaisonThread, label: 'Thread', write: true },
    { method: 'post', path: '/liaison/students/{studentId}/read', summary: 'Mark the thread read up to now', request: { params: LiaisonStudentParam }, label: 'Read' },
    { method: 'get', path: '/liaison/settings', summary: 'Service hours (WhatsApp notifications outside them wait)', ok: LiaisonSettings, label: 'Settings' },
    { method: 'put', path: '/liaison/settings', summary: 'Set the service hours (admin)', request: { body: { content: { 'application/json': { schema: UpdateLiaisonSettingsRequest } } } }, ok: LiaisonSettings, label: 'Settings', write: true },
    { method: 'post', path: '/liaison/messages/{messageId}/retract', summary: 'Retract an own message within 15 minutes', request: { params: LiaisonMessageParam }, ok: LiaisonThread, label: 'Thread', write: true },
  ];
  for (const p of liaisonPaths) {
    registry.registerPath({
      method: p.method,
      path: `${API_BASE_PATH}${p.path}`,
      tags: ['portal'],
      summary: p.summary,
      description: liaisonNote,
      security: [{ session: [] }],
      parameters: p.write ? [{ ...schoolHeader, required: true }, idempotencyHeader] : [{ ...schoolHeader, required: true }],
      ...(p.request ? { request: p.request } : {}),
      responses: { ...(p.ok ? { 200: json(p.ok, p.label) } : { 204: { description: p.label } }), ...errors(...(p.write ? [400, 401, 403, 404, 409] : [400, 401, 403, 404])) },
    });
  }
  const tppkNote = 'Behind student.tppk (404 CAPABILITY_DISABLED otherwise). Reports and cases are readable only by TPPK members (RLS), never by the admin or kepsek through their role.';
  const tppkPublic = 'Public, no login. Rate limited per client in memory (429 RATE_LIMITED); the IP is never stored or logged.';
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/tppk/channel/{schoolId}`,
    tags: ['student-affairs'],
    summary: 'The school a report form is for (public, from the QR poster)',
    description: `${tppkPublic} 404 when the school is unknown or student.tppk is off (same answer).`,
    request: { params: TppkSchoolParam },
    responses: { 200: json(TppkChannel, 'Channel open'), ...errors(400, 404, 429) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/tppk/reports`,
    tags: ['student-affairs'],
    summary: 'File a report to the TPPK (public; anonymous allowed)',
    description: `${tppkPublic} The tracking code is returned once; only its keyed hash is kept. A named report from a signed-in user keeps the account; an anonymous one keeps nothing about the reporter. Only TPPK members are told (tppk.report_received).`,
    request: { body: { content: { 'application/json': { schema: CreateTppkReportRequest } } } },
    responses: { 201: json(TppkReportReceipt, 'Received'), ...errors(400, 404, 429) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/tppk/reports/track/{code}`,
    tags: ['student-affairs'],
    summary: 'Status of a report by its tracking code (public)',
    description: `${tppkPublic} Unknown and malformed codes get the same 404. The code is masked in request logs.`,
    request: { params: TppkCodeParam },
    responses: { 200: json(TppkTrackResponse, 'Status'), ...errors(404, 429) },
  });
  const tppkMembers = `${tppkNote} TPPK members only (403 for anyone else, admin and kepsek included). Every call writes an audit entry (ids and statuses, never the text).`;
  const tppkHeaders = [{ ...schoolHeader, required: true }];
  const tppkWrite = [{ ...schoolHeader, required: true }, idempotencyHeader];
  const tppkPaths: { method: 'get' | 'post'; path: string; summary: string; request?: object; ok: z.ZodType; label: string; write?: boolean }[] = [
    { method: 'get', path: '/tppk/reports', summary: 'Reports received, newest first', request: { query: TppkReportsQuery }, ok: TppkReportList, label: 'Reports' },
    { method: 'get', path: '/tppk/reports/{reportId}', summary: 'One report with the chronology and, when named, the reporter', request: { params: TppkReportIdParam }, ok: TppkReportDetail, label: 'Report' },
    { method: 'get', path: '/tppk/cases', summary: 'Cases, newest first', request: { query: TppkCasesQuery }, ok: TppkCaseList, label: 'Cases' },
    { method: 'post', path: '/tppk/cases', summary: 'Open a case (from a report: it becomes ditangani; one case per report)', request: { body: { content: { 'application/json': { schema: CreateTppkCaseRequest } } } }, ok: TppkCaseDetail, label: 'Case', write: true },
    { method: 'get', path: '/tppk/cases/{caseId}', summary: 'A case with its report and every event', request: { params: TppkCaseIdParam }, ok: TppkCaseDetail, label: 'Case' },
    { method: 'post', path: '/tppk/cases/{caseId}/events', summary: 'Add a note or a step to an open case', request: { params: TppkCaseIdParam, body: { content: { 'application/json': { schema: AddTppkCaseEventRequest } } } }, ok: TppkCaseDetail, label: 'Case', write: true },
    { method: 'post', path: '/tppk/cases/{caseId}/close', summary: 'Close a case (the report becomes selesai)', request: { params: TppkCaseIdParam, body: { content: { 'application/json': { schema: TppkCaseNoteRequest } } } }, ok: TppkCaseDetail, label: 'Case', write: true },
    { method: 'post', path: '/tppk/cases/{caseId}/reopen', summary: 'Reopen a closed case (the report is ditangani again)', request: { params: TppkCaseIdParam, body: { content: { 'application/json': { schema: TppkCaseNoteRequest } } } }, ok: TppkCaseDetail, label: 'Case', write: true },
  ];
  for (const p of tppkPaths) {
    registry.registerPath({
      method: p.method,
      path: `${API_BASE_PATH}${p.path}`,
      tags: ['student-affairs'],
      summary: p.summary,
      description: tppkMembers,
      security: [{ session: [] }],
      parameters: p.write ? tppkWrite : tppkHeaders,
      ...(p.request ? { request: p.request } : {}),
      responses: { 200: json(p.ok, p.label), ...errors(...(p.write ? [400, 401, 403, 404, 409] : [400, 401, 403, 404])) },
    });
  }
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/tppk/members`,
    tags: ['student-affairs'],
    summary: 'The TPPK team of the school (any staff member)',
    description: `${tppkNote} belowMinimum is true with fewer than 3 members.`,
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    responses: { 200: json(TppkMemberList, 'Team'), ...errors(401, 403, 404) },
  });
  registry.registerPath({
    method: 'put',
    path: `${API_BASE_PATH}/tppk/members`,
    tags: ['student-affairs'],
    summary: 'Replace the TPPK team (admin)',
    description: `${tppkNote} Members must be active staff. Audited as tppk.members_changed and the whole team is told.`,
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }, idempotencyHeader],
    request: { body: { content: { 'application/json': { schema: SetTppkMembersRequest } } } },
    responses: { 200: json(TppkMemberList, 'Team'), ...errors(400, 401, 403, 404) },
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
    summary: "PWA: the siswa's own attendance or the orang tua's children's, today and the last 30 days (up to 180 with `days`)",
    description: '`studentId` narrows to one child; an id that is not the caller\'s child gives an empty list, never another family\'s data.',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { query: PortalAttendanceQuery },
    responses: { 200: json(PortalAttendance, 'History'), ...errors(400, 401, 403) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/portal/notification-preferences`,
    tags: ['portal'],
    summary: "PWA: the orang tua's own WhatsApp message choices at this school (ORT-06)",
    description: 'No stored choice means the defaults: every message, outside the quiet hours. 403 for anyone but an orang tua.',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    responses: { 200: json(NotificationPreferences, 'Preferences'), ...errors(401, 403, 404) },
  });
  registry.registerPath({
    method: 'put',
    path: `${API_BASE_PATH}/portal/notification-preferences`,
    tags: ['portal'],
    summary: 'PWA: switch message types off and hold late messages (ORT-06)',
    description:
      'Replaces the choices. Only absent_marked, leave_approved, leave_rejected, student_sent_home, student_picked_up and liaison_message can be switched off; safety messages always arrive. noLateMessages holds anything created after 19.00 school time until 06.00.',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }, idempotencyHeader],
    request: { body: { content: { 'application/json': { schema: UpdateNotificationPreferencesRequest } } } },
    responses: { 200: json(NotificationPreferences, 'Preferences'), ...errors(400, 401, 403, 404, 422) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/push/config`,
    tags: ['push'],
    summary: 'The public VAPID key a browser subscribes with (NTF-06); publicKey null = push is off on this server',
    security: [{ session: [] }],
    responses: { 200: json(PushConfig, 'Config'), ...errors(401) },
  });
  registry.registerPath({
    method: 'put',
    path: `${API_BASE_PATH}/push/subscriptions`,
    tags: ['push'],
    summary: 'Staff: this browser receives Web Push for the active school (NTF-06)',
    description: 'The same endpoint again refreshes its keys. At most 10 devices per member and school; the oldest are dropped. 404 when push is off, 403 for parents, siswa and industry supervisors.',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }, idempotencyHeader],
    request: { body: { content: { 'application/json': { schema: PushSubscribeRequest } } } },
    responses: { 200: json(PushStatus, 'Devices'), ...errors(400, 401, 403, 404, 422) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/push/subscriptions/remove`,
    tags: ['push'],
    summary: 'Staff: this browser stops receiving Web Push for the active school',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }, idempotencyHeader],
    request: { body: { content: { 'application/json': { schema: PushUnsubscribeRequest } } } },
    responses: { 200: json(PushStatus, 'Devices'), ...errors(400, 401, 403, 404, 422) },
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
    description: 'Target from report.target (e-Rapor or RDM). stream limits a whole-year file to one jurusan. 409 release_flag_off for RDM until the Absah team enables rdm-export-beta for the madrasah.',
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
    method: 'get',
    path: `${API_BASE_PATH}/mbg/forecast`,
    tags: ['report'],
    summary: 'Prakiraan MBG H-3 (RKP-09): stored at 13.00 three days before; default date is three days from today',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: { query: MbgForecastQuery },
    responses: { 200: json(MbgForecast, 'Forecast'), ...errors(400, 401, 403, 404) },
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
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/links/pickups/{pickupEventId}`,
    tags: ['portal'],
    summary: 'Action link: allow or deny an unlisted penjemput the kiosk holds for the student today (GRB-10)',
    description: 'Not the link\'s one write. The same decision again changes nothing; 409 when already decided otherwise, expired, or the student left with someone else. Audited.',
    security: [{ actionLink: [] }],
    request: { params: PickupEventIdParam, body: { content: { 'application/json': { schema: LinkPickupDecisionRequest } } } },
    responses: { 200: json(LinkHeldPickups, "Today's requests"), ...errors(400, 401, 404, 409, 410) },
  });
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/links/pickups/{pickupEventId}/photo`,
    tags: ['portal'],
    summary: "Action link: a 5-minute link to the unlisted penjemput's photo (audited)",
    security: [{ actionLink: [] }],
    request: { params: PickupEventIdParam },
    responses: { 200: json(PickupPhotoLink, 'Link'), ...errors(401, 404, 410) },
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
  429: 'Too many requests from this client (RATE_LIMITED)',
};

export function generateOpenApiDocument(version = '0.0.0') {
  const generator = new OpenApiGeneratorV31(buildRegistry().definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: { title: 'Absah API', version },
    servers: [{ url: '/' }],
  });
}
