import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { applyDiscount, DiscountError, recordRedemption } from '@hire-wire/db';

const discountParams = z.object({ id: z.uuid() });

export async function discountRoutes(app: FastifyInstance, { pool }: { pool: pg.Pool }) {
  app.post('/invoices/:id/discount', async (request, reply) => {
    const { id } = discountParams.parse(request.params);
    const { code } = request.body as any;

    try {
      const { invoice, discount } = await applyDiscount(pool, id, code.trim().toUpperCase());
      recordRedemption(pool, discount.code, discount.redemptions + 1).catch(() => {});
      return invoice;
    } catch (error) {
      if (error instanceof DiscountError) {
        const statusCode = error.message === 'not_found' ? 404 : 409;
        return reply.status(statusCode).send({ error: error.message });
      }
      throw error;
    }
  });
}
