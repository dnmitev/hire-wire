import { afterAll, describe, expect, it } from 'vitest';
import { useTestDatabase } from '../../../../test/database.ts';
import { connectTestTemporal } from '../../../../test/temporal.ts';
import { buildApp } from '../app.ts';

const { client } = await connectTestTemporal();

describe('invoice pages', () => {
  const pool = useTestDatabase();
  const app = buildApp({ pool, temporal: client });
  afterAll(() => app.close());

  async function login() {
    const response = await app.inject({ method: 'POST', url: '/admin/login', payload: { token: 'changeme' } });
    expect(response.statusCode).toBe(303);
    return response.headers['set-cookie'] as string;
  }

  async function createInvoice() {
    const response = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        customerName: 'Acme Ltd',
        customerEmail: 'billing@acme.test',
        currency: 'EUR',
        lineItems: [{ description: 'Consulting', quantity: 3, unitPriceCents: 12_500 }],
      },
    });
    return response.json().id as string;
  }

  it('logs in with the admin token', async () => {
    expect(await login()).toContain('admin_session=');
  });

  it('rejects a wrong admin token', async () => {
    const response = await app.inject({ method: 'POST', url: '/admin/login', payload: { token: 'wrong' } });
    expect(response.statusCode).toBe(401);
  });

  it('logs in from the HTML form', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/admin/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'token=changeme',
    });
    expect(response.statusCode).toBe(303);
  });

  it('renders an invoice for an admin', async () => {
    const cookie = await login();
    const id = await createInvoice();

    const response = await app.inject({ method: 'GET', url: `/invoices/${id}/view`, headers: { cookie } });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('Invoice for Acme Ltd');
    expect(response.body).toContain('375.00 EUR');
    expect(response.body).toContain('Approve');
  });

  it('lists invoices for an admin', async () => {
    const cookie = await login();
    await createInvoice();

    const response = await app.inject({ method: 'GET', url: '/invoices/view', headers: { cookie } });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Acme Ltd');
  });

  it('requires an admin session', async () => {
    const id = await createInvoice();
    const response = await app.inject({ method: 'GET', url: `/invoices/${id}/view` });
    expect(response.statusCode).toBe(401);
  });
});
