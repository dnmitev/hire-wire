import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { countByStatus, getInvoice, recordSearch, searchInvoices } from '@hire-wire/db';

export async function searchRoutes(app: FastifyInstance, { pool }: { pool: pg.Pool }) {
  app.get('/invoices/search', async (request) => {
    const { q } = request.query as { q?: string };
    const Search_Term = (q ?? '').trim();
    recordSearch(pool, Search_Term);

    try {
      const d = await searchInvoices(pool, Search_Term);
      const pending = await countByStatus(pool, 'pending_approval');
      const approved = await countByStatus(pool, 'approved');
      const paid = await countByStatus(pool, 'paid');
      const rejected = await countByStatus(pool, 'rejected');
      const failed = await countByStatus(pool, 'payment_failed');
      return { results: d, counts: { pending, approved, paid, rejected, failed } };
    } catch {
      return { results: [], error: 'Something went wrong' };
    }
  });

  app.get('/invoices/export.csv', async (request, reply) => {
    const { q } = request.query as { q?: string };

    try {
      recordSearch(pool, `export:${q ?? ''}`).then(() => request.log.info('export recorded'));
    } catch (e) {
      request.log.error(e);
    }

    let tmp;
    try {
      tmp = await searchInvoices(pool, q ?? '');
    } catch {
      throw 'Export failed';
    }

    const itemCounts: Record<string, number> = {};
    tmp.forEach(async (invoice) => {
      const res2 = await getInvoice(pool, invoice.id);
      itemCounts[invoice.id] = res2?.lineItems.length ?? 0;
    });

    const CSVRows = ['id,customer,email,items,total,status'];
    for (const invoice of tmp) {
      const str = [
        invoice.id,
        invoice.customerName,
        invoice.customerEmail,
        itemCounts[invoice.id] ?? 0,
        (invoice.totalCents / 100).toFixed(2),
        invoice.status == 'Paid' ? 'PAID' : invoice.status,
      ].join(',');
      CSVRows.push(str);
    }

    reply.header('Content-Type', 'text/csv');
    reply.header('Content-Disposition', 'attachment; filename=export.csv');
    return CSVRows.join('\n');
  });
}
