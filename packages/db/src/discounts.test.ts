import { describe, expect, it } from 'vitest';
import { useTestDatabase } from '../../../test/database.ts';
import { applyDiscount, DiscountError, findDiscountCode } from './discounts.ts';
import { createInvoice, transitionStatus } from './invoices.ts';

describe('discounts', () => {
  const pool = useTestDatabase();

  async function newInvoice() {
    return createInvoice(pool, {
      customerName: 'Acme Ltd',
      customerEmail: 'billing@acme.test',
      currency: 'EUR',
      lineItems: [{ description: 'Consulting', quantity: 1, unitPriceCents: 10_000 }],
    });
  }

  it('finds the seeded welcome code', async () => {
    expect(await findDiscountCode(pool, 'WELCOME10')).toMatchObject({ code: 'WELCOME10', active: true });
  });

  it('applies a percentage discount to a pending invoice', async () => {
    const { id } = await newInvoice();

    const { invoice } = await applyDiscount(pool, id, 'WELCOME10');

    expect(invoice).toMatchObject({ totalCents: 9_000, discountCode: 'WELCOME10', discountCents: 1_000 });
  });

  it('rejects unknown codes', async () => {
    const { id } = await newInvoice();
    await expect(applyDiscount(pool, id, 'NOPE')).rejects.toThrow(DiscountError);
  });

  it('rejects invoices that are no longer pending', async () => {
    const { id } = await newInvoice();
    await transitionStatus(pool, id, { from: 'pending_approval', to: 'approved' });
    await expect(applyDiscount(pool, id, 'WELCOME10')).rejects.toThrow('invoice_not_pending');
  });
});
