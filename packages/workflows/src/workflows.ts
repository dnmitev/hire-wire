import {
  ActivityFailure,
  allHandlersFinished,
  ApplicationFailure,
  condition,
  proxyActivities,
  setHandler,
} from '@temporalio/workflow';
import {
  approveUpdate,
  invoiceAlreadyDecided,
  rejectUpdate,
  statusQuery,
  type InvoiceActivities,
  type InvoiceDecision,
  type InvoiceWorkflowInput,
  type InvoiceWorkflowStatus,
} from './definitions.ts';

// Activities mark permanent failures (declines, invalid state) non-retryable themselves.
const activities = proxyActivities<InvoiceActivities>({ startToCloseTimeout: '30 seconds' });

export async function invoiceWorkflow({ invoiceId }: InvoiceWorkflowInput): Promise<InvoiceWorkflowStatus> {
  let status: InvoiceWorkflowStatus = 'pending_approval';
  let decision: InvoiceDecision | undefined;
  let decisionRecorded = false;

  setHandler(statusQuery, () => status);

  // The validator runs before an update is accepted, so a second decision is refused without
  // ever entering history. The handler returns once the decision is persisted.
  for (const [update, value] of [
    [approveUpdate, 'approved'],
    [rejectUpdate, 'rejected'],
  ] as const) {
    setHandler(
      update,
      async () => {
        decision = value;
        await condition(() => decisionRecorded);
        return value;
      },
      {
        validator: () => {
          if (decision !== undefined) {
            throw ApplicationFailure.nonRetryable(`Invoice is already ${decision}`, invoiceAlreadyDecided);
          }
        },
      },
    );
  }

  await condition(() => decision !== undefined);
  if (decision === 'approved') {
    await activities.approveInvoice(invoiceId);
  } else {
    await activities.rejectInvoice(invoiceId);
  }
  status = decision!;
  decisionRecorded = true;

  if (decision === 'approved') {
    try {
      const { paymentReference } = await activities.chargeInvoice(invoiceId);
      await activities.markPaid(invoiceId, paymentReference);
      status = 'paid';
    } catch (error) {
      if (!(error instanceof ActivityFailure && error.cause instanceof ApplicationFailure)) throw error;
      if (error.cause.type !== 'PaymentDeclined') throw error;
      await activities.markPaymentFailed(invoiceId);
      status = 'payment_failed';
    }
  }

  await condition(allHandlersFinished);
  return status;
}
