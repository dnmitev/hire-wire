import { NativeConnection, Worker } from '@temporalio/worker';
import { createPool } from '@hire-wire/db';
import { taskQueue, workflowsPath } from '@hire-wire/workflows';
import { createActivities } from './activities.ts';
import { createFakePaymentGateway } from './payment-gateway.ts';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const pool = createPool(connectionString);
const connection = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233' });
const worker = await Worker.create({
  connection,
  taskQueue,
  workflowsPath,
  activities: createActivities({ pool, paymentGateway: createFakePaymentGateway() }),
});

process.once('SIGTERM', () => worker.shutdown());
process.once('SIGINT', () => worker.shutdown());

try {
  await worker.run();
} finally {
  await connection.close();
  await pool.end();
}
