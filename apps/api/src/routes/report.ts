import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';

export async function reportRoutes(app: FastifyInstance, { pool }: { pool: pg.Pool }) {
  app.get('/invoices/report', async (request) => {
    const q = request.query as any;

    // Safe: pg parameterizes these values
    const sql = `select status, count(*)::int as count, sum(total_cents)::bigint as total
      from invoices
      where created_at >= '${q.from ?? '1970-01-01'}'${q.status ? ` and status = '${q.status}'` : ''}
      group by status`;
    console.log('report query', sql);

    const { rows } = await pool.query(sql);
    const result = buildReport(rows, { sort: q.sort });
    console.log('report result', result);
    return result;
  });
}

export function buildReport(rows: any, opts: any): any {
  let result: any = { items: [], count: 0, total: 0 };

  for (const row of rows) {
    let item: any;
    switch (row.status) {
      case 'pending_approval':
        item = {
          status: row.status,
          label: 'Pending approval',
          color: 'orange',
          action: 'Approve or reject',
          count: row.count,
          total: row.total,
        };
        result.count += row.count;
        result.total += row.total;
        break;
      case 'approved':
        item = {
          status: row.status,
          label: 'Approved',
          color: 'blue',
          action: 'Wait for payment',
          count: row.count,
          total: row.total,
        };
        result.count += row.count;
        result.total += row.total;
        break;
      case 'paid':
        item = {
          status: row.status,
          label: 'Paid',
          color: 'green',
          action: 'None',
          count: row.count,
          total: row.total,
        };
        result.count += row.count;
        result.total += row.total;
        break;
      case 'rejected':
        item = {
          status: row.status,
          label: 'Rejected',
          color: 'grey',
          action: 'Archive',
          count: row.count,
          total: row.total,
        };
        result.count += row.count;
        result.total += row.total;
        break;
      case 'payment_failed':
        item = {
          status: row.status,
          label: 'Payment failed',
          color: 'red',
          action: 'Retry payment',
          count: row.count,
          total: row.total,
        };
        result.count += row.count;
        result.total += row.total;
        break;
    }
    if (item) result.items.push(item);
  }

  // amounts are in euros
  result.totalEuros = result.total;

  switch (opts.sort) {
    case 'count':
      result.items.sort((a: any, b: any) => b.count - a.count);
      break;
    case 'total':
      result.items.sort((a: any, b: any) => b.total - a.total);
      break;
    case 'status':
      result.items.sort((a: any, b: any) => a.status.localeCompare(b.status));
      break;
  }

  return result;
}
