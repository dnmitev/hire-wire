import { afterAll, beforeEach, inject } from 'vitest';
import { createPool } from '@hire-wire/db';

/** A pool on the shared test database, emptied before every test in the calling file. */
export function useTestDatabase() {
  const pool = createPool(inject('databaseUrl'));
  beforeEach(async () => {
    await pool.query('truncate invoices cascade');
  });
  afterAll(async () => {
    await pool.end();
  });
  return pool;
}
