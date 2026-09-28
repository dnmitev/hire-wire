import { describe, expect, it } from 'vitest';
import { useTestDatabase } from '../../../test/database.ts';
import { createInvoice, getInvoice, listInvoices, transitionStatus, type NewInvoice } from './invoices.ts';

const newInvoice: NewInvoice = {
  customerName: 'Acme Ltd',
  customerEmail: 'billing@acme.test',
  currency: 'EUR',
  lineItems: [
    { description: 'Consulting', quantity: 3, unitPriceCents: 12_500 },
    { description: 'Travel', quantity: 1, unitPriceCents: 4_999 },
  ],
};

describe('invoice repository', () => {
  const pool = useTestDatabase();

  it('creates an invoice with its line items and an integer total', async () => {
    const created = await createInvoice(pool, newInvoice);

    expect(created).toMatchObject({
      customerName: 'Acme Ltd',
      currency: 'EUR',
      status: 'pending_approval',
      totalCents: 42_499,
      paymentReference: null,
    });
    expect(created.lineItems).toEqual([
      { position: 1, description: 'Consulting', quantity: 3, unitPriceCents: 12_500 },
      { position: 2, description: 'Travel', quantity: 1, unitPriceCents: 4_999 },
    ]);
    expect(await getInvoice(pool, created.id)).toEqual(created);
  });

  it('rolls back the invoice when a line item is rejected', async () => {
    const invalid = { ...newInvoice, lineItems: [{ description: 'Bad', quantity: 0, unitPriceCents: 1 }] };
    await expect(createInvoice(pool, invalid)).rejects.toThrow();
    const { rows } = await pool.query('select count(*)::int as count from invoices');
    expect(rows[0].count).toBe(0);
  });

  it('returns null for an unknown invoice', async () => {
    expect(await getInvoice(pool, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('lists newest first, filtered by status and limited', async () => {
    const first = await createInvoice(pool, newInvoice);
    const second = await createInvoice(pool, newInvoice);
    const third = await createInvoice(pool, newInvoice);
    await transitionStatus(pool, second.id, { from: 'pending_approval', to: 'rejected' });

    const pending = await listInvoices(pool, { status: 'pending_approval', limit: 10 });
    expect(pending.map((invoice) => invoice.id)).toEqual([third.id, first.id]);

    const limited = await listInvoices(pool, { limit: 1 });
    expect(limited.map((invoice) => invoice.id)).toEqual([third.id]);
  });

  describe('transitionStatus', () => {
    it('lets exactly one of two concurrent transitions win', async () => {
      const { id } = await createInvoice(pool, newInvoice);
      const results = await Promise.all([
        transitionStatus(pool, id, { from: 'pending_approval', to: 'approved' }),
        transitionStatus(pool, id, { from: 'pending_approval', to: 'approved' }),
      ]);
      expect(results.filter((result) => result !== null)).toHaveLength(1);
    });

    it('changes nothing when the current status does not match', async () => {
      const { id } = await createInvoice(pool, newInvoice);
      expect(await transitionStatus(pool, id, { from: 'approved', to: 'paid' })).toBeNull();
      expect((await getInvoice(pool, id))?.status).toBe('pending_approval');
    });

    it('records the payment reference', async () => {
      const { id } = await createInvoice(pool, newInvoice);
      await transitionStatus(pool, id, { from: 'pending_approval', to: 'approved' });
      const paid = await transitionStatus(pool, id, { from: 'approved', to: 'paid', paymentReference: 'pay_123' });
      expect(paid).toMatchObject({ status: 'paid', paymentReference: 'pay_123' });
    });
  });
});
