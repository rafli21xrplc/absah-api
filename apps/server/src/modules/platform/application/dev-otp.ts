import { schema } from '@absah/db';
import { desc, eq } from 'drizzle-orm';
import { withPlatform } from '../../../shared/db';

/**
 * The newest login code sent to a phone (dev/e2e only, entrypoints/auth-last-otp.ts refuses
 * production). Better Auth keeps it as "<code>:<attempts>" under phone-number-otp-<E.164>.
 * withPlatform: Better Auth tables are outside the app role's reach, and there is no school.
 */
export async function lastPhoneOtp(phoneNumber: string): Promise<string | null> {
  const [row] = await withPlatform((tx) =>
    tx
      .select({ value: schema.verification.value })
      .from(schema.verification)
      .where(eq(schema.verification.identifier, `phone-number-otp-${phoneNumber}`))
      .orderBy(desc(schema.verification.createdAt))
      .limit(1),
  );
  return row?.value.split(':')[0] ?? null;
}
