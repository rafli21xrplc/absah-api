import { maskPhone, type StudentContacts, type UpdateStudentContactsRequest } from '@absah/contracts';
import type { Tx } from '@absah/db';
import { audit, type AuditContext } from '../../../shared/audit';
import { hashValue } from '../../../shared/crypto';
import { withTenant } from '../../../shared/db';
import { NotFoundError, ValidationError } from '../../../shared/errors';
import type { Actor } from '../../../shared/policy';
import { ensurePhoneLogin, hasActiveMembership, loginPhoneOf, setPortalMembership, type Auth } from '../../platform';
import { canManageStudentData } from '../domain/policies';
import { guardiansOfStudent, setGuardianPhone, setStudentUser, studentForContacts } from '../infrastructure/contacts-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
const NOT_FOUND = 'Siswa tidak ditemukan.';

type Student = NonNullable<Awaited<ReturnType<typeof studentForContacts>>>;

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
    guardians: guardians.map((g) => ({ id: g.id, name: g.name, relation: g.relation, phone: g.phone ? maskPhone(g.phone.reveal()) : null })),
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
 * Sets WhatsApp numbers (ORT-02, NTF): guardians' numbers receive messages and action links; the
 * student's number is their PWA login (an active siswa membership, no invitation: the OTP is the
 * proof). The audit log records which numbers changed, never the numbers.
 */
export async function updateStudentContacts(auth: Auth, actor: Actor, auditCtx: AuditContext, studentId: string, input: UpdateStudentContactsRequest): Promise<StudentContacts> {
  // Check access first, without creating any login for a student the caller may not manage.
  const before = await withTenant(scope(actor), async (tx) => {
    const student = await studentForContacts(tx, studentId, false);
    if (!student || !mayManage(actor, student)) throw new NotFoundError(NOT_FOUND);
    const guardians = await guardiansOfStudent(tx, studentId);
    const unknown = (input.guardians ?? []).filter((g) => !guardians.some((x) => x.id === g.guardianId));
    if (unknown.length) throw new ValidationError(unknown.map((g) => ({ path: `guardians.${g.guardianId}`, message: 'Wali ini bukan wali siswa tersebut.' })));
    return student;
  });
  // Better Auth writes on its own connection, so the login exists before the tenant transaction.
  const userId = input.studentPhone ? await ensurePhoneLogin(auth, { name: before.name, phoneNumber: input.studentPhone, currentUserId: before.userId }) : before.userId;

  return withTenant(scope(actor), async (tx) => {
    const student = await studentForContacts(tx, studentId, true);
    if (!student) throw new NotFoundError(NOT_FOUND);
    for (const g of input.guardians ?? []) await setGuardianPhone(tx, g.guardianId, g.phone, g.phone ? hashValue(g.phone) : null);
    if (input.studentPhone !== undefined && userId) {
      if (userId !== student.userId) await setStudentUser(tx, studentId, userId);
      await setPortalMembership(tx, { schoolId: actor.schoolId, userId, role: 'siswa', active: input.studentPhone !== null });
    }
    await audit(tx, auditCtx, 'student.contacts_updated', { type: 'student', id: studentId }, {
      after: {
        guardiansChanged: (input.guardians ?? []).map((g) => ({ guardianId: g.guardianId, hasPhone: g.phone !== null })),
        ...(input.studentPhone !== undefined ? { studentLogin: input.studentPhone === null ? 'ended' : 'set' } : {}),
      },
    });
    return view(tx, auth, { ...student, userId: userId ?? student.userId });
  });
}
