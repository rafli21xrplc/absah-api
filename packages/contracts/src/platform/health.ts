import { z } from 'zod';

export const HealthResponse = z.object({
  status: z.literal('ok'),
  service: z.literal('absah-api'),
  version: z.string(),
  time: z.iso.datetime(),
}).meta({ id: 'HealthResponse' });
export type HealthResponse = z.infer<typeof HealthResponse>;
