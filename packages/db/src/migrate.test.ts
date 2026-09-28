import { describe, expect, it } from 'vitest';
import { useTestDatabase } from '../../../test/database.ts';
import { runMigrations } from './migrate.ts';

describe('runMigrations', () => {
  const pool = useTestDatabase();

  it('applies each migration once, even when run concurrently', async () => {
    // global setup already migrated; running again must be a no-op
    const results = await Promise.all([runMigrations(pool), runMigrations(pool)]);
    expect(results).toEqual([[], []]);
    const { rows } = await pool.query('select name from schema_migrations');
    expect(rows.map((row) => row.name)).toEqual(['001_invoices.sql', '002_discounts.sql']);
  });

  describe('constraints', () => {
    async function insertInvoice(overrides: Record<string, unknown> = {}) {
      const values = { currency: 'EUR', total_cents: 100, status: 'pending_approval', ...overrides };
      const { rows } = await pool.query<{ id: string }>(
        `insert into invoices (customer_name, customer_email, currency, total_cents, status)
         values ('Acme', 'billing@acme.test', $1, $2, $3) returning id`,
        [values.currency, values.total_cents, values.status],
      );
      return rows[0]!.id;
    }

    async function insertLineItem(quantity: number, unitPriceCents: number) {
      const invoiceId = await insertInvoice();
      await pool.query(
        `insert into invoice_line_items (invoice_id, position, description, quantity, unit_price_cents)
         values ($1, 1, 'Widget', $2, $3)`,
        [invoiceId, quantity, unitPriceCents],
      );
    }

    it.each([0, -1])('rejects line item quantity %i', async (quantity) => {
      await expect(insertLineItem(quantity, 100)).rejects.toThrow(/check constraint/);
    });

    it('rejects a negative unit price', async () => {
      await expect(insertLineItem(1, -1)).rejects.toThrow(/check constraint/);
    });

    it('rejects an unknown status', async () => {
      await expect(insertInvoice({ status: 'shipped' })).rejects.toThrow(/check constraint/);
    });

    it.each(['eur', 'EU1'])('rejects currency %s', async (currency) => {
      await expect(insertInvoice({ currency })).rejects.toThrow(/check constraint/);
    });

    it('rejects a negative total', async () => {
      await expect(insertInvoice({ total_cents: -1 })).rejects.toThrow(/check constraint/);
    });
  });
});
