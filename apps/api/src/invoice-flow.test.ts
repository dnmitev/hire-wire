import { Worker } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInvoice as insertInvoice } from '@hire-wire/db';
import { taskQueue, workflowsPath } from '@hire-wire/workflows';
import { createActivities } from '../../worker/src/activities.ts';
import { createFakePaymentGateway, declinedCurrency } from '../../worker/src/payment-gateway.ts';
import { useTestDatabase } from '../../../test/database.ts';
import { connectTestTemporal } from '../../../test/temporal.ts';
import { buildApp } from './app.ts';

const { client, nativeConnection } = await connectTestTemporal();

describe('invoice lifecycle through api and worker', () => {
  const pool = useTestDatabase();
  const app = buildApp({ pool, temporal: client });
  const paymentGateway = createFakePaymentGateway();
  let workerRun: Promise<void>;
  let worker: Worker;

  beforeAll(async () => {
    worker = await Worker.create({
      connection: nativeConnection,
      taskQueue,
      workflowsPath,
      activities: createActivities({ pool, paymentGateway }),
    });
    workerRun = worker.run();
  });

  afterAll(async () => {
    worker.shutdown();
    await workerRun;
    await app.close();
  });

  async function createInvoice(currency = 'EUR') {
    const response = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        customerName: 'Acme Ltd',
        customerEmail: 'billing@acme.test',
        currency,
        lineItems: [{ description: 'Consulting', quantity: 2, unitPriceCents: 7_500 }],
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json().id as string;
  }

  function decide(id: string, decision: 'approve' | 'reject') {
    return app.inject({ method: 'POST', url: `/invoices/${id}/${decision}` });
  }

  async function waitForStatus(id: string, status: string) {
    await expect
      .poll(async () => (await app.inject({ method: 'GET', url: `/invoices/${id}` })).json().status, { timeout: 10_000 })
      .toBe(status);
  }

  it('approves, charges once and ends paid', async () => {
    const chargesBefore = paymentGateway.chargeCount;
    const id = await createInvoice();

    const response = await decide(id, 'approve');

    expect(response.statusCode).toBe(200);
    // The workflow may already have charged by the time the response is built.
    expect(['approved', 'paid']).toContain(response.json().status);
    await waitForStatus(id, 'paid');
    expect(paymentGateway.chargeCount).toBe(chargesBefore + 1);
  });

  it('rejects without charging', async () => {
    const chargesBefore = paymentGateway.chargeCount;
    const id = await createInvoice();

    const response = await decide(id, 'reject');

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('rejected');
    expect(paymentGateway.chargeCount).toBe(chargesBefore);
  });

  it('lets only one of two concurrent approvals through', async () => {
    const chargesBefore = paymentGateway.chargeCount;
    const id = await createInvoice();

    const responses = await Promise.all([decide(id, 'approve'), decide(id, 'approve')]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    await waitForStatus(id, 'paid');
    expect(paymentGateway.chargeCount).toBe(chargesBefore + 1);
  });

  it('refuses to approve a rejected invoice', async () => {
    const id = await createInvoice();
    await decide(id, 'reject');

    const response = await decide(id, 'approve');

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'invoice_already_decided', status: 'rejected' });
  });

  it('starts the workflow on approval when it was never started', async () => {
    // Simulates POST /invoices saving the invoice but failing to reach Temporal.
    const { id } = await insertInvoice(pool, {
      customerName: 'Acme Ltd',
      customerEmail: 'billing@acme.test',
      currency: 'EUR',
      lineItems: [{ description: 'Consulting', quantity: 1, unitPriceCents: 1_000 }],
    });

    expect((await decide(id, 'approve')).statusCode).toBe(200);
    await waitForStatus(id, 'paid');
  });

  it('ends payment_failed when the charge is declined', async () => {
    const id = await createInvoice(declinedCurrency);
    expect((await decide(id, 'approve')).statusCode).toBe(200);
    await waitForStatus(id, 'payment_failed');
  });

  it('approves from the invoice page', async () => {
    const login = await app.inject({ method: 'POST', url: '/admin/login', payload: { token: 'changeme' } });
    const cookie = login.headers['set-cookie'] as string;
    const id = await createInvoice();

    const response = await app.inject({ method: 'POST', url: `/invoices/${id}/approve-from-page`, headers: { cookie } });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(`/invoices/${id}/view`);
    await waitForStatus(id, 'paid');
  });

  it('returns 404 for an unknown invoice and 400 for a malformed id', async () => {
    expect((await decide('00000000-0000-4000-8000-000000000000', 'approve')).statusCode).toBe(404);
    expect((await decide('42', 'approve')).statusCode).toBe(400);
  });
});
