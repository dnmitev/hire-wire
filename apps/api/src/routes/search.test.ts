import { afterAll, describe, expect, it } from 'vitest';
import { useTestDatabase } from '../../../../test/database.ts';
import { connectTestTemporal } from '../../../../test/temporal.ts';
import { buildApp } from '../app.ts';

const { client } = await connectTestTemporal();

describe('search routes', () => {
  const pool = useTestDatabase();
  const app = buildApp({ pool, temporal: client });
  afterAll(() => app.close());

  async function createInvoice(customerName: string) {
    await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        customerName,
        customerEmail: 'billing@example.test',
        currency: 'EUR',
        lineItems: [{ description: 'Consulting', quantity: 1, unitPriceCents: 10_000 }],
      },
    });
  }

  it('finds invoices by customer name', async () => {
    await createInvoice('Acme Ltd');
    await createInvoice('Globex');

    const response = await app.inject({ method: 'GET', url: '/invoices/search?q=acme' });

    expect(response.statusCode).toBe(200);
    expect(response.json().results.map((invoice: { customerName: string }) => invoice.customerName)).toEqual([
      'Acme Ltd',
    ]);
    expect(response.json().counts.pending).toBe(2);
  });

  it('exports matching invoices as CSV', async () => {
    await createInvoice('Acme Ltd');

    const response = await app.inject({ method: 'GET', url: '/invoices/export.csv?q=acme' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.body.split('\n')[0]).toBe('id,customer,email,items,total,status');
    expect(response.body).toContain('Acme Ltd');
  });
});
