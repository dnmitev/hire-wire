import { afterAll, describe, expect, it } from 'vitest';
import { useTestDatabase } from '../../../../test/database.ts';
import { buildApp } from '../app.ts';

const validBody = {
  customerName: 'Acme Ltd',
  customerEmail: 'billing@acme.test',
  currency: 'EUR',
  lineItems: [
    { description: 'Consulting', quantity: 3, unitPriceCents: 12_500 },
    { description: 'Travel', quantity: 1, unitPriceCents: 4_999 },
  ],
};

describe('invoice routes', () => {
  const pool = useTestDatabase();
  const app = buildApp({ pool });
  afterAll(() => app.close());

  async function countInvoices() {
    const { rows } = await pool.query('select count(*)::int as count from invoices');
    return rows[0].count as number;
  }

  async function postInvoice(body: unknown) {
    return app.inject({ method: 'POST', url: '/invoices', payload: body as object });
  }

  describe('POST /invoices', () => {
    it('creates a pending invoice with the summed total', async () => {
      const response = await postInvoice(validBody);

      expect(response.statusCode).toBe(201);
      const invoice = response.json();
      expect(invoice).toMatchObject({ status: 'pending_approval', totalCents: 42_499, currency: 'EUR' });
      expect(invoice.lineItems).toHaveLength(2);
      expect(await countInvoices()).toBe(1);
    });

    it.each([
      ['missing customer name', { ...validBody, customerName: undefined }],
      ['blank customer name', { ...validBody, customerName: '   ' }],
      ['invalid email', { ...validBody, customerEmail: 'not-an-email' }],
      ['lowercase currency', { ...validBody, currency: 'eur' }],
      ['four-letter currency', { ...validBody, currency: 'EURO' }],
      ['no line items', { ...validBody, lineItems: [] }],
      ['fractional cents', { ...validBody, lineItems: [{ description: 'X', quantity: 1, unitPriceCents: 10.5 }] }],
      ['zero quantity', { ...validBody, lineItems: [{ description: 'X', quantity: 0, unitPriceCents: 100 }] }],
      ['negative price', { ...validBody, lineItems: [{ description: 'X', quantity: 1, unitPriceCents: -1 }] }],
    ])('rejects %s with 400 and persists nothing', async (_case, body) => {
      const response = await postInvoice(body);

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'validation_failed' });
      expect(response.json().issues.length).toBeGreaterThan(0);
      expect(await countInvoices()).toBe(0);
    });
  });

  it('rejects malformed JSON with 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/invoices',
      headers: { 'content-type': 'application/json' },
      payload: '{"customerName":',
    });
    expect(response.statusCode).toBe(400);
    expect(await countInvoices()).toBe(0);
  });

  describe('GET /invoices/:id', () => {
    it('returns the invoice with ordered line items', async () => {
      const created = (await postInvoice(validBody)).json();
      const response = await app.inject({ method: 'GET', url: `/invoices/${created.id}` });

      expect(response.statusCode).toBe(200);
      expect(response.json().lineItems.map((item: { description: string }) => item.description)).toEqual([
        'Consulting',
        'Travel',
      ]);
    });

    it('returns 404 for an unknown id', async () => {
      const response = await app.inject({ method: 'GET', url: '/invoices/00000000-0000-4000-8000-000000000000' });
      expect(response.statusCode).toBe(404);
    });

    it('returns 400 for a malformed id', async () => {
      const response = await app.inject({ method: 'GET', url: '/invoices/42' });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /invoices', () => {
    it('filters by status, newest first, respecting the limit', async () => {
      const older = (await postInvoice(validBody)).json();
      const newer = (await postInvoice(validBody)).json();
      await pool.query(`update invoices set status = 'paid' where id = $1`, [older.id]);

      const pending = await app.inject({ method: 'GET', url: '/invoices?status=pending_approval&limit=10' });
      expect(pending.json().invoices.map((invoice: { id: string }) => invoice.id)).toEqual([newer.id]);

      const all = await app.inject({ method: 'GET', url: '/invoices?limit=1' });
      expect(all.json().invoices.map((invoice: { id: string }) => invoice.id)).toEqual([newer.id]);
    });

    it.each(['limit=101', 'limit=0', 'status=shipped'])('rejects %s with 400', async (query) => {
      const response = await app.inject({ method: 'GET', url: `/invoices?${query}` });
      expect(response.statusCode).toBe(400);
    });
  });

  it('GET /health reports ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.json()).toEqual({ status: 'ok' });
  });
});
