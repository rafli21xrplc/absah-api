import { TPPK_REPORT_STATUSES, TRACKING_CODE_ALPHABET, TRACKING_CODE_LENGTH, TppkTrackingCode, type CreateTppkReportRequest, type TppkChannel, type TppkReportReceipt, type TppkReportStatus, type TppkTrackResponse } from '@absah/contracts';
import type { Tx } from '@absah/db';
import { randomInt } from 'node:crypto';
import { uuidv7 } from 'uuidv7';
import { audit } from '../../../shared/audit';
import { readCapabilityRows, resolveFromRows } from '../../../shared/capability';
import { hashValue } from '../../../shared/crypto';
import { withAnonymous, withTenant } from '../../../shared/db';
import { NotFoundError } from '../../../shared/errors';
import { emit } from '../../../shared/outbox';
import { schoolDate } from '../../../shared/school-date';
import { insertReport, schoolOf, statusByCodeHash } from '../infrastructure/tppk-report-repo';

const CLOSED = 'Kanal lapor sekolah ini tidak tersedia.';
const NOT_FOUND = 'Kode lacak tidak ditemukan.';

export function newTrackingCode(): string {
  let code = '';
  for (let i = 0; i < TRACKING_CODE_LENGTH; i++) code += TRACKING_CODE_ALPHABET[randomInt(TRACKING_CODE_ALPHABET.length)];
  return code;
}

/** Domain-separated, so the hash of a code can never equal another hashed value (IP, phone). */
const codeHash = (code: string) => hashValue(`tppk-tracking:${code}`);

/** The school, when it exists and has student.tppk on. Same 404 for both, so ids cannot be probed. */
async function openSchool(tx: Tx, schoolId: string) {
  const school = await schoolOf(tx, schoolId);
  if (!school) return null;
  const caps = resolveFromRows(school, await readCapabilityRows(tx), schoolDate(school.timezone));
  return caps['student.tppk'] === true ? school : null;
}

export function reportChannel(schoolId: string): Promise<TppkChannel> {
  return withTenant({ schoolId, userId: null }, async (tx) => {
    const school = await openSchool(tx, schoolId);
    if (!school) throw new NotFoundError(CLOSED);
    return { schoolName: school.name };
  });
}

/**
 * Files a report (KSW-06). Anonymous: the account is not even looked at, and the audit entry has no
 * actor and no IP. The tracking code goes back once; only its keyed hash is stored.
 * tppk.report_received tells the TPPK members only.
 */
export function fileReport(input: CreateTppkReportRequest, reporterUserId: string | null, requestId: string | null): Promise<TppkReportReceipt> {
  const userId = input.anonymous ? null : reporterUserId;
  return withTenant({ schoolId: input.schoolId, userId: null }, async (tx) => {
    if (!(await openSchool(tx, input.schoolId))) throw new NotFoundError(CLOSED);
    const id = uuidv7();
    const trackingCode = newTrackingCode();
    await insertReport(tx, {
      id,
      schoolId: input.schoolId,
      category: input.category,
      chronology: input.chronology,
      occurredOn: input.occurredOn ?? null,
      reporterRelation: input.reporterRelation,
      isAnonymous: input.anonymous,
      reporterUserId: userId,
      reporterName: input.anonymous ? null : (input.reporterName ?? null),
      reporterContact: input.anonymous ? null : (input.reporterContact ?? null),
      trackingCodeHash: codeHash(trackingCode),
    });
    await audit(
      tx,
      { schoolId: input.schoolId, actorUserId: userId, requestId, ip: null },
      'tppk.report_filed',
      { type: 'tppk_report', id },
      { after: { category: input.category, anonymous: input.anonymous } },
      { omitIp: true },
    );
    await emit(tx, 'tppk.report_received', { reportId: id });
    return { trackingCode, status: 'diterima' };
  });
}

const isStatus = (s: string | null): s is TppkReportStatus => s !== null && (TPPK_REPORT_STATUSES as readonly string[]).includes(s);

/**
 * The status for a tracking code. A malformed code still costs one lookup and gets the very same
 * 404 as an unknown one, so the answer says nothing about which codes exist.
 */
export async function trackReport(raw: string): Promise<TppkTrackResponse> {
  const parsed = TppkTrackingCode.safeParse(raw);
  const status = await withAnonymous((tx) => statusByCodeHash(tx, codeHash(parsed.success ? parsed.data : raw)));
  if (!parsed.success || !isStatus(status)) throw new NotFoundError(NOT_FOUND);
  return { status };
}
