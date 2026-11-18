import type { z } from 'zod';
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
];
