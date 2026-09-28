import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import type { TestProject } from 'vitest/node';
import { createPool, runMigrations } from '@hire-wire/db';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    temporalAddress: string;
  }
}

let container: StartedPostgreSqlContainer | undefined;
let temporal: TestWorkflowEnvironment | undefined;

export async function setup(project: TestProject) {
  [container, temporal] = await Promise.all([
    new PostgreSqlContainer('postgres:17-alpine').start(),
    TestWorkflowEnvironment.createLocal(),
  ]);
  const databaseUrl = container.getConnectionUri();
  const pool = createPool(databaseUrl);
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
  project.provide('databaseUrl', databaseUrl);
  project.provide('temporalAddress', temporal.address);
}

export async function teardown() {
  await Promise.all([container?.stop(), temporal?.teardown()]);
}
