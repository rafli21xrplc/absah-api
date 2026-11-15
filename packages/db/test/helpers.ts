import { createDb, type DbHandle } from '../src/client';

export function testDb(): DbHandle {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  return createDb(url, { max: 4 });
}
