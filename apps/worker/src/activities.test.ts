import { describe, expect, it } from 'vitest';
import { createInvoice, getInvoice, transitionStatus } from '@hire-wire/db';
import { useTestDatabase } from '../../../test/database.ts';
import { createActivities } from './activities.ts';
import { createFakePaymentGateway, declinedCurrency } from './payment-gateway.ts';

const lineItems = [{ description: 'Consulting', quantity: 2, unitPriceCents: 5_000 }];

describe('invoice activities', () => {
  const pool = useTestDatabase();

  function setup() {
    const paymentGateway = createFakePaymentGateway();
    return { paymentGateway, activities: createActivities({ pool, paymentGateway }) };
  }

  async function newInvoice(currency = 'EUR') {
    return createInvoice(pool, { customerName: 'Acme', customerEmail: 'billing@acme.test', currency, lineItems });
  }

  it('treats a repeated transition as success without touching the row again', async () => {
    const { activities } = setup();
    const { id } = await newInvoice();
    await activities.approveInvoice(id);
    const afterFirst = await getInvoice(pool, id);

    await activities.approveInvoice(id);

    expect(await getInvoice(pool, id)).toEqual(afterFirst);
    expect(afterFirst?.status).toBe('approved');
  });

  it('charges once per invoice even when retried, then records the reference', async () => {
    const { activities, paymentGateway } = setup();
    const { id } = await newInvoice();
    await activities.approveInvoice(id);

    const first = await activities.chargeInvoice(id);
    const retried = await activities.chargeInvoice(id);
    await activities.markPaid(id, first.paymentReference);
    await activities.markPaid(id, first.paymentReference);

    expect(retried).toEqual(first);
    expect(paymentGateway.chargeCount).toBe(1);
    expect(await getInvoice(pool, id)).toMatchObject({ status: 'paid', paymentReference: first.paymentReference });
  });

  it('refuses to charge an invoice that is not approved', async () => {
    const { activities, paymentGateway } = setup();
    const { id } = await newInvoice();
    await expect(activities.chargeInvoice(id)).rejects.toMatchObject({ type: 'InvalidInvoiceState' });
    expect(paymentGateway.chargeCount).toBe(0);
  });

  it('refuses to approve a rejected invoice', async () => {
    const { activities } = setup();
    const { id } = await newInvoice();
    await transitionStatus(pool, id, { from: 'pending_approval', to: 'rejected' });
    await expect(activities.approveInvoice(id)).rejects.toMatchObject({ type: 'InvalidInvoiceState' });
  });

  it('surfaces a declined charge as PaymentDeclined', async () => {
    const { activities } = setup();
    const { id } = await newInvoice(declinedCurrency);
    await activities.approveInvoice(id);
    await expect(activities.chargeInvoice(id)).rejects.toMatchObject({ type: 'PaymentDeclined', nonRetryable: true });
  });
});
