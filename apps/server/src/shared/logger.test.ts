import { Writable } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { REDACT_PATHS } from './logger';

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  const logger = pino({ redact: { paths: REDACT_PATHS, censor: '[redacted]' } }, stream);
  return { logger, lines };
}

describe('logger redaction', () => {
  it('never writes names, phone numbers, NISN or NIK', () => {
    const { logger, lines } = capture();
    logger.info(
      {
        phone: '081234567890',
        student: { name: 'Ani Lestari', nisn: '0012345678' },
        payload: { guardian: { nik: '3201010101010001' } },
        req: { headers: { authorization: 'Bearer abc', cookie: 'sid=1' } },
        schoolId: '0190a2b4-0000-7000-8000-000000000000',
      },
      'event',
    );
    const out = lines.join('');
    for (const secret of ['081234567890', 'Ani Lestari', '0012345678', '3201010101010001', 'Bearer abc', 'sid=1']) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('0190a2b4-0000-7000-8000-000000000000');
  });
});
