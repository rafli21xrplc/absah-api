import type { Db as IDatabase, JobInsert } from 'pg-boss';
import type { Logger } from 'pino';
import { getDb } from '../db';
import { consumerQueue, OUTBOX_DEAD_LETTER_QUEUE, type Consumer } from './consumer';
import type { OutboxEvent } from './events';

/** The part of PgBoss the relay needs (insert accepts our transaction via options.db). */
export interface JobSink {
  insert(name: string, jobs: JobInsert[], options?: { db?: IDatabase }): Promise<unknown>;
}

interface Row {
  id: string;
  school_id: string;
  type: string;
  payload: unknown;
  trace_id: string | null;
  created_at: Date;
}

/** Retry policy of every consumer queue (set on the queue, so jobs inherit it). */
export const CONSUMER_QUEUE_OPTIONS = {
  retryLimit: 5,
  retryDelay: 5,
  retryBackoff: true,
  deadLetter: OUTBOX_DEAD_LETTER_QUEUE,
} as const;

/**
 * Moves one batch of unpublished events to pg-boss: one job per (event, consumer). The jobs and
 * published_at are written in ONE transaction on the login role (platform path, no tenant scope:
 * the relay serves every school). If anything fails or the process dies, the transaction rolls
 * back and the events are picked up again. SKIP LOCKED lets several workers relay in parallel.
 */
export async function relayOutboxBatch(sink: JobSink, consumers: readonly Consumer[], batchSize = 100): Promise<number> {
  const client = await getDb().pool.connect();
  try {
    await client.query('begin');
    const { rows } = await client.query<Row>(
      `select id, school_id, type, payload, trace_id, created_at
         from outbox_events
        where published_at is null
        order by created_at
        limit $1
          for update skip locked`,
      [batchSize],
    );

    const jobs = new Map<string, JobInsert[]>();
    for (const row of rows) {
      const data: OutboxEvent = {
        id: row.id,
        schoolId: row.school_id,
        type: row.type as OutboxEvent['type'],
        payload: row.payload as OutboxEvent['payload'],
        traceId: row.trace_id,
        occurredAt: row.created_at.toISOString(),
      };
      for (const consumer of consumers) {
        if (consumer.event !== row.type) continue;
        const queue = consumerQueue(consumer);
        jobs.set(queue, [...(jobs.get(queue) ?? []), { data }]);
      }
    }

    const db: IDatabase = { executeSql: (text, values) => client.query(text, values) };
    for (const [queue, batch] of jobs) await sink.insert(queue, batch, { db });
    if (rows.length > 0) {
      await client.query('update outbox_events set published_at = now() where id = any($1::uuid[])', [
        rows.map((r) => r.id),
      ]);
    }
    await client.query('commit');
    return rows.length;
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Polls the outbox every intervalMs, immediately again while batches come back full. */
export function startOutboxRelay(options: {
  sink: JobSink;
  consumers: readonly Consumer[];
  logger: Logger;
  intervalMs?: number;
  batchSize?: number;
}): { stop(): Promise<void> } {
  const { sink, consumers, logger, intervalMs = 1000, batchSize = 100 } = options;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();

  const tick = async (): Promise<void> => {
    let delay = intervalMs;
    try {
      const relayed = await relayOutboxBatch(sink, consumers, batchSize);
      if (relayed > 0) logger.debug({ relayed }, 'outbox relayed');
      if (relayed === batchSize) delay = 0;
    } catch (err) {
      logger.error({ err }, 'outbox relay failed');
      delay = intervalMs * 5;
    }
    if (!stopped) {
      timer = setTimeout(() => {
        running = tick();
      }, delay);
    }
  };

  running = tick();
  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
