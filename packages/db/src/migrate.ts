import { readdir, readFile } from 'node:fs/promises';
import type pg from 'pg';
import { createPool } from './pool.ts';

const migrationsDir = new URL('../migrations/', import.meta.url);

// Arbitrary constant shared by every process that migrates this database.
const migrationLockId = 7_413_001;

export async function runMigrations(pool: pg.Pool): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    // api and worker may start together; the lock makes the second runner wait instead of racing.
    await client.query('select pg_advisory_lock($1)', [migrationLockId]);
    await client.query(
      'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
    );
    const { rows } = await client.query<{ name: string }>('select name from schema_migrations');
    const alreadyApplied = new Set(rows.map((row) => row.name));
    const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();

    for (const file of files) {
      if (alreadyApplied.has(file)) continue;
      const sql = await readFile(new URL(file, migrationsDir), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (name) values ($1)', [file]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw new Error(`Migration ${file} failed`, { cause: error });
      }
      applied.push(file);
    }
  } finally {
    await client.query('select pg_advisory_unlock($1)', [migrationLockId]).catch(() => {});
    client.release();
  }
  return applied;
}

if (import.meta.main) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const pool = createPool(connectionString);
  try {
    const applied = await runMigrations(pool);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date');
  } finally {
    await pool.end();
  }
}
