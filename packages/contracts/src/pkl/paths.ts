import type { z } from 'zod';
import { PklCheckin, PklCheckinBody, PklToday } from './checkins';
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
];
