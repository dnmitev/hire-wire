import {
  WithStartWorkflowOperation,
  WorkflowExecutionAlreadyStartedError,
  WorkflowUpdateFailedError,
  type Client,
} from '@temporalio/client';
import { ApplicationFailure } from '@temporalio/common';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { createInvoice, getInvoice, invoiceStatuses, listInvoices } from '@hire-wire/db';
import {
  approveUpdate,
  invoiceAlreadyDecided,
  invoiceWorkflowId,
  rejectUpdate,
  taskQueue,
  type invoiceWorkflow,
} from '@hire-wire/workflows';

const createInvoiceBody = z.object({
  customerName: z.string().trim().min(1).max(200),
  customerEmail: z.email(),
  currency: z.string().regex(/^[A-Z]{3}$/, 'Expected an ISO 4217 code such as EUR'),
  notes: z.string().optional(),
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
  sort: z.string().optional(),
  direction: z.enum(['asc', 'desc']).optional(),
});

function workflowOptions(invoiceId: string) {
  return { workflowId: invoiceWorkflowId(invoiceId), taskQueue, args: [{ invoiceId }] as [{ invoiceId: string }] };
}

export async function invoiceRoutes(app: FastifyInstance, { pool, temporal }: { pool: pg.Pool; temporal: Client }) {
  app.post('/invoices', async (request, reply) => {
    const body = createInvoiceBody.parse(request.body);
    const invoice = await createInvoice(pool, body);
    try {
      await temporal.workflow.start<typeof invoiceWorkflow>('invoiceWorkflow', workflowOptions(invoice.id));
    } catch (error) {
      // Not fatal: approve and reject start the workflow themselves if it is not running.
      request.log.error({ err: error, invoiceId: invoice.id }, 'failed to start invoice workflow');
    }
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

  async function decide(id: string, update: typeof approveUpdate | typeof rejectUpdate, reply: FastifyReply) {
    const invoice = await getInvoice(pool, id);
    if (!invoice) return reply.status(404).send({ error: 'not_found' });
    const alreadyDecided = () => reply.status(409).send({ error: 'invoice_already_decided', status: invoice.status });
    if (invoice.status !== 'pending_approval') return alreadyDecided();

    try {
      await temporal.workflow.executeUpdateWithStart(update, {
        startWorkflowOperation: new WithStartWorkflowOperation<typeof invoiceWorkflow>('invoiceWorkflow', {
          ...workflowOptions(id),
          workflowIdConflictPolicy: 'USE_EXISTING',
          // A finished workflow means the invoice was already decided; never start a second one.
          workflowIdReusePolicy: 'REJECT_DUPLICATE',
        }),
      });
    } catch (error) {
      const decidedElsewhere =
        error instanceof WorkflowExecutionAlreadyStartedError ||
        (error instanceof WorkflowUpdateFailedError &&
          error.cause instanceof ApplicationFailure &&
          error.cause.type === invoiceAlreadyDecided);
      if (!decidedElsewhere) throw error;
      invoice.status = (await getInvoice(pool, id))?.status ?? invoice.status;
      return alreadyDecided();
    }
    return getInvoice(pool, id);
  }

  app.post('/invoices/:id/approve', async (request, reply) => {
    const { id } = invoiceParams.parse(request.params);
    return decide(id, approveUpdate, reply);
  });

  app.post('/invoices/:id/reject', async (request, reply) => {
    const { id } = invoiceParams.parse(request.params);
    return decide(id, rejectUpdate, reply);
  });
}
