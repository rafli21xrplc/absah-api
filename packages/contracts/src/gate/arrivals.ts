import { z } from 'zod';
import { ArrivalOutcome, ScanMethod } from './enums';

/** Piket at the gate (GRB-05, GRB-06). */

/** POST /api/v1/gate/arrivals: a student came in without a card scan; the reason is required. */
export const ManualArrivalRequest = z
  .object({
    enrollmentId: z.uuid(),
    reason: z.string().trim().min(5, 'Tulis alasan, mis. HP orang tua tertinggal.').max(200),
    /** Defaults to now; earlier when entered after the fact (today only). */
    arrivedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict()
  .meta({ id: 'ManualArrivalRequest' });
export type ManualArrivalRequest = z.infer<typeof ManualArrivalRequest>;

const Student = { enrollmentId: z.uuid(), name: z.string(), className: z.string() };

export const Arrival = z
  .object({ ...Student, arrivedAt: z.iso.datetime({ offset: true }), outcome: ArrivalOutcome, method: ScanMethod, reason: z.string().nullable() })
  .meta({ id: 'Arrival' });
export type Arrival = z.infer<typeof Arrival>;

/** GET /api/v1/gate/today: who is late and who has not come in yet. */
export const GateToday = z
  .object({
    schoolDate: z.iso.date(),
    lateAfter: z.string(),
    counts: z.object({ students: z.int(), arrived: z.int(), late: z.int(), notArrived: z.int() }),
    late: z.array(Arrival),
    /** Not in yet; `leave` is S or I when an approved izin covers today (no need to chase). */
    notArrived: z.array(z.object({ ...Student, leave: z.enum(['S', 'I']).nullable() })),
  })
  .meta({ id: 'GateToday' });
export type GateToday = z.infer<typeof GateToday>;

/**
 * GET /api/v1/gate/board (GRB-08): the live arrival board, light enough to poll every 5 seconds. Per rombel: on time, late, and
 * not in yet (`excused` of those are covered by an approved izin, nobody needs to chase them).
 */
export const ArrivalBoard = z
  .object({
    schoolDate: z.iso.date(),
    lateAfter: z.string(),
    /** When the server computed it, so a screen can show "diperbarui 07.41". */
    updatedAt: z.iso.datetime({ offset: true }),
    totals: z.object({ students: z.int(), onTime: z.int(), late: z.int(), notArrived: z.int(), excused: z.int() }),
    classes: z.array(z.object({ className: z.string(), students: z.int(), onTime: z.int(), late: z.int(), notArrived: z.int(), excused: z.int() })),
  })
  .meta({ id: 'ArrivalBoard' });
export type ArrivalBoard = z.infer<typeof ArrivalBoard>;
