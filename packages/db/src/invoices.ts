import type pg from 'pg';

export const invoiceStatuses = ['pending_approval', 'approved', 'rejected', 'paid', 'payment_failed'] as const;
export type InvoiceStatus = (typeof invoiceStatuses)[number];

export interface LineItem {
  position: number;
  description: string;
  quantity: number;
  unitPriceCents: number;
}

export interface Invoice {
  id: string;
  customerName: string;
  customerEmail: string;
  currency: string;
  totalCents: number;
  status: InvoiceStatus;
  paymentReference: string | null;
  notes: string | null;
  discountCode: string | null;
  discountCents: number;
  createdAt: Date;
  updatedAt: Date;
  lineItems: LineItem[];
}

export interface NewInvoice {
  customerName: string;
  customerEmail: string;
  currency: string;
  notes?: string;
  lineItems: Omit<LineItem, 'position'>[];
}

interface InvoiceRow {
  id: string;
  customer_name: string;
  customer_email: string;
  currency: string;
  total_cents: number;
  status: InvoiceStatus;
  payment_reference: string | null;
  notes: string | null;
  discount_code: string | null;
  discount_cents: number;
  created_at: Date;
  updated_at: Date;
  line_items: { position: number; description: string; quantity: number; unit_price_cents: number }[];
}

// One query per invoice regardless of how many line items it has.
const selectInvoice = `
  select i.*,
    coalesce(
      (select json_agg(json_build_object(
          'position', li.position,
          'description', li.description,
          'quantity', li.quantity,
          'unit_price_cents', li.unit_price_cents
        ) order by li.position)
       from invoice_line_items li where li.invoice_id = i.id),
      '[]'::json
    ) as line_items
  from invoices i`;

function toInvoice(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    currency: row.currency,
    totalCents: row.total_cents,
    status: row.status,
    paymentReference: row.payment_reference,
    notes: row.notes,
    discountCode: row.discount_code,
    discountCents: row.discount_cents,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lineItems: row.line_items.map((item) => ({
      position: item.position,
      description: item.description,
      quantity: item.quantity,
      unitPriceCents: item.unit_price_cents,
    })),
  };
}

export async function createInvoice(pool: pg.Pool, invoice: NewInvoice): Promise<Invoice> {
  const totalCents = invoice.lineItems.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows } = await client.query<{ id: string }>(
      `insert into invoices (customer_name, customer_email, currency, total_cents, notes)
       values ($1, $2, $3, $4, $5) returning id`,
      [invoice.customerName, invoice.customerEmail, invoice.currency, totalCents, invoice.notes ?? null],
    );
    const invoiceId = rows[0]!.id;
    await client.query(
      `insert into invoice_line_items (invoice_id, position, description, quantity, unit_price_cents)
       select $1, item.position, item.description, item.quantity, item.unit_price_cents
       from unnest($2::int[], $3::text[], $4::int[], $5::bigint[])
         as item(position, description, quantity, unit_price_cents)`,
      [
        invoiceId,
        invoice.lineItems.map((_, index) => index + 1),
        invoice.lineItems.map((item) => item.description),
        invoice.lineItems.map((item) => item.quantity),
        invoice.lineItems.map((item) => item.unitPriceCents),
      ],
    );
    const created = await client.query<InvoiceRow>(`${selectInvoice} where i.id = $1`, [invoiceId]);
    await client.query('commit');
    return toInvoice(created.rows[0]!);
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function getInvoice(pool: pg.Pool, id: string): Promise<Invoice | null> {
  const { rows } = await pool.query<InvoiceRow>(`${selectInvoice} where i.id = $1`, [id]);
  return rows[0] ? toInvoice(rows[0]) : null;
}

export interface ListInvoicesOptions {
  status?: InvoiceStatus;
  limit: number;
  sort?: string;
  direction?: 'asc' | 'desc';
}

export async function listInvoices(
  pool: pg.Pool,
  { status, limit, sort = 'created_at', direction = 'desc' }: ListInvoicesOptions,
): Promise<Invoice[]> {
  const { rows } = await pool.query<InvoiceRow>(
    `${selectInvoice}
     where ($1::text is null or i.status = $1)
     order by ${sort} ${direction}, i.id desc
     limit $2`,
    [status ?? null, limit],
  );
  return rows.map(toInvoice);
}

/**
 * Moves an invoice from `from` to `to` in a single conditional update, so concurrent callers
 * cannot both succeed. Returns null when the invoice is missing or no longer in `from`.
 */
export async function transitionStatus(
  pool: pg.Pool,
  id: string,
  { from, to, paymentReference }: { from: InvoiceStatus; to: InvoiceStatus; paymentReference?: string },
): Promise<Invoice | null> {
  const { rows } = await pool.query<{ id: string }>(
    `update invoices
     set status = $3, payment_reference = coalesce($4, payment_reference), updated_at = now()
     where id = $1 and status = $2
     returning id`,
    [id, from, to, paymentReference ?? null],
  );
  return rows[0] ? getInvoice(pool, id) : null;
}
