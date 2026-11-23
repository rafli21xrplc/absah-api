import { Writable } from 'node:stream';
import { sensitive } from '@absah/db';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { describe, expect, it } from 'vitest';
import { createLogger } from './logger';

/** Captures log lines and removes fields that change between runs (time, pid, host, stack). */
function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      cb();
    },
  });
  const logger = createLogger({ level: 'info' }, stream);
  const normalised = () => JSON.parse(JSON.stringify(lines, (k, v: unknown) => (['time', 'pid', 'hostname', 'stack'].includes(k) ? undefined : v))) as unknown;
  return { logger, raw: () => JSON.stringify(lines), normalised };
}

// Values that must never appear anywhere in log output.
const PII = {
  name: 'Ani Lestari',
  phone: '+6281234567890',
  nisn: '0012345678',
  nik: '3201010101010001',
  email: 'ani.ortu@contoh.id',
  encrypted: 'Pingsan saat upacara, dipulangkan',
  ip: '203.0.113.9',
};

function pgUniqueViolation(): Error {
  const e = new Error('duplicate key value violates unique constraint "user_email_unique"') as Error & Record<string, unknown>;
  e.code = '23505';
  e.detail = `Key (email)=(${PII.email}) already exists.`;
  return e;
}

describe('log redaction (snapshot)', () => {
  it('never writes names, phone numbers, NISN, NIK, emails, IPs or encrypted column contents', () => {
    const { logger, raw, normalised } = capture();

    logger.info(
      {
        requestId: 'req-1',
        schoolId: '0190a2b4-0000-7000-8000-000000000000',
        student: { name: PII.name, nisn: PII.nisn, nik: PII.nik },
        guardian: { phoneNumber: PII.phone, email: PII.email },
        req: { headers: { authorization: 'Bearer abc', cookie: 'better-auth.session_token=xyz', 'cf-connecting-ip': PII.ip } },
        visit: { outcome: 'dipulangkan', note: sensitive(PII.encrypted) },
        row: { id: 'r1', uksNote: sensitive(PII.encrypted) }, // key not in the redact list: SensitiveText still hides it
      },
      'domain event',
    );

    // Drizzle puts bound parameters in the message; Postgres quotes offending values.
    const insertFailed = new DrizzleQueryError(
      'insert into "students" ("name", "nisn", "phone") values ($1, $2, $3)',
      [PII.name, PII.nisn, PII.phone],
      pgUniqueViolation(),
    );
    logger.error({ err: insertFailed, requestId: 'req-2' }, 'request failed');
    logger.error({ err: new Error(`invalid input syntax for type uuid: "${PII.nik}"`) }, 'request failed');

    const out = raw();
    for (const value of Object.values(PII)) expect(out).not.toContain(value);
    expect(out).toContain('0190a2b4-0000-7000-8000-000000000000'); // ids stay useful
    expect(out).toContain('23505'); // SQLSTATE stays useful
    expect(normalised()).toMatchSnapshot();
  });
});
