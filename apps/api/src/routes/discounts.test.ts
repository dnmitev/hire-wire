import { afterAll, describe, expect, it } from 'vitest';
import { useTestDatabase } from '../../../../test/database.ts';
import { connectTestTemporal } from '../../../../test/temporal.ts';
import { buildApp } from '../app.ts';

const { client } = await connectTestTemporal();

describe('discount routes', () => {
  const pool = useTestDatabase();
  const app = buildApp({ pool, temporal: client });
  afterAll(() => app.close());

  async function createInvoice() {
    const response = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        customerName: 'Acme Ltd',
        customerEmail: 'billing@acme.test',
        currency: 'EUR',
        notes: 'Thanks for your business',
        lineItems: [{ description: 'Consulting', quantity: 2, unitPriceCents: 25_000 }],
      },
    });
    return response.json();
  }

  it('applies a discount code to a pending invoice', async () => {
    const created = await createInvoice();

    const response = await app.inject({
      method: 'POST',
      url: `/invoices/${created.id}/discount`,
      payload: { code: 'welcome10' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ totalCents: 45_000, discountCode: 'WELCOME10', notes: 'Thanks for your business' });
  });

  it('returns 409 for an unknown code', async () => {
    const created = await createInvoice();
    const response = await app.inject({
      method: 'POST',
      url: `/invoices/${created.id}/discount`,
      payload: { code: 'NOPE' },
    });
    expect(response.statusCode).toBe(409);
  });

  it('returns 404 for an unknown invoice', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/invoices/00000000-0000-4000-8000-000000000000/discount',
      payload: { code: 'WELCOME10' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('sorts the invoice list', async () => {
    const first = await createInvoice();
    const second = await createInvoice();

    const response = await app.inject({ method: 'GET', url: '/invoices?sort=created_at&direction=asc' });

    expect(response.json().invoices.map((invoice: { id: string }) => invoice.id)).toEqual([first.id, second.id]);
  });
});
