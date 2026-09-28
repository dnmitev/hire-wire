import type { Client } from '@temporalio/client';
import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import { ZodError } from 'zod';
import { adminRoutes } from './admin-session.ts';
import { discountRoutes } from './routes/discounts.ts';
import { invoicePageRoutes } from './routes/invoice-pages.ts';
import { invoiceRoutes } from './routes/invoices.ts';

export interface AppOptions {
  pool: pg.Pool;
  temporal: Client;
  logger?: boolean;
}

export function buildApp({ pool, temporal, logger = false }: AppOptions): FastifyInstance {
  const app = Fastify({ logger });

  // HTML forms post urlencoded bodies.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'validation_failed',
        issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }
    // Fastify's own client errors (malformed JSON, unsupported media type) carry a 4xx status.
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({ error: 'bad_request', message: (error as Error).message });
    }
    request.log.error(error);
    return reply.status(500).send({ error: 'internal_error' });
  });

  app.get('/health', async () => {
    await pool.query('select 1');
    return { status: 'ok' };
  });

  app.register(invoiceRoutes, { pool, temporal });
  app.register(discountRoutes, { pool });
  app.register(adminRoutes);
  app.register(invoicePageRoutes, { pool, temporal });

  return app;
}
