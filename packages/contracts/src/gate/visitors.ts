import { z } from 'zod';

/** Buku tamu (GRB-11, behind gate.visitors): guests sign in at the kiosk, piket signs them out. */

const Name = z.string().trim().min(1, 'Tulis nama tamu.').max(100);

/** POST /api/v1/kiosk/visitors. clientEventId makes a resend (flaky wifi) record one visit. */
export const CreateVisitorRequest = z
  .object({
    clientEventId: z.uuid(),
    name: Name,
    organization: z.string().trim().max(100).optional(),
    purpose: z.string().trim().min(1, 'Tulis tujuan kunjungan.').max(200),
    /** The staff member the guest came for; they are told on arrival. */
    hostUserId: z.uuid().optional(),
  })
  .strict()
  .meta({ id: 'CreateVisitorRequest' });
export type CreateVisitorRequest = z.infer<typeof CreateVisitorRequest>;

/** GET /api/v1/kiosk/visitor-hosts: the staff a guest can pick (id and name only). */
export const VisitorHostList = z
  .object({ items: z.array(z.object({ id: z.uuid(), name: z.string() })) })
  .meta({ id: 'VisitorHostList' });
export type VisitorHostList = z.infer<typeof VisitorHostList>;

export const Visitor = z
  .object({
    id: z.uuid(),
    schoolDate: z.iso.date(),
    name: z.string(),
    organization: z.string().nullable(),
    purpose: z.string(),
    host: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    arrivedAt: z.iso.datetime({ offset: true }),
    /** Null while the guest is still on the premises. */
    leftAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .meta({ id: 'Visitor' });
export type Visitor = z.infer<typeof Visitor>;

/** GET /api/v1/visitors?date=&status=: the day's guests, newest first. */
export const VisitorsQuery = z
  .object({ date: z.iso.date().optional(), status: z.enum(['inside', 'all']).default('all') })
  .meta({ id: 'VisitorsQuery' });
export type VisitorsQuery = z.infer<typeof VisitorsQuery>;

export const VisitorList = z
  .object({ schoolDate: z.iso.date(), inside: z.int(), items: z.array(Visitor) })
  .meta({ id: 'VisitorList' });
export type VisitorList = z.infer<typeof VisitorList>;

export const VisitorIdParam = z.object({ visitorId: z.uuid() });
