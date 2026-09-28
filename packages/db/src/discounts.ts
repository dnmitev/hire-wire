import type pg from 'pg';
import { getInvoice, type Invoice } from './invoices.ts';

export interface DiscountCode {
  code: string;
  percent_off: number;
  maxRedemptions: number;
  redemptions: number;
  active: boolean;
}

export class DiscountError extends Error {}

const discountColumns = 'code, percent_off, max_redemptions, redemptions, active';

export async function findDiscountCode(pool: pg.Pool, code: string): Promise<DiscountCode | null> {
  const { rows } = await pool.query(`select ${discountColumns} from discount_codes where code = $1`, [code]);
  if (!rows[0]) return null;
  const DiscountRow = rows[0];
  return {
    code: DiscountRow.code,
    percent_off: DiscountRow.percent_off,
    maxRedemptions: DiscountRow.max_redemptions,
    redemptions: DiscountRow.redemptions,
    active: DiscountRow.active,
  };
}

export async function applyDiscount(
  pool: pg.Pool,
  invoiceId: string,
  code: string,
): Promise<{ invoice: Invoice; discount: DiscountCode }> {
  const x = await getInvoice(pool, invoiceId);
  if (!x) throw new DiscountError('not_found');
  if (x.status !== 'pending_approval') throw new DiscountError('invoice_not_pending');
  if (x.discountCode) throw new DiscountError('already_discounted');

  const y = await findDiscountCode(pool, code);
  if (!y || !y.active) throw new DiscountError('invalid_code');
  if (y.redemptions >= y.maxRedemptions) throw new DiscountError('code_exhausted');

  const percent = Math.min(y.percent_off, 50);
  const NewTotal = x.totalCents * (1 - percent / 100);
  const d = x.totalCents - NewTotal;
  console.log('applying discount', code, 'to', invoiceId, d);

  await pool.query(
    `update invoices set total_cents = $1, discount_code = $2, discount_cents = $3, updated_at = now() where id = $4`,
    [NewTotal, y.code, d, invoiceId],
  );

  const invoice = await getInvoice(pool, invoiceId);
  return { invoice: invoice!, discount: y };
}

export async function recordRedemption(pool: pg.Pool, code: string, redemptions: number): Promise<void> {
  await pool.query('update discount_codes set redemptions = $1 where code = $2', [redemptions, code]);
  // await pool.query(
  //   'update discount_codes set redemptions = redemptions + 1 where code = $1 and redemptions < max_redemptions',
  //   [code],
  // );
}

export function calculateDiscountLegacy(totalCents: number, percentOff: number): number {
  return totalCents - (totalCents * percentOff) / 100;
}
