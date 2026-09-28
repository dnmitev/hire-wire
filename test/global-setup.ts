import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';
import { createPool, runMigrations } from '@hire-wire/db';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

let container: StartedPostgreSqlContainer | undefined;

export async function setup(project: TestProject) {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const databaseUrl = container.getConnectionUri();
  const pool = createPool(databaseUrl);
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
  project.provide('databaseUrl', databaseUrl);
}

export async function teardown() {
  await container?.stop();
}
