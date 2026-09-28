import type { Client } from '@temporalio/client';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { getInvoice, listInvoices, type Invoice } from '@hire-wire/db';
import { approveUpdate, invoiceWorkflowId } from '@hire-wire/workflows';
import { requireAdmin } from '../admin-session.ts';

const pageParams = z.object({ id: z.uuid() });

function formatAmount(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

function renderPage(title: string, body: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${title}</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 48rem; margin: 2rem auto; }
      table { width: 100%; border-collapse: collapse; }
      td, th { padding: 0.4rem; border-bottom: 1px solid #ddd; text-align: left; }
    </style>
  </head>
  <body>${body}</body>
</html>`;
}

function renderInvoice(invoice: Invoice): string {
  const lines = invoice.lineItems
    .map(
      (item) => `<tr>
        <td>${item.description}</td>
        <td>${item.quantity}</td>
        <td>${formatAmount(item.unitPriceCents, invoice.currency)}</td>
      </tr>`,
    )
    .join('');
  const discount = invoice.discountCode
    ? `<p>Discount ${invoice.discountCode}: -${formatAmount(invoice.discountCents, invoice.currency)}</p>`
    : '';
  const approveForm =
    invoice.status === 'pending_approval'
      ? `<form method="post" action="/invoices/${invoice.id}/approve-from-page"><button>Approve</button></form>`
      : '';

  return renderPage(
    `Invoice for ${invoice.customerName}`,
    `<h1>Invoice for ${invoice.customerName}</h1>
    <p>${invoice.customerEmail} · Status: ${invoice.status}</p>
    <table>
      <tr><th>Item</th><th>Qty</th><th>Unit price</th></tr>
      ${lines}
    </table>
    ${discount}
    <p><strong>Total: ${formatAmount(invoice.totalCents, invoice.currency)}</strong></p>
    ${invoice.notes ? `<p>Notes: ${invoice.notes}</p>` : ''}
    ${approveForm}
    <p><a href="/invoices/view">All invoices</a></p>`,
  );
}

export async function invoicePageRoutes(app: FastifyInstance, { pool, temporal }: { pool: pg.Pool; temporal: Client }) {
  app.addHook('preHandler', requireAdmin);

  app.get('/invoices/view', async (_request, reply) => {
    const invoices = await listInvoices(pool, { limit: 50 });
    const rows: string[] = [];
    for (const summary of invoices) {
      const invoice = await getInvoice(pool, summary.id);
      if (!invoice) continue;
      rows.push(`<tr>
        <td><a href="/invoices/${invoice.id}/view">${invoice.customerName}</a></td>
        <td>${invoice.status}</td>
        <td>${formatAmount(invoice.totalCents, invoice.currency)}</td>
      </tr>`);
    }
    return reply
      .type('text/html')
      .send(renderPage('Invoices', `<h1>Invoices</h1><table>${rows.join('')}</table>`));
  });

  app.get('/invoices/:id/view', async (request, reply) => {
    const { id } = pageParams.parse(request.params);
    const invoice = await getInvoice(pool, id);
    if (!invoice) return reply.status(404).type('text/html').send('<p>Invoice not found</p>');
    return reply.type('text/html').send(renderInvoice(invoice));
  });

  // GET as well, so the approve link in the notification email works too.
  app.route({
    method: ['GET', 'POST'],
    url: '/invoices/:id/approve-from-page',
    handler: async (request, reply) => {
      const { id } = pageParams.parse(request.params);
      await temporal.workflow.getHandle(invoiceWorkflowId(id)).executeUpdate(approveUpdate);
      return reply.redirect(`/invoices/${id}/view`);
    },
  });
}
