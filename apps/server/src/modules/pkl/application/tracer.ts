import { maskPhone, type InviteTracerRequest, type InviteTracerResult, type AlumniFromClassRequest, type TracerClassList, type AlumniFromClassResult, type CreateTracerAlumnusRequest, type SaveTracerResponseRequest, type TracerAlumnus, type TracerAlumniList, type TracerAlumniQuery, type TracerRecap } from '@absah/contracts';
import { uuidv7 } from 'uuidv7';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import { NotFoundError } from '../../../shared/errors';
import { emit } from '../../../shared/outbox';
import type { Actor } from '../../../shared/policy';
import { canManageTracer, canReadTracer } from '../domain/policies';
import { tracerRecap } from '../domain/tracer';
import { activeStudentsOfClass, alumniRows, alumniStudentIds, findClass, insertAlumni, tracerClasses, upsertResponse, type AlumniRow } from '../infrastructure/tracer-repo';
import { tracerWorkbook } from '../infrastructure/tracer-xlsx';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });

const view = (r: AlumniRow): TracerAlumnus => ({
  id: r.id,
  name: r.name,
  nisn: r.nisn,
  graduationYear: r.graduationYear,
  stream: r.stream,
  phone: r.phone ? maskPhone(r.phone.reveal()) : null,
  response: r.status && r.source && r.answeredAt ? { status: r.status, organization: r.organization?.reveal() ?? null, position: r.position?.reveal() ?? null, source: r.source, answeredAt: r.answeredAt.toISOString() } : null,
});

export function listAlumni(actor: Actor, query: TracerAlumniQuery): Promise<TracerAlumniList> {
  authorize(actor, canReadTracer);
  return withTenant(scope(actor), async (tx) => ({
    items: (await alumniRows(tx, { ...(query.graduationYear ? { graduationYear: query.graduationYear } : {}), ...(query.stream ? { stream: query.stream } : {}), ...(query.answered ? { answered: query.answered } : {}), ...(query.q ? { q: query.q } : {}) })).map(view),
  }));
}

export function createAlumnus(actor: Actor, auditCtx: AuditContext, input: CreateTracerAlumnusRequest): Promise<TracerAlumnus> {
  authorize(actor, canManageTracer);
  return withTenant(scope(actor), async (tx) => {
    const id = uuidv7();
    await insertAlumni(tx, [{ id, schoolId: actor.schoolId, name: input.name, nisn: input.nisn ?? null, graduationYear: input.graduationYear, stream: input.stream ?? null, studentId: null, phone: input.phoneNumber ?? null, createdBy: actor.userId }]);
    await audit(tx, auditCtx, 'tracer.alumnus_added', { type: 'tracer_alumnus', id }, { after: { graduationYear: input.graduationYear, stream: input.stream ?? null, hasPhone: Boolean(input.phoneNumber) } });
    const [row] = await alumniRows(tx, { id });
    if (!row) throw new Error('alumnus vanished');
    return view(row);
  });
}

/** Copies a rombel's active students into the alumni list; students already copied are skipped. */
export function alumniFromClass(actor: Actor, auditCtx: AuditContext, input: AlumniFromClassRequest): Promise<AlumniFromClassResult> {
  authorize(actor, canManageTracer);
  return withTenant(scope(actor), async (tx) => {
    const cls = await findClass(tx, input.classId);
    if (!cls) throw new NotFoundError('Rombel tidak ditemukan.');
    const [students, have] = await Promise.all([activeStudentsOfClass(tx, cls.id), alumniStudentIds(tx)]);
    const fresh = students.filter((s) => !have.has(s.id));
    await insertAlumni(tx, fresh.map((s) => ({ id: uuidv7(), schoolId: actor.schoolId, name: s.name, nisn: s.nisn, graduationYear: input.graduationYear, stream: cls.stream, studentId: s.id, phone: null, createdBy: actor.userId })));
    await audit(tx, auditCtx, 'tracer.alumni_copied', { type: 'class', id: cls.id }, { after: { graduationYear: input.graduationYear, added: fresh.length, skipped: students.length - fresh.length } });
    return { added: fresh.length, skipped: students.length - fresh.length };
  });
}

/** The BKK enters (or replaces) an alumnus's answer by hand. */
export function saveResponse(actor: Actor, auditCtx: AuditContext, alumnusId: string, input: SaveTracerResponseRequest): Promise<TracerAlumnus> {
  authorize(actor, canManageTracer);
  return withTenant(scope(actor), async (tx) => {
    const [found] = await alumniRows(tx, { id: alumnusId });
    if (!found) throw new NotFoundError('Alumni tidak ditemukan.');
    const bmw = input.status !== 'belum';
    await upsertResponse(tx, { id: uuidv7(), schoolId: actor.schoolId, alumnusId, status: input.status, organization: bmw ? (input.organization ?? null) : null, position: bmw ? (input.position || null) : null, source: 'bkk', enteredBy: actor.userId });
    await audit(tx, auditCtx, 'tracer.response_entered', { type: 'tracer_alumnus', id: alumnusId }, { before: { status: found.status }, after: { status: input.status } });
    const [row] = await alumniRows(tx, { id: alumnusId });
    if (!row) throw new Error('alumnus vanished');
    return view(row);
  });
}

const recapOf = (rows: readonly AlumniRow[]): TracerRecap => tracerRecap(rows.map((r) => ({ graduationYear: r.graduationYear, stream: r.stream, status: r.status })));

export function recap(actor: Actor): Promise<TracerRecap> {
  authorize(actor, canReadTracer);
  return withTenant(scope(actor), async (tx) => recapOf(await alumniRows(tx)));
}

const STREAMS: Record<string, string> = { ipa: 'IPA', ips: 'IPS', bahasa: 'Bahasa', keagamaan: 'Keagamaan' };

/** GET /tracer/export.xlsx: the recap and every alumnus with the answer. */
export function exportTracer(actor: Actor, today: string): Promise<{ file: Buffer; fileName: string }> {
  authorize(actor, canReadTracer);
  return withTenant(scope(actor), async (tx) => {
    const rows = await alumniRows(tx);
    return { file: await tracerWorkbook(recapOf(rows), rows, (s) => (s ? (STREAMS[s] ?? s) : '')), fileName: `tracer-study-${today}.xlsx` };
  });
}

/** The BKK sends the WhatsApp link: one event per alumnus with a number (and, unless `resend`, without an answer yet). */
export function inviteAlumni(actor: Actor, auditCtx: AuditContext, input: InviteTracerRequest): Promise<InviteTracerResult> {
  authorize(actor, canManageTracer);
  return withTenant(scope(actor), async (tx) => {
    const rows = await alumniRows(tx, input.alumnusIds ? { ids: input.alumnusIds } : { graduationYear: input.graduationYear as number });
    if (input.alumnusIds && rows.length !== new Set(input.alumnusIds).size) throw new NotFoundError('Alumni tidak ditemukan.');
    const withPhone = rows.filter((r) => r.phone !== null);
    const send = withPhone.filter((r) => input.resend || r.status === null);
    for (const r of send) await emit(tx, 'tracer.invitation_requested', { alumnusId: r.id });
    const result = { queued: send.length, withoutPhone: rows.length - withPhone.length, alreadyAnswered: withPhone.length - send.length };
    await audit(tx, auditCtx, 'tracer.invited', { type: 'tracer_alumni', id: actor.schoolId }, { after: { ...result, graduationYear: input.graduationYear ?? null, resend: input.resend } });
    return result;
  });
}

/** GET /tracer/classes: the rombel to copy an angkatan from (highest grade first: the ones about to graduate). */
export function listTracerClasses(actor: Actor): Promise<TracerClassList> {
  authorize(actor, canManageTracer);
  return withTenant(scope(actor), async (tx) => ({ items: await tracerClasses(tx) }));
}
