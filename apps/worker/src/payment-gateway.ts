import { randomUUID } from 'node:crypto';

export interface ChargeRequest {
  idempotencyKey: string;
  amountCents: number;
  currency: string;
}

export interface PaymentGateway {
  charge(request: ChargeRequest): Promise<{ reference: string }>;
}

export class PaymentDeclinedError extends Error {
  override name = 'PaymentDeclinedError';
}

/** ISO 4217 "no currency" code; the fake gateway declines it so the failure path can be exercised. */
export const declinedCurrency = 'XXX';

/**
 * In-memory stand-in for a payment provider that honours idempotency keys: charging the same key
 * again returns the original reference instead of charging twice.
 */
export function createFakePaymentGateway() {
  const chargesByKey = new Map<string, { reference: string }>();
  return {
    get chargeCount() {
      return chargesByKey.size;
    },
    async charge({ idempotencyKey, currency }: ChargeRequest) {
      const existing = chargesByKey.get(idempotencyKey);
      if (existing) return existing;
      if (currency === declinedCurrency) throw new PaymentDeclinedError('Card declined');
      const charge = { reference: `pay_${randomUUID()}` };
      chargesByKey.set(idempotencyKey, charge);
      return charge;
    },
  } satisfies PaymentGateway & { chargeCount: number };
}
