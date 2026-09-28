import { createPool } from '@hire-wire/db';
import { buildApp } from './app.ts';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const pool = createPool(connectionString);
const app = buildApp({ pool, logger: true });

async function shutdown() {
  await app.close();
  await pool.end();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 3000) });
