import { maskPhone, type StudentContacts, type UpdateStudentContactsRequest } from '@absah/contracts';
import type { Tx } from '@absah/db';
import { audit, type AuditContext } from '../../../shared/audit';
import { hashValue } from '../../../shared/crypto';
import { withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import type { Actor } from '../../../shared/policy';
import { ensurePhoneLogin, guardianLogin, hasActiveMembership, loginPhoneOf, setPortalMembership, type Auth } from '../../platform';
import { canManageStudentData } from '../domain/policies';
import { guardiansOfStudent, isStudentLogin, linkedElsewhere, setGuardianPhone, setGuardianUser, setStudentUser, studentForContacts } from '../infrastructure/contacts-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
const NOT_FOUND = 'Siswa tidak ditemukan.';

type Student = NonNullable<Awaited<ReturnType<typeof studentForContacts>>>;
type Guardian = Awaited<ReturnType<typeof guardiansOfStudent>>[number];
type GuardianInput = NonNullable<UpdateStudentContactsRequest['guardians']>[number];

/** What one guardian entry asks for: the number they keep, and whether they log in with it. */
function guardianPlan(current: Guardian, input: GuardianInput) {
  const phone = input.phone !== undefined ? input.phone : (current.phone?.reveal() ?? null);
  const portal = input.portal ?? current.userId !== null;
  return { phone, portal: portal && phone !== null, refused: input.portal === true && phone === null };
}

/** Admin and operator for every student; the wali kelas for their own rombel. Others see nothing. */
const mayManage = (actor: Actor, student: Student) => canManageStudentData.allows(actor) || (student.homeroomTeacherId !== null && student.homeroomTeacherId === actor.userId);

async function view(tx: Tx, auth: Auth, student: Student): Promise<StudentContacts> {
  const [guardians, phone, active] = await Promise.all([
    guardiansOfStudent(tx, student.id),
    student.userId ? loginPhoneOf(auth, student.userId) : Promise.resolve(null),
    student.userId ? hasActiveMembership(tx, student.userId, 'siswa') : Promise.resolve(false),
  ]);
  return {
    studentId: student.id,
    name: student.name,
    className: student.className,
    account: { phone: phone ? maskPhone(phone) : null, active },
    guardians: guardians.map((g) => ({ id: g.id, name: g.name, relation: g.relation, phone: g.phone ? maskPhone(g.phone.reveal()) : null, portal: g.userId !== null })),
  };
}

export function getStudentContacts(auth: Auth, actor: Actor, studentId: string): Promise<StudentContacts> {
  return withTenant(scope(actor), async (tx) => {
    const student = await studentForContacts(tx, studentId, false);
    if (!student || !mayManage(actor, student)) throw new NotFoundError(NOT_FOUND);
    return view(tx, auth, student);
  });
}

/**
 * Sets WhatsApp numbers (ORT-02, NTF): guardians' numbers receive messages and action links, and
 * with portal on they log in to the PWA as orang_tua; the student's number is their PWA login (an
 * active siswa membership, no invitation: the OTP is the proof). The audit log records which numbers
 * and accesses changed, never the numbers.
 */
export async function updateStudentContacts(auth: Auth, actor: Actor, auditCtx: AuditContext, studentId: string, input: UpdateStudentContactsRequest): Promise<StudentContacts> {
  // Check access first, without creating any login for a student the caller may not manage.
  const before = await withTenant(scope(actor), async (tx) => {
    const student = await studentForContacts(tx, studentId, false);
    if (!student || !mayManage(actor, student)) throw new NotFoundError(NOT_FOUND);
    const guardians = await guardiansOfStudent(tx, studentId);
    const errors: { path: string; message: string }[] = [];
    const plans = (input.guardians ?? []).flatMap((g) => {
      const current = guardians.find((x) => x.id === g.guardianId);
      if (!current) {
        errors.push({ path: `guardians.${g.guardianId}`, message: 'Wali ini bukan wali siswa tersebut.' });
        return [];
      }
      const plan = guardianPlan(current, g);
      if (plan.refused) errors.push({ path: `guardians.${g.guardianId}.portal`, message: 'Isi nomor WhatsApp wali untuk membuka akses portal.' });
      return [{ guardian: current, input: g, ...plan }];
    });
    if (errors.length) throw new ValidationError(errors);
    return { student, plans };
  });
  // Better Auth writes on its own connection, so the logins exist before the tenant transaction.
  const userId = input.studentPhone ? await ensurePhoneLogin(auth, { name: before.student.name, phoneNumber: input.studentPhone, currentUserId: before.student.userId }) : before.student.userId;
  const guardianUsers = new Map<string, string>();
  for (const p of before.plans) if (p.portal && p.phone) guardianUsers.set(p.guardian.id, await guardianLogin(auth, { name: p.guardian.name, phoneNumber: p.phone }));

  return withTenant(scope(actor), async (tx) => {
    const student = await studentForContacts(tx, studentId, true);
    if (!student) throw new NotFoundError(NOT_FOUND);
    const portalChanges: { guardianId: string; portal: 'on' | 'off' }[] = [];
    for (const p of before.plans) {
      if (p.input.phone !== undefined) await setGuardianPhone(tx, p.guardian.id, p.phone, p.phone ? hashValue(p.phone) : null);
      const next = guardianUsers.get(p.guardian.id) ?? null;
      const prev = p.guardian.userId;
      if (next === prev) continue;
      // A student's own login never becomes a parent account (it would see siblings' data).
      if (next && (await isStudentLogin(tx, next))) throw new ConflictError('Nomor ini dipakai login siswa. Pakai nomor wali sendiri.', { reason: 'phone_student' });
      await setGuardianUser(tx, p.guardian.id, next);
      if (next) await setPortalMembership(tx, { schoolId: actor.schoolId, userId: next, role: 'orang_tua', active: true });
      if (prev && !(await linkedElsewhere(tx, prev, p.guardian.id))) await setPortalMembership(tx, { schoolId: actor.schoolId, userId: prev, role: 'orang_tua', active: false });
      if ((next === null) !== (prev === null)) portalChanges.push({ guardianId: p.guardian.id, portal: next ? 'on' : 'off' });
    }
    if (input.studentPhone !== undefined && userId) {
      if (userId !== student.userId) await setStudentUser(tx, studentId, userId);
      await setPortalMembership(tx, { schoolId: actor.schoolId, userId, role: 'siswa', active: input.studentPhone !== null });
    }
    await audit(tx, auditCtx, 'student.contacts_updated', { type: 'student', id: studentId }, {
      after: {
        guardiansChanged: before.plans.filter((p) => p.input.phone !== undefined).map((p) => ({ guardianId: p.guardian.id, hasPhone: p.phone !== null })),
        ...(portalChanges.length ? { guardianPortal: portalChanges } : {}),
        ...(input.studentPhone !== undefined ? { studentLogin: input.studentPhone === null ? 'ended' : 'set' } : {}),
      },
    });
    return view(tx, auth, { ...student, userId: userId ?? student.userId });
  });
}
