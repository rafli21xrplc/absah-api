import type { z } from 'zod';
import { PklCheckin, PklCheckinBody, PklToday } from './checkins';
import {
  CreatePklAttachmentRequest,
  CreatePklAttachmentResponse,
  PklAttachmentLink,
  PklJournal,
  PklJournalIdParam,
  PklJournalList,
  PklJournalQuery,
  ReviewPklJournalRequest,
  WritePklJournalRequest,
} from './journals';
import { PklAssessmentAspectList, PklAssessmentForm, PklAssessmentList, SavePklAspectsRequest, SavePklAssessmentRequest } from './assessment';
import { DecidePklDayRequest, PklDayDecision, PklReviewList, PklSessionIdParam } from './reviews';
import { ConfirmPklCheckinsRequest, DisputePklCheckinRequest, PklCheckinIdParam, PklSupervisionDay, PklSupervisionQuery } from './supervision';
import { CreatePklPlacementsRequest, PklPlacement, PklPlacementIdParam, PklPlacementList, PklPlacementQuery, UpdatePklPlacementRequest } from './placements';
import { CreateDudiPartnerRequest, DudiPartner, DudiPartnerIdParam, DudiPartnerList, PklStaffList, PklStudentList, PklStudentQuery, UpdateDudiPartnerRequest } from './partners';

/** PKL endpoints for the OpenAPI document (registered by openapi.ts), all behind pkl.enabled. */
export interface PklPath {
  method: 'get' | 'post' | 'patch' | 'put';
  path: string;
  summary: string;
  description?: string;
  request?: { params?: z.ZodObject; query?: z.ZodObject; body?: z.ZodType };
  ok?: z.ZodType;
  label: string;
  /** Write endpoint: Idempotency-Key header, 409 possible. */
  write?: true;
  /** Success status, default 200. */
  status?: 201 | 202;
}

export const PKL_NOTE =
  'PKL (SMK): requires pkl.enabled (404 CAPABILITY_DISABLED when off). Managers: admin, wakasek, humas_pkl; kepsek also reads.';

export const PKL_PATHS: PklPath[] = [
  {
    method: 'get',
    path: '/pkl/assessment-aspects',
    summary: 'Aspects of the DUDI assessment (PKL-04) in form order: managers, kepsek, guru pembimbing and pembimbing industri',
    ok: PklAssessmentAspectList,
    label: 'Aspects',
  },
  {
    method: 'put',
    path: '/pkl/assessment-aspects',
    summary: 'Set the aspects of the DUDI assessment: the whole list in form order (managers)',
    description: 'An item with an id edits that aspect, one without adds one, an existing aspect left out is retired; assessments already given keep their own copy.',
    request: { body: SavePklAspectsRequest },
    ok: PklAssessmentAspectList,
    label: 'Saved',
    write: true,
  },
  {
    method: 'get',
    path: '/pkl/assessments',
    summary: 'DUDI assessments: a pembimbing industri their students, a guru pembimbing theirs, managers and kepsek all (PKL-04)',
    ok: PklAssessmentList,
    label: 'Assessments',
  },
  {
    method: 'get',
    path: '/pkl/placements/{placementId}/assessment',
    summary: "One placement's assessment with the aspects the form asks for now (404 outside the caller's students)",
    request: { params: PklPlacementIdParam },
    ok: PklAssessmentForm,
    label: 'Form',
  },
  {
    method: 'put',
    path: '/pkl/placements/{placementId}/assessment',
    summary: 'Give or correct the assessment: one score 0-100 per current aspect (pembimbing industri of the placement)',
    description: '409 window_not_open before 14 days ahead of the end, window_closed 30 days after it, no_aspects until the school set aspects, placement_cancelled. Every current aspect needs a score; the weighted average is kept.',
    request: { params: PklPlacementIdParam, body: SavePklAssessmentRequest },
    ok: PklAssessmentForm,
    label: 'Saved',
    write: true,
  },
  { method: 'get', path: '/pkl/partners', summary: 'DUDI partners with working hours (managers, kepsek)', ok: DudiPartnerList, label: 'Partners' },
  { method: 'post', path: '/pkl/partners', summary: 'Add a DUDI partner (radius default 150 m)', request: { body: CreateDudiPartnerRequest }, ok: DudiPartner, label: 'Created', write: true, status: 201 },
  {
    method: 'patch',
    path: '/pkl/partners/{partnerId}',
    summary: 'Edit a DUDI partner; workHours replaces every day',
    request: { params: DudiPartnerIdParam, body: UpdateDudiPartnerRequest },
    ok: DudiPartner,
    label: 'Updated',
    write: true,
  },
  { method: 'get', path: '/pkl/students', summary: 'Active students by name or NISN (2+ characters, at most 20), for placements', request: { query: PklStudentQuery }, ok: PklStudentList, label: 'Students' },
  { method: 'get', path: '/pkl/school-mentors', summary: 'Active school staff who can be guru pembimbing', ok: PklStaffList, label: 'Staff' },
  {
    method: 'get',
    path: '/pkl/placements',
    summary: 'Placements: managers all, a guru pembimbing their own (scope current by default)',
    request: { query: PklPlacementQuery },
    ok: PklPlacementList,
    label: 'Placements',
  },
  {
    method: 'post',
    path: '/pkl/placements',
    summary: 'Place students at one DUDI with one period and supervisors',
    description:
      'The industry supervisor gets an active pembimbing_industri membership (no invitation: the WhatsApp OTP is the proof) and a WhatsApp with the /dudi link (pkl.mentor_assigned). 409 overlap (details.enrollmentIds), partner_inactive, phone_student.',
    request: { body: CreatePklPlacementsRequest },
    ok: PklPlacementList,
    label: 'Created',
    write: true,
    status: 201,
  },
  {
    method: 'patch',
    path: '/pkl/placements/{placementId}',
    summary: 'Change the end date or the supervisors; industryMentor null removes them',
    description: 'An industry supervisor without any running placement left is suspended at once (job pkl.expire-mentors does the same daily).',
    request: { params: PklPlacementIdParam, body: UpdatePklPlacementRequest },
    ok: PklPlacement,
    label: 'Updated',
    write: true,
  },
  { method: 'post', path: '/pkl/placements/{placementId}/cancel', summary: 'Cancel a placement (again = no-op)', request: { params: PklPlacementIdParam }, ok: PklPlacement, label: 'Cancelled', write: true },
  { method: 'get', path: '/pkl/me', summary: "The student's placement today and today's check-in/out (siswa)", ok: PklToday, label: 'Today' },
  {
    method: 'post',
    path: '/pkl/checkins',
    summary: 'Check in or out at the DUDI (siswa); Idempotency-Key required',
    description:
      'Distance (haversine) to the DUDI, working hours and device clock (> 10 min = review) decide: pending (industry supervisor confirms) or needs_review (guru pembimbing decides). The point is stored rounded to 4 decimals. 409 no_placement, already_recorded.',
    request: { body: PklCheckinBody },
    ok: PklCheckin,
    label: 'Recorded',
    write: true,
    status: 201,
  },
  {
    method: 'get',
    path: '/pkl/supervision',
    summary: "The industry supervisor's students on a date (default today): statuses only, never coordinates (pembimbing_industri)",
    request: { query: PklSupervisionQuery },
    ok: PklSupervisionDay,
    label: 'Day',
  },
  {
    method: 'post',
    path: '/pkl/checkins/confirm',
    summary: 'One click: confirm every pending check-in of their students that day, or the listed ones (pembimbing_industri)',
    description: 'Writes H (T after opening time) with source pkl_confirm. Ids of another supervisor\'s students: 404, nothing written. Job pkl.auto-confirm confirms check-ins pending for 24 hours.',
    request: { body: ConfirmPklCheckinsRequest },
    ok: PklSupervisionDay,
    label: 'Day',
    write: true,
  },
  {
    method: 'post',
    path: '/pkl/checkins/{checkinId}/dispute',
    summary: 'Dispute a pending check-in; the guru pembimbing decides (pembimbing_industri)',
    description: '409 not_pending once confirmed or in review.',
    request: { params: PklCheckinIdParam, body: DisputePklCheckinRequest },
    ok: PklSupervisionDay,
    label: 'Day',
    write: true,
  },
  {
    method: 'get',
    path: '/pkl/reviews',
    summary: "The guru pembimbing's open queue: check-ins in review or disputed, past work days without check-in (managers: all)",
    ok: PklReviewList,
    label: 'Queue',
  },
  {
    method: 'post',
    path: '/pkl/days/{sessionId}/decide',
    summary: "Decide a PKL day's status (the placement's guru pembimbing or a manager); deciding again replaces it",
    description: 'Writes source pkl_confirm (izin and corrections still outrank it). 409 pending_industry or confirmed when the industry supervisor has the check-in; a future day 400; others 404.',
    request: { params: PklSessionIdParam, body: DecidePklDayRequest },
    ok: PklDayDecision,
    label: 'Decided',
    write: true,
  },
  {
    method: 'get',
    path: '/pkl/journals',
    summary: 'Jurnal PKL: the student their own, a supervisor their placements, leaders all; newest first, default last 31 days',
    request: { query: PklJournalQuery },
    ok: PklJournalList,
    label: 'Journals',
  },
  {
    method: 'post',
    path: '/pkl/journals/attachments',
    summary: 'Presigned PUT for a journal photo or file (siswa)',
    request: { body: CreatePklAttachmentRequest },
    ok: CreatePklAttachmentResponse,
    label: 'Upload',
    write: true,
    status: 201,
  },
  {
    method: 'post',
    path: '/pkl/journals',
    summary: "Write or rewrite the journal of a date (default today, up to 7 days back) inside the running placement (siswa)",
    description: 'attachment undefined keeps, null removes. 409 no_placement; 409 approved once approved; a rewrite goes back to submitted.',
    request: { body: WritePklJournalRequest },
    ok: PklJournal,
    label: 'Journal',
    write: true,
  },
  {
    method: 'post',
    path: '/pkl/journals/{journalId}/review',
    summary: 'Approve a journal or ask for a revision (guru pembimbing, pembimbing industri of the placement, PKL managers)',
    description: '409 not_submitted when already reviewed.',
    request: { params: PklJournalIdParam, body: ReviewPklJournalRequest },
    ok: PklJournal,
    label: 'Journal',
    write: true,
  },
  {
    method: 'get',
    path: '/pkl/journals/{journalId}/attachment',
    summary: "5-minute link to the journal's attachment",
    request: { params: PklJournalIdParam },
    ok: PklAttachmentLink,
    label: 'Link',
  },
];
