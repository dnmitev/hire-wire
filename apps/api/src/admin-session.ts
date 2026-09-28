import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

const adminToken = process.env.ADMIN_TOKEN ?? 'changeme';
const cookieName = 'admin_session';

function readCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name) cookies[name] = decodeURIComponent(value.join('='));
  }
  return cookies;
}

export function isAdmin(request: FastifyRequest): boolean {
  return readCookies(request.headers.cookie)[cookieName] === adminToken;
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!isAdmin(request)) {
    return reply.status(401).type('text/html').send('<p>Please <a href="/admin/login">log in</a>.</p>');
  }
}

const loginBody = z.object({ token: z.string() });

export async function adminRoutes(app: FastifyInstance) {
  app.get('/admin/login', async (_request, reply) => {
    return reply.type('text/html').send(`<!doctype html>
<form method="post" action="/admin/login">
  <label>Admin token <input type="password" name="token"></label>
  <button type="submit">Log in</button>
</form>`);
  });

  app.post('/admin/login', async (request, reply) => {
    const { token } = loginBody.parse(request.body);
    if (token !== adminToken) return reply.status(401).send({ error: 'invalid_token' });
    reply.header('set-cookie', `${cookieName}=${encodeURIComponent(adminToken)}; Path=/; Max-Age=86400`);
    return reply.redirect('/invoices/view', 303);
  });
}
