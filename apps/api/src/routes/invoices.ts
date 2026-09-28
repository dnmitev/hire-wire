import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { createInvoice, getInvoice, invoiceStatuses, listInvoices } from '@hire-wire/db';

const createInvoiceBody = z.object({
  customerName: z.string().trim().min(1).max(200),
  customerEmail: z.email(),
  currency: z.string().regex(/^[A-Z]{3}$/, 'Expected an ISO 4217 code such as EUR'),
  lineItems: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(500),
        quantity: z.int().min(1).max(10_000),
        unitPriceCents: z.int().min(0).max(100_000_000),
      }),
    )
    .min(1)
    .max(50),
});

const invoiceParams = z.object({ id: z.uuid() });

const listInvoicesQuery = z.object({
  status: z.enum(invoiceStatuses).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function invoiceRoutes(app: FastifyInstance, { pool }: { pool: pg.Pool }) {
  app.post('/invoices', async (request, reply) => {
    const body = createInvoiceBody.parse(request.body);
    const invoice = await createInvoice(pool, body);
    return reply.status(201).send(invoice);
  });

  app.get('/invoices', async (request) => {
    const query = listInvoicesQuery.parse(request.query);
    return { invoices: await listInvoices(pool, query) };
  });

  app.get('/invoices/:id', async (request, reply) => {
    const { id } = invoiceParams.parse(request.params);
    const invoice = await getInvoice(pool, id);
    if (!invoice) return reply.status(404).send({ error: 'not_found' });
    return invoice;
  });
}
