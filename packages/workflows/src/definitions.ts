import { defineQuery, defineUpdate } from '@temporalio/workflow';

export const taskQueue = 'invoices';

export function invoiceWorkflowId(invoiceId: string): string {
  return `invoice-${invoiceId}`;
}

export interface InvoiceWorkflowInput {
  invoiceId: string;
}

export type InvoiceDecision = 'approved' | 'rejected';

export type InvoiceWorkflowStatus = 'pending_approval' | InvoiceDecision | 'paid' | 'payment_failed';

/** Error type raised when approve or reject is called on an invoice that already has a decision. */
export const invoiceAlreadyDecided = 'InvoiceAlreadyDecided';

export const approveUpdate = defineUpdate<InvoiceDecision>('approve');
export const rejectUpdate = defineUpdate<InvoiceDecision>('reject');
export const statusQuery = defineQuery<InvoiceWorkflowStatus>('status');

export interface InvoiceActivities {
  approveInvoice(invoiceId: string): Promise<void>;
  rejectInvoice(invoiceId: string): Promise<void>;
  chargeInvoice(invoiceId: string): Promise<{ paymentReference: string }>;
  markPaid(invoiceId: string, paymentReference: string): Promise<void>;
  markPaymentFailed(invoiceId: string): Promise<void>;
}
