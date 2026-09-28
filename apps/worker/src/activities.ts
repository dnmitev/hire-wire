import { log } from '@temporalio/activity';
import { ApplicationFailure } from '@temporalio/common';
import type pg from 'pg';
import { getInvoice, transitionStatus, type InvoiceStatus } from '@hire-wire/db';
import type { InvoiceActivities } from '@hire-wire/workflows';
import { PaymentDeclinedError, type PaymentGateway } from './payment-gateway.ts';

export function createActivities({
  pool,
  paymentGateway,
}: {
  pool: pg.Pool;
  paymentGateway: PaymentGateway;
}): InvoiceActivities {
  // Temporal retries activities, so a transition that already happened counts as success.
  async function transition(invoiceId: string, from: InvoiceStatus, to: InvoiceStatus, paymentReference?: string) {
    if (await transitionStatus(pool, invoiceId, { from, to, paymentReference })) return;
    const current = await getInvoice(pool, invoiceId);
    if (current?.status === to) return;
    throw ApplicationFailure.nonRetryable(
      `Cannot move invoice ${invoiceId} from ${current?.status ?? 'missing'} to ${to}`,
      'InvalidInvoiceState',
    );
  }

  return {
    approveInvoice: (invoiceId) => transition(invoiceId, 'pending_approval', 'approved'),
    rejectInvoice: (invoiceId) => transition(invoiceId, 'pending_approval', 'rejected'),
    async notifyCustomer(invoiceId, approvedAt) {
      const invoice = await getInvoice(pool, invoiceId);
      if (!invoice) return;
      // Stand-in for the email provider.
      log.info('Sending approval email', {
        to: invoice.customerEmail,
        invoiceId,
        approvedAt: new Date(approvedAt).toISOString(),
      });
    },
    async chargeInvoice(invoiceId) {
      const invoice = await getInvoice(pool, invoiceId);
      if (invoice?.status !== 'approved') {
        throw ApplicationFailure.nonRetryable(`Invoice ${invoiceId} is not approved`, 'InvalidInvoiceState');
      }
      try {
        const { reference } = await paymentGateway.charge({
          idempotencyKey: invoiceId,
          amountCents: invoice.totalCents,
          currency: invoice.currency,
        });
        return { paymentReference: reference };
      } catch (error) {
        // A decline is a final answer from the provider; retrying would not change it.
        if (error instanceof PaymentDeclinedError) {
          throw ApplicationFailure.nonRetryable(error.message, 'PaymentDeclined');
        }
        throw error;
      }
    },
    markPaid: (invoiceId, paymentReference) => transition(invoiceId, 'approved', 'paid', paymentReference),
    markPaymentFailed: (invoiceId) => transition(invoiceId, 'approved', 'payment_failed'),
  };
}
