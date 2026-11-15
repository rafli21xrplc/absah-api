import type { PgBoss } from 'pg-boss';
import type { Logger } from 'pino';
import { consumerQueue, OUTBOX_DEAD_LETTER_QUEUE, runConsumer, type Consumer } from './consumer';
import { CONSUMER_QUEUE_OPTIONS, startOutboxRelay } from './relay';

/** Creates consumer queues, starts their workers and the relay loop. Call after boss.start(). */
export async function startOutbox(
  boss: PgBoss,
  consumers: readonly Consumer[],
  logger: Logger,
  options: { intervalMs?: number; pollingIntervalSeconds?: number } = {},
): Promise<{ stop(): Promise<void> }> {
  const queues = new Set<string>();
  await boss.createQueue(OUTBOX_DEAD_LETTER_QUEUE);
  for (const consumer of consumers) {
    const queue = consumerQueue(consumer);
    if (queues.has(queue)) throw new Error(`duplicate outbox consumer: ${queue}`);
    queues.add(queue);
    await boss.createQueue(queue, CONSUMER_QUEUE_OPTIONS);
    await boss.updateQueue(queue, CONSUMER_QUEUE_OPTIONS); // createQueue keeps an existing queue's policy
    await boss.work<unknown>(
      queue,
      { pollingIntervalSeconds: options.pollingIntervalSeconds ?? 2 },
      async (jobs) => {
        for (const job of jobs) {
          const result = await runConsumer(consumer, job.data);
          logger.debug({ queue, jobId: job.id, result }, 'outbox event consumed');
        }
      },
    );
  }
  return startOutboxRelay({ sink: boss, consumers, logger, intervalMs: options.intervalMs });
}
