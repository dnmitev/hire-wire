import { randomUUID } from 'node:crypto';
import { ApplicationFailure } from '@temporalio/common';
import { WorkflowUpdateFailedError } from '@temporalio/client';
import { Worker } from '@temporalio/worker';
import { describe, expect, it, vi } from 'vitest';
import { connectTestTemporal } from '../../../test/temporal.ts';
import { approveUpdate, rejectUpdate, statusQuery, type InvoiceActivities } from './definitions.ts';
import { workflowsPath } from './index.ts';

const { client, nativeConnection } = await connectTestTemporal();

function mockActivities(overrides: Partial<InvoiceActivities> = {}) {
  return {
    approveInvoice: vi.fn(async () => {}),
    rejectInvoice: vi.fn(async () => {}),
    notifyCustomer: vi.fn(async () => {}),
    chargeInvoice: vi.fn(async () => ({ paymentReference: 'pay_1' })),
    markPaid: vi.fn(async () => {}),
    markPaymentFailed: vi.fn(async () => {}),
    ...overrides,
  } satisfies InvoiceActivities;
}

async function runWithWorker<T>(activities: InvoiceActivities, test: (taskQueue: string) => Promise<T>) {
  const taskQueue = `test-${randomUUID()}`;
  const worker = await Worker.create({ connection: nativeConnection, taskQueue, workflowsPath, activities });
  return worker.runUntil(test(taskQueue));
}

async function startInvoiceWorkflow(taskQueue: string) {
  return client.workflow.start('invoiceWorkflow', {
    taskQueue,
    workflowId: `invoice-${randomUUID()}`,
    args: [{ invoiceId: randomUUID() }],
  });
}

describe('invoiceWorkflow', () => {
  it('charges and marks paid once approved', async () => {
    const activities = mockActivities();
    await runWithWorker(activities, async (taskQueue) => {
      const handle = await startInvoiceWorkflow(taskQueue);
      expect(await handle.query(statusQuery)).toBe('pending_approval');
      expect(await handle.executeUpdate(approveUpdate)).toBe('approved');
      expect(await handle.result()).toBe('paid');
    });
    expect(activities.approveInvoice).toHaveBeenCalledOnce();
    expect(activities.notifyCustomer).toHaveBeenCalledOnce();
    expect(activities.chargeInvoice).toHaveBeenCalledOnce();
    expect(activities.markPaid).toHaveBeenCalledWith(expect.any(String), 'pay_1');
  });

  it('never charges a rejected invoice', async () => {
    const activities = mockActivities();
    await runWithWorker(activities, async (taskQueue) => {
      const handle = await startInvoiceWorkflow(taskQueue);
      expect(await handle.executeUpdate(rejectUpdate)).toBe('rejected');
      expect(await handle.result()).toBe('rejected');
    });
    expect(activities.rejectInvoice).toHaveBeenCalledOnce();
    expect(activities.chargeInvoice).not.toHaveBeenCalled();
  });

  it('marks payment failed when the charge is declined', async () => {
    const activities = mockActivities({
      chargeInvoice: vi.fn(async () => {
        throw ApplicationFailure.nonRetryable('Card declined', 'PaymentDeclined');
      }),
    });
    await runWithWorker(activities, async (taskQueue) => {
      const handle = await startInvoiceWorkflow(taskQueue);
      await handle.executeUpdate(approveUpdate);
      expect(await handle.result()).toBe('payment_failed');
    });
    expect(activities.chargeInvoice).toHaveBeenCalledOnce();
    expect(activities.markPaymentFailed).toHaveBeenCalledOnce();
  });

  it('refuses a second decision, including concurrent ones', async () => {
    const activities = mockActivities();
    await runWithWorker(activities, async (taskQueue) => {
      const handle = await startInvoiceWorkflow(taskQueue);
      const results = await Promise.allSettled([handle.executeUpdate(approveUpdate), handle.executeUpdate(approveUpdate)]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((result) => result.status === 'rejected');
      expect(rejected?.reason).toBeInstanceOf(WorkflowUpdateFailedError);

      await expect(handle.executeUpdate(rejectUpdate)).rejects.toBeInstanceOf(WorkflowUpdateFailedError);
      expect(await handle.result()).toBe('paid');
    });
    expect(activities.approveInvoice).toHaveBeenCalledOnce();
    expect(activities.chargeInvoice).toHaveBeenCalledOnce();
  });
});
