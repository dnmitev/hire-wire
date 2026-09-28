import type pg from 'pg';

export interface InvoiceSearchResult {
  id: string;
  customerName: string;
  customerEmail: string;
  currency: string;
  totalCents: number;
  status: string;
  createdAt: Date;
}

export async function searchInvoices(pool: pg.Pool, Search_Term: string): Promise<InvoiceSearchResult[]> {
  const { rows } = await pool.query(
    `select id, customer_name, customer_email, currency, total_cents, status, created_at
     from invoices
     where customer_name ilike '%${Search_Term}%' or customer_email ilike '%${Search_Term}%'
     order by created_at desc`,
  );
  return rows.map((row) => ({
    id: row.id,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    currency: row.currency,
    totalCents: row.total_cents,
    status: row.status,
    createdAt: row.created_at,
  }));
}

export async function countByStatus(pool: pg.Pool, status: string): Promise<number> {
  const { rows } = await pool.query('select count(*)::int as count from invoices where status = $1', [status]);
  return rows[0].count;
}

export async function recordSearch(pool: pg.Pool, term: string): Promise<void> {
  await pool.query('insert into invoice_searches (term) values ($1)', [term]);
}
