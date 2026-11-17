import { LIAISON_RETRACT_MINUTES, type LiaisonSenderRole, type LiaisonThread, type LiaisonThreadList, type PostLiaisonMessageRequest } from '@absah/contracts';
import type { Tx } from '@absah/db';
import { uuidv7 } from 'uuidv7';
import { audit, type AuditContext } from '../../../shared/audit';
import { withTenant } from '../../../shared/db';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors';
import { emit } from '../../../shared/outbox';
import { anyRole, type Actor } from '../../../shared/policy';
import { ensureThread, insertMessage, lockMessage, markRead, messagesOf, relationOf, retractMessage, studentInfo, threadIdOf, threadsFor, type Relation } from '../infrastructure/liaison-repo';

/** Reads every thread, retracted messages included, for disputes; never writes. */
const isAdmin = anyRole('admin');
const isParent = anyRole('orang_tua');
const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
const RETRACT_MS = LIAISON_RETRACT_MINUTES * 60_000;

/** The role a participant writes as; null when not a participant. */
function senderRole(actor: Actor, rel: Relation): LiaisonSenderRole | null {
  if (rel.guardian && isParent.allows(actor)) return 'orang_tua';
  if (rel.homeroom) return 'wali_kelas';
  if (rel.teacher) return 'guru';
  return null;
}

export function listThreads(actor: Actor): Promise<LiaisonThreadList> {
  const as = isAdmin.allows(actor) ? 'admin' : isParent.allows(actor) ? 'parent' : 'staff';
  return withTenant(scope(actor), async (tx) => ({ items: await threadsFor(tx, actor.userId, as) }));
}

/** Participants and the admin may open a thread; anyone else gets 404, as for an unknown student. */
async function access(tx: Tx, actor: Actor, studentId: string) {
  const student = await studentInfo(tx, studentId);
  const role = student ? senderRole(actor, await relationOf(tx, studentId, actor.userId)) : null;
  const admin = isAdmin.allows(actor);
  if (!student || (!role && !admin)) throw new NotFoundError('Buku penghubung tidak ditemukan.');
  return { student, role, admin: admin && !role };
}

async function view(tx: Tx, actor: Actor, auditCtx: AuditContext, studentId: string, now: Date): Promise<LiaisonThread> {
  const { student, role, admin } = await access(tx, actor, studentId);
  const threadId = await threadIdOf(tx, studentId);
  const rows = threadId ? await messagesOf(tx, threadId) : [];
  if (threadId && admin) {
    await audit(tx, auditCtx, 'liaison.thread_viewed', { type: 'student', id: studentId }, { after: { messages: rows.length } });
  }
  return {
    student,
    canPost: role !== null,
    messages: rows.map((m) => {
      const mine = m.senderId === actor.userId;
      return {
        id: m.id,
        sender: { id: m.senderId, name: m.senderName ?? 'Pengguna' },
        senderRole: m.senderRole,
        body: m.retractedAt && !admin ? null : m.body.reveal(),
        createdAt: m.createdAt.toISOString(),
        retractedAt: m.retractedAt?.toISOString() ?? null,
        mine,
        canRetract: mine && !m.retractedAt && now.getTime() - m.createdAt.getTime() < RETRACT_MS,
      };
    }),
  };
}

/** The admin's reads are audited: they see retracted messages too. */
export function getThread(actor: Actor, auditCtx: AuditContext, studentId: string, now = new Date()): Promise<LiaisonThread> {
  return withTenant(scope(actor), (tx) => view(tx, actor, auditCtx, studentId, now));
}

/** A participant writes; the thread is created with the first message. */
export function postMessage(actor: Actor, auditCtx: AuditContext, studentId: string, input: PostLiaisonMessageRequest, now = new Date()): Promise<LiaisonThread> {
  return withTenant(scope(actor), async (tx) => {
    const { role } = await access(tx, actor, studentId);
    if (!role) throw new ForbiddenError('Admin hanya dapat membaca buku penghubung.');
    const threadId = await ensureThread(tx, actor.schoolId, studentId);
    const id = uuidv7();
    await insertMessage(tx, { id, schoolId: actor.schoolId, threadId, senderId: actor.userId, senderRole: role, body: input.body });
    await markRead(tx, actor.schoolId, threadId, actor.userId, now);
    await emit(tx, 'liaison.message_posted', { messageId: id });
    return view(tx, actor, auditCtx, studentId, now);
  });
}

export function readThread(actor: Actor, studentId: string, now = new Date()): Promise<void> {
  return withTenant(scope(actor), async (tx) => {
    await access(tx, actor, studentId);
    const threadId = await threadIdOf(tx, studentId);
    if (threadId) await markRead(tx, actor.schoolId, threadId, actor.userId, now);
  });
}

/** The sender takes a message back within 15 minutes; it stays stored (admin, disputes). */
export function retract(actor: Actor, auditCtx: AuditContext, messageId: string, now = new Date()): Promise<LiaisonThread> {
  return withTenant(scope(actor), async (tx) => {
    const m = await lockMessage(tx, messageId);
    if (!m || m.senderId !== actor.userId) throw new NotFoundError('Pesan tidak ditemukan.');
    if (m.retractedAt) return view(tx, actor, auditCtx, m.studentId, now);
    if (now.getTime() - m.createdAt.getTime() >= RETRACT_MS) throw new ConflictError(`Pesan hanya bisa ditarik dalam ${LIAISON_RETRACT_MINUTES} menit.`);
    await retractMessage(tx, messageId, now);
    await audit(tx, auditCtx, 'liaison.message_retracted', { type: 'liaison_message', id: messageId }, {});
    return view(tx, actor, auditCtx, m.studentId, now);
  });
}
