import { MembershipStatus } from '@absah/contracts';
import { z } from 'zod';

/**
 * Catalog of outbox events. Payloads carry ids and states, never personal data (names, phones):
 * consumers load what they need inside their own withTenant transaction.
 * Changing a payload shape is a breaking change for queued jobs: add a new event type instead.
 */
export const EVENTS = {
  'membership.status_changed': z.object({
    membershipId: z.uuid(),
    userId: z.uuid(),
    from: MembershipStatus,
    to: MembershipStatus,
  }),
  /** Delivery of the link over WhatsApp/email arrives with notifications (prompt 3.2). */
  'membership.invited': z.object({
    membershipId: z.uuid(),
    invitationId: z.uuid(),
    channel: z.enum(['email', 'whatsapp']),
  }),
  /** The file of a student import is uploaded; academic parses it into a preview. */
  'student_import.uploaded': z.object({ importId: z.uuid() }),
} as const;

export type EventType = keyof typeof EVENTS;
export type EventPayload<T extends EventType> = z.infer<(typeof EVENTS)[T]>;

/** What a consumer receives (also the pg-boss job data). */
export interface OutboxEvent<T extends EventType = EventType> {
  id: string;
  schoolId: string;
  type: T;
  payload: EventPayload<T>;
  traceId: string | null;
  occurredAt: string;
}

const Envelope = z.object({
  id: z.uuid(),
  schoolId: z.uuid(),
  type: z.string(),
  payload: z.unknown(),
  traceId: z.string().nullable(),
  occurredAt: z.string(),
});

/** Validates job data coming back from pg-boss against the envelope and the event catalog. */
export function parseEvent<T extends EventType>(type: T, data: unknown): OutboxEvent<T> {
  const envelope = Envelope.parse(data);
  if (envelope.type !== type) throw new Error(`outbox: expected ${type}, got ${envelope.type}`);
  const payload = EVENTS[type].parse(envelope.payload) as EventPayload<T>;
  return { ...envelope, type, payload };
}
