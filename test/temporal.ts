import { Client, Connection } from '@temporalio/client';
import { NativeConnection } from '@temporalio/worker';
import { afterAll, inject } from 'vitest';

/** Client and worker connections to the shared local Temporal server, closed after the file. */
export async function connectTestTemporal() {
  const address = inject('temporalAddress');
  const [connection, nativeConnection] = await Promise.all([
    Connection.connect({ address }),
    NativeConnection.connect({ address }),
  ]);
  afterAll(async () => {
    await Promise.all([connection.close(), nativeConnection.close()]);
  });
  return { client: new Client({ connection }), nativeConnection };
}
